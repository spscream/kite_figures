"""Тесты решения о довозе: `decide` и то, что `main` по нему запускает.

Запуск: python3 -m unittest discover -s scripts/tests -t .
"""
import contextlib
import io
import subprocess
import unittest
from unittest import mock

from scripts import catchup
from scripts.catchup import BUSY, FOLLOW, NOTHING, RUN_CI, RUN_DEPLOY, STUCK, WAIT, decide

HEAD = "a" * 40
OLD = "b" * 40
NEXT = "c" * 40


def ci_run(event="workflow_dispatch", status="completed", conclusion="success",
           branch="main", name="CI", run_id=100) -> dict:
    return {
        "id": run_id,
        "name": name,
        "event": event,
        "status": status,
        "conclusion": conclusion,
        "head_branch": branch,
        "head_sha": HEAD,
    }


def running(**kwargs) -> dict:
    return ci_run(status="in_progress", conclusion=None, **kwargs)


def listing(*runs: dict) -> dict:
    return {"total_count": len(runs), "workflow_runs": list(runs)}


def deploy_run(status="completed", conclusion="success", run_id=200) -> dict:
    return {"id": run_id, "name": "Deploy", "status": status, "conclusion": conclusion}


class DecideCase(unittest.TestCase):
    def decide(self, runs=None, deploys=None, head=HEAD, deployed=OLD):
        return decide(
            head, deployed,
            listing() if runs is None else runs,
            listing(deploy_run()) if deploys is None else deploys,
            base="main",
        )

    def test_the_site_already_serves_the_head(self):
        # Даже при красном CI и идущем выкате: довозить нечего.
        verdict = self.decide(
            runs=listing(ci_run(conclusion="failure")),
            deploys=listing(deploy_run(status="in_progress", conclusion=None)),
            deployed=HEAD,
        )
        self.assertEqual(verdict.action, NOTHING)

    def test_a_head_no_ci_ran_on_gets_ci(self):
        # Это и есть коммит авто-мержа: на нём нет ни одного прогона.
        self.assertEqual(self.decide().action, RUN_CI)

    def test_ci_of_a_pull_request_is_not_ci_of_main(self):
        # PR из ветки с именем main несёт head_branch «main», но main не
        # проверял; прогон другого воркфлоу и CI чужой ветки — тоже.
        runs = listing(
            ci_run(event="pull_request"),
            ci_run(name="Automerge", event="workflow_run"),
            ci_run(branch="feat/x", event="push"),
        )
        self.assertEqual(self.decide(runs=runs).action, RUN_CI)

    def test_green_ci_on_main_goes_to_deploy(self):
        for event in ("push", "workflow_dispatch"):
            with self.subTest(event=event):
                verdict = self.decide(runs=listing(ci_run(event=event)))
                self.assertEqual(verdict.action, RUN_DEPLOY)

    def test_one_green_run_is_enough_next_to_a_red_one(self):
        runs = listing(ci_run(conclusion="failure", run_id=1), ci_run(run_id=2))
        self.assertEqual(self.decide(runs=runs).action, RUN_DEPLOY)

    def test_running_ci_of_a_push_is_left_alone(self):
        # Его завершение запускает выкат обычным путём.
        for status in ("queued", "in_progress", "waiting", "requested", "pending"):
            with self.subTest(status=status):
                runs = listing(ci_run(event="push", status=status, conclusion=None))
                self.assertEqual(self.decide(runs=runs).action, WAIT)

    def test_running_ci_launched_by_hand_is_followed(self):
        # Его завершение выката не запустит: не проследи довоз за ним сам,
        # CI позеленеет, а сайт останется на старой ревизии.
        for status in ("queued", "in_progress", "waiting", "requested", "pending"):
            with self.subTest(status=status):
                runs = listing(ci_run(status=status, conclusion=None))
                self.assertEqual(self.decide(runs=runs).action, FOLLOW)

    def test_one_run_that_deploys_by_itself_is_enough_to_stand_back(self):
        runs = listing(running(run_id=1), running(event="push", run_id=2))
        self.assertEqual(self.decide(runs=runs).action, WAIT)
        # И зелёный близнец, запущенный вручную, этого не отменяет: выкатит
        # завершение прогона по пушу.
        runs = listing(ci_run(run_id=1), running(event="push", run_id=2))
        self.assertEqual(self.decide(runs=runs).action, WAIT)

    def test_ci_is_not_started_twice_while_a_red_twin_is_finished(self):
        runs = listing(ci_run(conclusion="failure", run_id=1), running(run_id=2))
        self.assertEqual(self.decide(runs=runs).action, FOLLOW)
        runs = listing(ci_run(conclusion="failure", run_id=1), running(event="push", run_id=2))
        self.assertEqual(self.decide(runs=runs).action, WAIT)

    def test_red_ci_on_main_is_stuck_and_never_restarted(self):
        for conclusion in ("failure", "cancelled", "timed_out", "startup_failure", None):
            with self.subTest(conclusion=conclusion):
                verdict = self.decide(runs=listing(ci_run(conclusion=conclusion)))
                self.assertEqual(verdict.action, STUCK)

    def test_a_second_deploy_is_not_launched_over_a_running_one(self):
        for status in ("queued", "in_progress", "waiting"):
            with self.subTest(status=status):
                deploys = listing(deploy_run(), deploy_run(status=status, conclusion=None))
                verdict = self.decide(runs=listing(ci_run()), deploys=deploys)
                self.assertEqual(verdict.action, BUSY)

    def test_a_running_deploy_of_an_older_commit_does_not_hold_ci_back(self):
        # Два PR влиты подряд: выкат первого ещё в очереди, а у второго нет
        # CI. Жди довоз выката — тот пропустится (коммит уже не голова), и
        # второй коммит простоял бы до расписания.
        deploys = listing(deploy_run(status="queued", conclusion=None))
        self.assertEqual(self.decide(deploys=deploys).action, RUN_CI)
        # Красный CI красным и остаётся, идёт выкат или нет.
        red = listing(ci_run(conclusion="failure"))
        self.assertEqual(self.decide(runs=red, deploys=deploys).action, STUCK)

    def test_a_finished_deploy_proves_nothing(self):
        # Зелёный выкат бывает пропуском; красный надо повторить.
        for conclusion in ("success", "failure", "cancelled", "skipped"):
            with self.subTest(conclusion=conclusion):
                deploys = listing(deploy_run(conclusion=conclusion))
                verdict = self.decide(runs=listing(ci_run()), deploys=deploys)
                self.assertEqual(verdict.action, RUN_DEPLOY)

    def test_no_deploy_has_ever_run(self):
        self.assertEqual(self.decide(runs=listing(ci_run()), deploys=listing()).action, RUN_DEPLOY)

    def test_an_incomplete_list_of_runs_is_not_an_empty_one(self):
        for runs in (
            {"total_count": 101, "workflow_runs": [ci_run(event="pull_request")]},
            {"workflow_runs": []},
            {"total_count": 0},
            {},
        ):
            with self.subTest(runs=runs):
                self.assertEqual(self.decide(runs=runs).action, STUCK)

    def test_an_answer_without_deploy_runs_is_not_no_running_deploy(self):
        self.assertEqual(self.decide(runs=listing(ci_run()), deploys={}).action, STUCK)

    def test_a_revision_that_is_not_a_sha_is_stuck(self):
        for deployed in ("", "не прочитано", HEAD[:12], HEAD + "\n" + OLD):
            with self.subTest(deployed=deployed):
                self.assertEqual(self.decide(deployed=deployed).action, STUCK)
        self.assertEqual(self.decide(head="main").action, STUCK)


CI_LAUNCH = ["gh", "workflow", "run", "ci.yml", "--repo", "octo/repo", "--ref", "main"]
DEPLOY_LAUNCH = ["gh", "workflow", "run", "deploy.yml", "--repo", "octo/repo", "--ref", "main"]


class MainCase(unittest.TestCase):
    """`main` доводит голову до запуска выката: запускает, следит и не лишнего."""

    def run_main(self, *polls, deploys=None, argv=(), launch_code=0, head=HEAD):
        """`polls` — что отвечает GitHub на каждом опросе: список прогонов CI,
        пара (голова, список) или исключение. Последний ответ повторяется."""
        seen = {"poll": -1, "sleeps": 0}

        def current():
            poll = polls[min(seen["poll"], len(polls) - 1)]
            if isinstance(poll, Exception):
                raise poll
            return poll if isinstance(poll, tuple) else (head, poll)

        def gh_json(*args):
            self.assertEqual(args[0], "api")
            path = args[1]
            if path == "repos/octo/repo":
                return {"default_branch": "main"}
            if path == "repos/octo/repo/commits/main":
                seen["poll"] += 1
                return {"sha": current()[0]}
            now, runs = current()
            if path == f"repos/octo/repo/actions/workflows/ci.yml/runs?head_sha={now}&per_page=100":
                return runs
            self.assertEqual(path, "repos/octo/repo/actions/workflows/deploy.yml/runs?per_page=30")
            if isinstance(deploys, list):
                # По ответу на опрос; последний повторяется.
                return deploys[min(seen["poll"], len(deploys) - 1)]
            return listing(deploy_run()) if deploys is None else deploys

        def sleep(seconds):
            seen["sleeps"] += 1

        launched = mock.Mock(return_value=subprocess.CompletedProcess([], launch_code, "", "нет"))
        out = io.StringIO()
        with mock.patch.object(catchup, "gh_json", gh_json), \
                mock.patch.object(catchup.subprocess, "run", launched), \
                mock.patch.object(catchup.time, "sleep", sleep), \
                mock.patch.dict("os.environ", {}, clear=True), \
                contextlib.redirect_stdout(out):
            code = catchup.main(["--repo", "octo/repo", "--deployed", OLD, *argv])
        self.sleeps = seen["sleeps"]
        return code, [call.args[0] for call in launched.call_args_list], out.getvalue()

    def test_a_head_without_ci_gets_ci_and_then_the_deploy(self):
        # Путь коммита авто-мержа целиком: CI запущен, в списке появился не
        # сразу, шёл два опроса, позеленел — выкат запущен этим же заходом.
        code, launched, _ = self.run_main(
            listing(),
            listing(),
            listing(running()),
            listing(running()),
            listing(ci_run()),
        )
        self.assertEqual(code, 0)
        self.assertEqual(launched, [CI_LAUNCH, DEPLOY_LAUNCH])
        self.assertEqual(self.sleeps, 4)

    def test_ci_already_launched_by_the_token_is_followed_to_the_deploy(self):
        code, launched, _ = self.run_main(listing(running()), listing(ci_run()))
        self.assertEqual(code, 0)
        self.assertEqual(launched, [DEPLOY_LAUNCH])

    def test_a_deploy_of_an_older_commit_is_outwaited_once_ci_is_followed(self):
        # CI довели до зелёного, а в очереди ещё выкат прежнего коммита: уйди
        # довоз на этом, голову до расписания никто бы не повёз.
        idle = listing(deploy_run())
        busy = listing(deploy_run(status="in_progress", conclusion=None))
        code, launched, _ = self.run_main(
            listing(), listing(running()), listing(ci_run()),
            deploys=[idle, idle, busy, busy, idle])
        self.assertEqual(code, 0)
        self.assertEqual(launched, [CI_LAUNCH, DEPLOY_LAUNCH])
        self.assertEqual(self.sleeps, 4)

    def test_a_push_that_lands_on_the_followed_head_takes_the_deploy_over(self):
        # CI запущен довозом, а в списке рядом объявился прогон по пушу: тот
        # выкатит сам, и довоз отходит — и пока прогон идёт, и когда свой CI
        # уже позеленел.
        for third in (listing(running(), running(event="push", run_id=2)),
                      listing(ci_run(), running(event="push", run_id=2))):
            with self.subTest(third=third):
                code, launched, _ = self.run_main(listing(), listing(running()), third)
                self.assertEqual(code, 0)
                self.assertEqual(launched, [CI_LAUNCH])

    def test_a_running_deploy_met_before_following_is_left_alone(self):
        busy = listing(deploy_run(status="in_progress", conclusion=None))
        code, launched, _ = self.run_main(listing(ci_run()), deploys=busy)
        self.assertEqual(code, 0)
        self.assertEqual(launched, [])
        self.assertEqual(self.sleeps, 0)

    def test_a_deploy_queue_that_never_clears_fails_the_run(self):
        busy = listing(deploy_run(status="queued", conclusion=None))
        code, launched, out = self.run_main(
            listing(), listing(ci_run()), deploys=busy, argv=["--attempts", "4"])
        self.assertEqual(code, 1)
        self.assertEqual(launched, [CI_LAUNCH])
        self.assertIn("выкат #200 ещё идёт", out)

    def test_an_unknown_default_branch_fails_the_run(self):
        for error in (subprocess.CalledProcessError(1, "gh", stderr="HTTP 502"), KeyError("x")):
            with self.subTest(error=error):
                def gh_json(*args, error=error):
                    raise error

                launched = mock.Mock()
                with mock.patch.object(catchup, "gh_json", gh_json), \
                        mock.patch.object(catchup.subprocess, "run", launched), \
                        mock.patch.dict("os.environ", {}, clear=True), \
                        contextlib.redirect_stdout(io.StringIO()):
                    code = catchup.main(["--repo", "octo/repo", "--deployed", OLD])
                self.assertEqual(code, 1)
                launched.assert_not_called()

    def test_a_dry_run_against_a_silent_api_is_not_a_green_verdict(self):
        silent = subprocess.CalledProcessError(1, "gh", stderr="HTTP 502")
        code, launched, out = self.run_main(silent, argv=["--dry-run"])
        self.assertEqual(code, 1)
        self.assertEqual(launched, [])
        self.assertIn("HTTP 502", out)

    def test_an_answer_of_the_wrong_shape_is_a_hiccup_too(self):
        code, launched, _ = self.run_main(
            listing(), ValueError("не JSON"), KeyError("sha"), listing(ci_run()))
        self.assertEqual(code, 0)
        self.assertEqual(launched, [CI_LAUNCH, DEPLOY_LAUNCH])

    def test_a_green_head_launches_the_deploy_on_main(self):
        code, launched, _ = self.run_main(listing(ci_run()))
        self.assertEqual(code, 0)
        self.assertEqual(launched, [DEPLOY_LAUNCH])
        self.assertEqual(self.sleeps, 0)

    def test_ci_that_turns_red_fails_the_run_without_a_deploy(self):
        code, launched, out = self.run_main(
            listing(), listing(running()), listing(ci_run(conclusion="failure")))
        self.assertEqual(code, 1)
        self.assertEqual(launched, [CI_LAUNCH])
        self.assertIn("не зелёный", out)

    def test_ci_that_never_ends_fails_the_run_without_a_deploy(self):
        code, launched, out = self.run_main(
            listing(), listing(running()), argv=["--attempts", "5"])
        self.assertEqual(code, 1)
        self.assertEqual(launched, [CI_LAUNCH])
        self.assertEqual(self.sleeps, 4)
        self.assertIn("за 5 опросов голова не довезена", out)

    def test_ci_that_never_shows_up_is_not_launched_again(self):
        code, launched, _ = self.run_main(listing(), argv=["--attempts", "6"])
        self.assertEqual(code, 1)
        self.assertEqual(launched, [CI_LAUNCH])

    def test_a_head_that_moved_on_is_left_to_the_next_catch_up(self):
        # Пока шёл CI, влит следующий PR: выкатывать прежнюю голову незачем,
        # а CI новой запустит её собственный довоз.
        code, launched, out = self.run_main(
            listing(), listing(running()), (NEXT, listing()))
        self.assertEqual(code, 0)
        self.assertEqual(launched, [CI_LAUNCH])
        self.assertIn("довезёт следующий довоз", out)

    def test_a_hiccup_of_the_api_does_not_drop_the_head(self):
        hiccup = subprocess.CalledProcessError(1, "gh", stderr="HTTP 502")
        code, launched, _ = self.run_main(
            listing(), hiccup, listing(running()), hiccup, listing(ci_run()))
        self.assertEqual(code, 0)
        self.assertEqual(launched, [CI_LAUNCH, DEPLOY_LAUNCH])

    def test_nothing_is_launched_when_there_is_nothing_to_do(self):
        for runs, deploys, head in (
            (listing(), None, OLD),
            (listing(running(event="push")), None, HEAD),
            (listing(ci_run()), listing(deploy_run(status="queued", conclusion=None)), HEAD),
        ):
            with self.subTest(runs=runs, head=head):
                code, launched, _ = self.run_main(runs, deploys=deploys, head=head)
                self.assertEqual(code, 0)
                self.assertEqual(launched, [])
                self.assertEqual(self.sleeps, 0)

    def test_red_ci_fails_the_run_and_launches_nothing(self):
        code, launched, out = self.run_main(listing(ci_run(conclusion="failure")))
        self.assertEqual(code, 1)
        self.assertEqual(launched, [])
        self.assertIn("не зелёный", out)

    def test_a_dry_run_launches_nothing_and_does_not_poll(self):
        for runs, needle in (
            (listing(), "ci.yml не запущен"),
            (listing(ci_run()), "deploy.yml не запущен"),
            (listing(running()), "опроса нет"),
        ):
            with self.subTest(needle=needle):
                code, launched, out = self.run_main(runs, argv=["--dry-run"])
                self.assertEqual(code, 0)
                self.assertEqual(launched, [])
                self.assertEqual(self.sleeps, 0)
                self.assertIn(needle, out)

    def test_a_refused_launch_fails_the_run(self):
        for runs in (listing(), listing(ci_run())):
            with self.subTest(runs=runs):
                code, launched, out = self.run_main(runs, launch_code=1)
                self.assertEqual(code, 1)
                self.assertEqual(len(launched), 1)
                self.assertIn("отклонён", out)

    def test_a_silent_api_fails_the_run(self):
        silent = subprocess.CalledProcessError(1, "gh", stderr="HTTP 502")
        code, launched, out = self.run_main(silent, argv=["--attempts", "3"])
        self.assertEqual(code, 1)
        self.assertEqual(launched, [])
        self.assertIn("HTTP 502", out)


if __name__ == "__main__":
    unittest.main()
