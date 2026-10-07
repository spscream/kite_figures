"""Тесты решения о довозе: `decide` и то, что `main` по нему запускает.

Запуск: python3 -m unittest discover -s scripts/tests -t .
"""
import contextlib
import io
import subprocess
import unittest
from unittest import mock

from scripts import catchup
from scripts.catchup import NOTHING, RUN_CI, RUN_DEPLOY, STUCK, WAIT, decide

HEAD = "a" * 40
OLD = "b" * 40


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

    def test_running_ci_is_waited_for(self):
        for status in ("queued", "in_progress", "waiting", "requested", "pending"):
            with self.subTest(status=status):
                runs = listing(ci_run(status=status, conclusion=None))
                self.assertEqual(self.decide(runs=runs).action, WAIT)

    def test_ci_is_not_started_twice_while_a_red_twin_is_finished(self):
        runs = listing(
            ci_run(conclusion="failure", run_id=1),
            ci_run(status="in_progress", conclusion=None, run_id=2),
        )
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
                self.assertEqual(verdict.action, WAIT)

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


class MainCase(unittest.TestCase):
    """`main` доводит вердикт до запуска нужного воркфлоу — и только до него."""

    def run_main(self, runs, deploys=None, argv=(), launch_code=0, head=HEAD):
        answers = {
            "repos/octo/repo": {"default_branch": "main"},
            "repos/octo/repo/commits/main": {"sha": head},
            f"repos/octo/repo/actions/workflows/ci.yml/runs?head_sha={head}&per_page=100": runs,
            "repos/octo/repo/actions/workflows/deploy.yml/runs?per_page=30":
                listing(deploy_run()) if deploys is None else deploys,
        }

        def gh_json(*args):
            self.assertEqual(args[0], "api")
            return answers[args[1]]

        launched = mock.Mock(return_value=subprocess.CompletedProcess([], launch_code, "", "нет"))
        out = io.StringIO()
        with mock.patch.object(catchup, "gh_json", gh_json), \
                mock.patch.object(catchup.subprocess, "run", launched), \
                mock.patch.dict("os.environ", {}, clear=True), \
                contextlib.redirect_stdout(out):
            code = catchup.main(["--repo", "octo/repo", "--deployed", OLD, *argv])
        return code, launched, out.getvalue()

    def test_a_head_without_ci_launches_ci_on_main(self):
        code, launched, _ = self.run_main(listing())
        self.assertEqual(code, 0)
        launched.assert_called_once()
        self.assertEqual(
            launched.call_args.args[0],
            ["gh", "workflow", "run", "ci.yml", "--repo", "octo/repo", "--ref", "main"],
        )

    def test_a_green_head_launches_the_deploy_on_main(self):
        code, launched, _ = self.run_main(listing(ci_run()))
        self.assertEqual(code, 0)
        self.assertEqual(
            launched.call_args.args[0],
            ["gh", "workflow", "run", "deploy.yml", "--repo", "octo/repo", "--ref", "main"],
        )

    def test_nothing_is_launched_when_there_is_nothing_to_do(self):
        waiting = listing(ci_run(status="in_progress", conclusion=None))
        for runs, deploys, head in (
            (listing(), None, OLD),
            (waiting, None, HEAD),
            (listing(ci_run()), listing(deploy_run(status="queued", conclusion=None)), HEAD),
        ):
            with self.subTest(runs=runs, head=head):
                code, launched, _ = self.run_main(runs, deploys, head=head)
                self.assertEqual(code, 0)
                launched.assert_not_called()

    def test_red_ci_fails_the_run_and_launches_nothing(self):
        code, launched, out = self.run_main(listing(ci_run(conclusion="failure")))
        self.assertEqual(code, 1)
        launched.assert_not_called()
        self.assertIn("не зелёный", out)

    def test_a_dry_run_launches_nothing(self):
        code, launched, out = self.run_main(listing(), argv=["--dry-run"])
        self.assertEqual(code, 0)
        launched.assert_not_called()
        self.assertIn("ci.yml не запущен", out)

    def test_a_refused_launch_fails_the_run(self):
        code, _, out = self.run_main(listing(), launch_code=1)
        self.assertEqual(code, 1)
        self.assertIn("отклонён", out)

    def test_a_silent_api_fails_the_run(self):
        def gh_json(*args):
            raise subprocess.CalledProcessError(1, "gh", stderr="HTTP 502")

        launched = mock.Mock()
        with mock.patch.object(catchup, "gh_json", gh_json), \
                mock.patch.object(catchup.subprocess, "run", launched), \
                mock.patch.dict("os.environ", {}, clear=True), \
                contextlib.redirect_stdout(io.StringIO()):
            code = catchup.main(["--repo", "octo/repo", "--deployed", OLD])
        self.assertEqual(code, 1)
        launched.assert_not_called()


if __name__ == "__main__":
    unittest.main()
