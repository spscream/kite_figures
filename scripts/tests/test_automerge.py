"""Тесты решения об авто-мерже: `judge` и разбор события джобы.

Запуск: python3 -m unittest discover -s scripts/tests -t .
"""
import contextlib
import copy
import io
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from scripts import automerge
from scripts.automerge import MERGE, REFUSE, WAIT, judge, target_from_event

ROOT = Path(__file__).resolve().parents[2]

OWNER = "octo"
HEAD = "a" * 40
CI_RUN = 100


def clean_pr() -> dict:
    return {
        "number": 7,
        "title": "feat: something",
        "state": "OPEN",
        "isDraft": False,
        "author": {"login": OWNER},
        "isCrossRepository": False,
        "headRepositoryOwner": {"login": OWNER},
        "headRefOid": HEAD,
        "baseRefName": "main",
        "labels": [],
        "mergeable": "MERGEABLE",
        "mergeStateStatus": "CLEAN",
    }


def check(name: str, status: str = "completed", conclusion: str | None = "success", run=CI_RUN):
    return {
        "name": name,
        "status": status,
        "conclusion": conclusion,
        "details_url": f"https://github.com/octo/repo/actions/runs/{run}/job/1",
    }


def green_checks() -> dict:
    checks = [check("lint"), check("backend-tests"), check("web-smoke")]
    return {"total_count": len(checks), "check_runs": checks}


def green_runs() -> dict:
    runs = [
        {
            "id": CI_RUN,
            "name": "CI",
            "path": ".github/workflows/ci.yml",
            "event": "pull_request",
            "status": "completed",
            "conclusion": "success",
        }
    ]
    return {"total_count": len(runs), "workflow_runs": runs}


def no_statuses() -> dict:
    return {"state": "pending", "total_count": 0, "statuses": []}


class JudgeCase(unittest.TestCase):
    def setUp(self):
        self.pr = clean_pr()
        self.checks = green_checks()
        self.status = no_statuses()
        self.runs = green_runs()

    def verdict(self, **kwargs):
        kwargs.setdefault("owner", OWNER)
        kwargs.setdefault("base", "main")
        return judge(self.pr, self.checks, self.status, self.runs, **kwargs)

    def assert_decision(self, decision, needle=None, **kwargs):
        verdict = self.verdict(**kwargs)
        self.assertEqual(verdict.decision, decision, verdict.reasons)
        if needle is not None:
            self.assertTrue(
                any(needle in reason for reason in verdict.reasons),
                f"«{needle}» не названо в причинах: {verdict.reasons}",
            )

    # --- все четыре условия выполнены ------------------------------------

    def test_clean_pr_merges(self):
        self.assert_decision(MERGE, expected_head=HEAD)

    def test_skipped_and_neutral_checks_are_green(self):
        self.checks["check_runs"][0]["conclusion"] = "skipped"
        self.checks["check_runs"][1]["conclusion"] = "neutral"
        self.assert_decision(MERGE)

    def test_successful_commit_status_is_green(self):
        self.status = {
            "state": "success",
            "total_count": 1,
            "statuses": [{"context": "ext", "state": "success"}],
        }
        self.assert_decision(MERGE)

    # --- условие 1: автор и не форк --------------------------------------

    def test_foreign_author_is_refused(self):
        self.pr["author"] = {"login": "mallory"}
        self.assert_decision(REFUSE, "mallory")

    def test_bot_author_is_refused(self):
        self.pr["author"] = {"login": "app/dependabot", "is_bot": True}
        self.assert_decision(REFUSE, "app/dependabot")

    def test_fork_head_is_refused(self):
        self.pr["isCrossRepository"] = True
        self.pr["headRepositoryOwner"] = {"login": "mallory"}
        self.assert_decision(REFUSE, "не в этом репозитории")

    def test_fork_under_same_owner_name_is_refused(self):
        self.pr["isCrossRepository"] = True
        self.assert_decision(REFUSE, "не в этом репозитории")

    def test_missing_cross_repository_field_is_refused(self):
        del self.pr["isCrossRepository"]
        self.assert_decision(REFUSE, "не в этом репозитории")

    def test_deleted_head_repository_is_refused(self):
        self.pr["headRepositoryOwner"] = None
        self.assert_decision(REFUSE, "не в этом репозитории")

    def test_closed_pr_is_refused(self):
        self.pr["state"] = "MERGED"
        self.assert_decision(REFUSE, "не открыт")

    # --- условие 2: проверки завершились и зелёные -----------------------

    def test_running_check_waits(self):
        self.checks["check_runs"][2] = check("web-smoke", status="in_progress", conclusion=None)
        self.assert_decision(WAIT, "web-smoke")

    def test_queued_check_waits(self):
        self.checks["check_runs"][2] = check("web-smoke", status="queued", conclusion=None)
        self.assert_decision(WAIT, "web-smoke")

    def test_failed_check_is_refused(self):
        self.checks["check_runs"][1]["conclusion"] = "failure"
        self.assert_decision(REFUSE, "backend-tests")

    def test_cancelled_and_timed_out_checks_are_refused(self):
        for conclusion in ("cancelled", "timed_out", "action_required", "stale", None):
            with self.subTest(conclusion=conclusion):
                self.checks = green_checks()
                self.checks["check_runs"][0]["conclusion"] = conclusion
                self.assert_decision(REFUSE, "lint")

    def test_no_checks_at_all_waits(self):
        self.checks = {"total_count": 0, "check_runs": []}
        self.assert_decision(WAIT, "нет ни одной проверки")

    def test_running_workflow_run_waits_even_if_its_jobs_are_not_listed_yet(self):
        # Шесть незавершённых чеков PR #117 beauty_compare: джобы ещё идут.
        self.runs["workflow_runs"][0].update(status="in_progress", conclusion=None)
        self.assert_decision(WAIT, "не завершён")

    def test_second_workflow_still_running_waits(self):
        self.runs["workflow_runs"].append(
            {
                "id": 101,
                "name": "Other",
                "path": ".github/workflows/other.yml",
                "event": "pull_request",
                "status": "queued",
                "conclusion": None,
            }
        )
        self.runs["total_count"] = 2
        self.assert_decision(WAIT, "Other")

    def test_failed_workflow_run_is_refused(self):
        self.runs["workflow_runs"][0]["conclusion"] = "failure"
        self.assert_decision(REFUSE, "failure")

    def test_head_without_ci_run_waits(self):
        self.runs = {"total_count": 0, "workflow_runs": []}
        self.assert_decision(WAIT, "нет зелёного прогона")

    def test_ci_run_by_push_does_not_count_as_pull_request_ci(self):
        self.runs["workflow_runs"][0]["event"] = "push"
        self.assert_decision(WAIT, "нет зелёного прогона")

    def test_pending_commit_status_waits(self):
        self.status = {
            "state": "pending",
            "total_count": 1,
            "statuses": [{"context": "ext", "state": "pending"}],
        }
        self.assert_decision(WAIT, "ext")

    def test_failed_commit_status_is_refused(self):
        for state in ("failure", "error"):
            with self.subTest(state=state):
                self.status = {
                    "state": state,
                    "total_count": 1,
                    "statuses": [{"context": "ext", "state": state}],
                }
                self.assert_decision(REFUSE, "ext")

    def test_truncated_lists_are_refused(self):
        for target in ("checks", "runs", "status"):
            with self.subTest(target=target):
                self.setUp()
                getattr(self, target)["total_count"] = 101
                self.assert_decision(REFUSE, "неполон")

    def test_missing_api_answers_are_refused(self):
        self.checks, self.status, self.runs = {}, {}, {}
        self.assert_decision(REFUSE, "неполон")

    def test_head_moved_past_the_green_run_is_refused(self):
        self.assert_decision(REFUSE, "ушла вперёд", expected_head="b" * 40)

    # --- исключений «для своих» нет ---------------------------------------

    def test_any_unfinished_check_on_head_waits_whatever_workflow_it_is(self):
        self.runs["workflow_runs"].append(
            {
                "id": 900,
                "name": "Automerge",
                "path": ".github/workflows/automerge.yml",
                "event": "workflow_dispatch",
                "status": "in_progress",
                "conclusion": None,
            }
        )
        self.runs["total_count"] = 2
        self.assert_decision(WAIT, "#900")

    def test_cancelled_twin_of_a_green_ci_run_is_a_loud_refusal(self):
        self.runs["workflow_runs"].append(
            dict(self.runs["workflow_runs"][0], id=99, conclusion="cancelled")
        )
        self.runs["total_count"] = 2
        verdict = self.verdict()
        self.assertEqual(verdict.decision, REFUSE)
        self.assertFalse(verdict.routine)

    # --- базовая ветка ----------------------------------------------------

    def test_pr_into_a_non_default_branch_is_refused(self):
        self.pr["baseRefName"] = "release"
        self.assert_decision(REFUSE, "release")

    # --- условие 3: mergeable и CLEAN ------------------------------------

    def test_unknown_merge_state_waits(self):
        # Минута после мержа в базовую ветку: оба поля UNKNOWN.
        self.pr["mergeable"] = "UNKNOWN"
        self.pr["mergeStateStatus"] = "UNKNOWN"
        verdict = self.verdict()
        self.assertEqual(verdict.decision, WAIT, verdict.reasons)
        self.assertEqual(len(verdict.reasons), 2, verdict.reasons)

    def test_unstable_merge_state_waits(self):
        self.pr["mergeStateStatus"] = "UNSTABLE"
        self.assert_decision(WAIT, "UNSTABLE")

    def test_has_hooks_is_not_clean(self):
        self.pr["mergeStateStatus"] = "HAS_HOOKS"
        self.assert_decision(WAIT, "HAS_HOOKS")

    def test_conflict_is_refused(self):
        self.pr["mergeable"] = "CONFLICTING"
        self.pr["mergeStateStatus"] = "DIRTY"
        self.assert_decision(REFUSE, "CONFLICTING")

    def test_dead_merge_states_are_refused(self):
        for state in ("DIRTY", "BLOCKED", "BEHIND", "DRAFT"):
            with self.subTest(state=state):
                self.pr["mergeStateStatus"] = state
                self.assert_decision(REFUSE, state)

    def test_missing_merge_fields_never_merge(self):
        del self.pr["mergeable"]
        del self.pr["mergeStateStatus"]
        self.assert_decision(WAIT)

    # --- условие 4: черновик и hold --------------------------------------

    def test_draft_is_refused(self):
        self.pr["isDraft"] = True
        self.assert_decision(REFUSE, "черновик")

    def test_missing_draft_field_is_refused(self):
        del self.pr["isDraft"]
        self.assert_decision(REFUSE, "черновик")

    def test_hold_label_is_refused(self):
        self.pr["labels"] = [{"name": "bug"}, {"name": "hold"}]
        self.assert_decision(REFUSE, "hold")

    def test_hold_label_is_case_insensitive(self):
        self.pr["labels"] = [{"name": "Hold"}]
        self.assert_decision(REFUSE, "hold")

    def test_missing_or_null_labels_never_merge(self):
        for labels in (None, "absent"):
            with self.subTest(labels=labels):
                self.pr = clean_pr()
                if labels == "absent":
                    del self.pr["labels"]
                else:
                    self.pr["labels"] = labels
                self.assert_decision(REFUSE, "нет списка меток")

    def test_other_labels_do_not_block(self):
        self.pr["labels"] = [{"name": "on-hold-no-more"}, {"name": "bug"}]
        self.assert_decision(MERGE)

    # --- порядок вердиктов ------------------------------------------------

    def test_refusal_wins_over_waiting(self):
        self.pr["mergeStateStatus"] = "UNKNOWN"
        self.pr["isDraft"] = True
        self.assert_decision(REFUSE, "черновик")

    # --- штатный отказ и поломка ------------------------------------------

    def test_policy_refusals_are_routine(self):
        cases = {
            "draft": lambda pr: pr.update(isDraft=True, mergeStateStatus="DRAFT"),
            "hold": lambda pr: pr.update(labels=[{"name": "hold"}]),
            "author": lambda pr: pr.update(author={"login": "mallory"}),
            "fork": lambda pr: pr.update(isCrossRepository=True),
            "merged": lambda pr: pr.update(state="MERGED"),
            "base": lambda pr: pr.update(baseRefName="release"),
        }
        for name, change in cases.items():
            with self.subTest(name):
                self.pr = clean_pr()
                change(self.pr)
                verdict = self.verdict()
                self.assertEqual(verdict.decision, REFUSE)
                self.assertTrue(verdict.routine, verdict.reasons)

    def test_head_moved_is_routine(self):
        verdict = self.verdict(expected_head="b" * 40)
        self.assertTrue(verdict.routine)

    def test_stuck_refusals_are_not_routine(self):
        cases = {
            "red check": lambda: self.checks["check_runs"][0].update(conclusion="failure"),
            "conflict": lambda: self.pr.update(mergeable="CONFLICTING", mergeStateStatus="DIRTY"),
            "blocked": lambda: self.pr.update(mergeStateStatus="BLOCKED"),
            "truncated": lambda: self.checks.update(total_count=101),
            "no labels": lambda: self.pr.pop("labels"),
            "draft state on a ready pr": lambda: self.pr.update(mergeStateStatus="DRAFT"),
        }
        for name, change in cases.items():
            with self.subTest(name):
                self.setUp()
                change()
                verdict = self.verdict()
                self.assertEqual(verdict.decision, REFUSE)
                self.assertFalse(verdict.routine, verdict.reasons)

    def test_judge_does_not_mutate_its_inputs(self):
        before = copy.deepcopy((self.pr, self.checks, self.status, self.runs))
        self.verdict(expected_head=HEAD)
        self.assertEqual(before, (self.pr, self.checks, self.status, self.runs))


class TargetFromEventCase(unittest.TestCase):
    def test_workflow_run_with_one_pr(self):
        env = {
            "GITHUB_EVENT_NAME": "workflow_run",
            "PULL_REQUESTS": '[{"number": 7, "head": {"sha": "x"}}]',
            "RUN_HEAD_SHA": HEAD,
        }
        self.assertEqual(target_from_event(env)[:2], (7, HEAD))

    def test_workflow_run_without_pr_has_no_target(self):
        for pulls in ("[]", "", "null", "not json", '[{"number": 1}, {"number": 2}]'):
            with self.subTest(pulls=pulls):
                env = {
                    "GITHUB_EVENT_NAME": "workflow_run",
                    "PULL_REQUESTS": pulls,
                    "RUN_HEAD_SHA": HEAD,
                }
                self.assertIsNone(target_from_event(env)[0])

    def test_workflow_run_without_head_sha_has_no_target(self):
        env = {
            "GITHUB_EVENT_NAME": "workflow_run",
            "PULL_REQUESTS": '[{"number": 7}]',
            "RUN_HEAD_SHA": "",
        }
        self.assertIsNone(target_from_event(env)[0])

    def test_dispatch_takes_the_typed_number_and_no_expected_head(self):
        env = {"GITHUB_EVENT_NAME": "workflow_dispatch", "INPUT_PR": "12"}
        self.assertEqual(target_from_event(env)[:2], (12, None))

    def test_dispatch_rejects_anything_but_digits(self):
        for raw in ("", "12 ", "#12", "12;rm", "-1", "１２"):
            with self.subTest(raw=raw):
                env = {"GITHUB_EVENT_NAME": "workflow_dispatch", "INPUT_PR": raw}
                self.assertIsNone(target_from_event(env)[0])


class MainCase(unittest.TestCase):
    """`main` на поддельном `gh`: коды возврата, опрос и аргументы мержа."""

    def setUp(self):
        self.pr = clean_pr()
        self.checks = green_checks()
        self.status = no_statuses()
        self.runs = green_runs()
        self.pr_answers = None  # очередь ответов `gh pr view`; None — всегда self.pr
        self.gh_calls = []
        self.merges = []
        self.merge_rc = 0
        self.sleeps = []

    def fake_gh_json(self, *args):
        self.gh_calls.append(args)
        if args[:2] == ("pr", "view"):
            self.assertIn("--json", args)
            if self.pr_answers:
                answer = self.pr_answers.pop(0)
                if isinstance(answer, Exception):
                    raise answer
                return answer
            return self.pr
        path = args[1]
        if "/check-runs" in path:
            return self.checks
        if path.endswith("/status?per_page=100"):
            return self.status
        if "/actions/runs?head_sha=" in path:
            return self.runs
        self.assertEqual(path, "repos/octo/repo")
        return {"default_branch": "main"}

    def fake_run(self, cmd, **kwargs):
        self.merges.append(cmd)
        return subprocess.CompletedProcess(cmd, self.merge_rc, stdout="", stderr="отказ")

    def run_main(self, *argv, event="workflow_run", env=None):
        environ = {
            "GITHUB_REPOSITORY": "octo/repo",
            "GITHUB_EVENT_NAME": event,
            "PULL_REQUESTS": '[{"number": 7}]',
            "RUN_HEAD_SHA": HEAD,
            "INPUT_PR": "7",
        }
        environ.update(env or {})
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict("os.environ", environ, clear=True))
            stack.enter_context(mock.patch.object(automerge, "gh_json", self.fake_gh_json))
            stack.enter_context(mock.patch.object(automerge.subprocess, "run", self.fake_run))
            stack.enter_context(mock.patch.object(automerge.time, "sleep", self.sleeps.append))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            return automerge.main(["--attempts", "3", "--interval", "15", *argv])

    def test_green_pr_is_squashed_on_the_checked_head_without_auto(self):
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(len(self.merges), 1)
        cmd = self.merges[0]
        self.assertEqual(cmd[:4], ["gh", "pr", "merge", "7"])
        self.assertIn("--squash", cmd)
        self.assertEqual(cmd[cmd.index("--match-head-commit") + 1], HEAD)
        self.assertEqual(cmd[cmd.index("--subject") + 1], "feat: something (#7)")
        self.assertEqual(cmd[cmd.index("--repo") + 1], "octo/repo")
        for banned in ("--auto", "--admin", "--merge", "--rebase"):
            self.assertNotIn(banned, cmd)

    def test_pr_view_asks_for_every_field_judge_reads(self):
        self.run_main()
        view = next(call for call in self.gh_calls if call[:2] == ("pr", "view"))
        asked = set(view[view.index("--json") + 1].split(","))
        self.assertLessEqual(set(clean_pr()), asked)

    def test_dry_run_never_merges(self):
        self.assertEqual(self.run_main("--pr", "7", "--dry-run"), 0)
        self.assertEqual(self.merges, [])

    def test_unknown_merge_state_is_polled_then_merged(self):
        unknown = dict(clean_pr(), mergeable="UNKNOWN", mergeStateStatus="UNKNOWN")
        self.pr_answers = [unknown, unknown]
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(self.sleeps, [15.0, 15.0])
        self.assertEqual(len(self.merges), 1)

    def test_never_clean_is_red_and_does_not_merge(self):
        self.pr["mergeStateStatus"] = "UNSTABLE"
        self.assertEqual(self.run_main(), 1)
        self.assertEqual(self.merges, [])
        self.assertEqual(len(self.sleeps), 2)

    def test_one_failed_api_call_mid_poll_is_retried(self):
        self.pr_answers = [subprocess.CalledProcessError(1, ["gh"], stderr="HTTP 502")]
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(len(self.merges), 1)

    def test_api_down_for_every_poll_is_red(self):
        self.pr_answers = [subprocess.CalledProcessError(1, ["gh"], stderr="HTTP 502")] * 3
        self.assertEqual(self.run_main(), 1)
        self.assertEqual(self.merges, [])

    def test_routine_refusal_is_green_on_workflow_run_and_red_on_dispatch(self):
        self.pr["labels"] = [{"name": "hold"}]
        self.assertEqual(self.run_main(), 0)
        self.assertEqual(self.run_main(event="workflow_dispatch"), 1)
        self.assertEqual(self.merges, [])

    def test_stuck_refusal_is_red_on_workflow_run(self):
        self.checks["check_runs"][0]["conclusion"] = "cancelled"
        self.assertEqual(self.run_main(), 1)
        self.assertEqual(self.merges, [])

    def test_head_past_the_green_run_is_not_merged(self):
        self.assertEqual(self.run_main(env={"RUN_HEAD_SHA": "b" * 40}), 0)
        self.assertEqual(self.merges, [])

    def test_green_ci_event_without_a_pr_is_red(self):
        self.assertEqual(self.run_main(env={"PULL_REQUESTS": "[]"}), 1)
        self.assertEqual(self.merges, [])

    def test_merge_rejected_by_github_is_red(self):
        self.merge_rc = 1
        self.assertEqual(self.run_main(), 1)

    def test_dispatch_reads_the_typed_number(self):
        self.assertEqual(self.run_main(event="workflow_dispatch", env={"INPUT_PR": "7"}), 0)
        self.assertEqual(self.merges[0][3], "7")
        self.assertEqual(self.run_main(event="workflow_dispatch", env={"INPUT_PR": "7 "}), 1)


class WiringCase(unittest.TestCase):
    """Воркфлоу и скрипт говорят об одном и том же — сверяется по тексту yml."""

    def setUp(self):
        workflows = ROOT / ".github" / "workflows"
        self.ci = (workflows / "ci.yml").read_text(encoding="utf-8")
        self.automerge = (workflows / "automerge.yml").read_text(encoding="utf-8")
        self.code = [
            line for line in self.automerge.splitlines() if not line.lstrip().startswith("#")
        ]

    def test_ci_workflow_is_named_as_the_script_expects(self):
        self.assertIn(f"\nname: {automerge.CI_WORKFLOW_NAME}\n", self.ci)
        self.assertIn(f'workflows: ["{automerge.CI_WORKFLOW_NAME}"]', self.automerge)

    def test_ci_runs_on_pull_request(self):
        self.assertRegex(self.ci, r"\non:\n  pull_request:")

    def test_workflow_runs_the_script_and_feeds_it_the_event(self):
        self.assertIn("        run: python3 scripts/automerge.py", self.code)
        for name, source in (
            ("GH_TOKEN", "github.token"),
            ("PULL_REQUESTS", "toJSON(github.event.workflow_run.pull_requests)"),
            ("RUN_HEAD_SHA", "github.event.workflow_run.head_sha"),
            ("INPUT_PR", "github.event.inputs.pr"),
        ):
            self.assertIn(f"          {name}: ${{{{ {source} }}}}", self.code)

    def test_workflow_triggers_and_permissions(self):
        text = "\n".join(self.code)
        for needle in (
            "  workflow_run:",
            "    types: [completed]",
            "  workflow_dispatch:",
            "  contents: write",
            "  pull-requests: write",
            "  checks: read",
            "  statuses: read",
            "  actions: read",
            "github.event.workflow_run.conclusion == 'success'",
            "github.event.workflow_run.event == 'pull_request'",
            "github.ref_name == github.event.repository.default_branch",
        ):
            self.assertIn(needle, text)

    def test_no_concurrency_group_that_could_cancel_a_pending_merge(self):
        self.assertFalse([line for line in self.code if line.startswith("concurrency:")])

    def test_no_auto_merge_flag_anywhere(self):
        script = (ROOT / "scripts" / "automerge.py").read_text(encoding="utf-8")
        calls = [line for line in script.splitlines() if line.strip().startswith('"--')]
        self.assertNotIn('"--auto",', [line.strip() for line in calls])
        self.assertFalse([line for line in self.code if "--auto" in line])

    def test_every_job_runs_on_ubuntu_latest(self):
        for text in (self.ci, self.automerge):
            runners = [
                line.strip()
                for line in text.splitlines()
                if line.strip().startswith("runs-on:")
            ]
            self.assertTrue(runners)
            self.assertEqual(set(runners), {"runs-on: ubuntu-latest"})


if __name__ == "__main__":
    unittest.main()
