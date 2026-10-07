"""Проводка довоза: коммит авто-мержа доезжает до сайта по цепочке из трёх воркфлоу.

Automerge влил PR → catchup.yml сверил голову main с ревизией на хосте и
запустил CI на main → зелёный CI запустил deploy.yml. Каждое звено записано в
своём файле, и разойдись они — имя воркфлоу, имя файла, событие, — цепочка
рвётся молча: все прогоны зелёные, а сайт стоит на старой ревизии. Тесты на
`decide` (test_catchup.py) этого не видят: они зовут скрипт напрямую.

Вторая половина — то же, что в test_deploy_wiring.py: джоба `state` идёт на
раннере выката, и здесь проверяется, что кода репозитория в ней нет.

Запуск: python3 -m unittest discover -s scripts/tests -t .
"""
import os
import re
import subprocess
import sys
import unittest

from scripts import catchup
from scripts.tests.test_deploy_wiring import DEPLOY_LABEL, WORKFLOWS, code, top_level_block


def job(lines: list[str], name: str) -> list[str]:
    """Строки джобы `name` — до следующей джобы или конца файла."""
    start = lines.index(f"  {name}:")
    block = []
    for line in lines[start + 1:]:
        if re.fullmatch(r"  \S.*", line):
            break
        block.append(line)
    return block


def workflow_name(file: str) -> str:
    names = [line for line in code(WORKFLOWS / file) if line.startswith("name: ")]
    assert len(names) == 1, file
    return names[0].removeprefix("name: ")


class CatchupWiringCase(unittest.TestCase):
    def setUp(self):
        self.path = WORKFLOWS / "catchup.yml"
        self.lines = code(self.path)
        self.text = "\n".join(self.lines)
        self.state = job(self.lines, "state")
        self.dispatch = job(self.lines, "dispatch")

    def test_there_are_two_jobs(self):
        jobs = [line for line in top_level_block(self.lines, "jobs")
                if re.fullmatch(r"  \S.*", line)]
        self.assertEqual(jobs, ["  state:", "  dispatch:"])

    def test_triggers_are_automerge_and_a_manual_run_only(self):
        self.assertEqual(top_level_block(self.lines, "on"), [
            "  workflow_run:",
            "    workflows: [Automerge]",
            "    types: [completed]",
            "  workflow_dispatch:",
        ])
        # Слушается то имя, под которым automerge.yml знает GitHub.
        self.assertEqual(workflow_name("automerge.yml"), "Automerge")
        # Успешным прогон Automerge делает только его скрипт: шаг, которому
        # разрешено падать тихо, слал бы сюда `success` и после отказа.
        self.assertNotIn("continue-on-error", "\n".join(code(WORKFLOWS / "automerge.yml")))

    def test_no_workflow_with_other_triggers_carries_a_schedule(self):
        # Воркфлоу с расписанием GitHub отключает целиком после 60 дней без
        # активности — вместе с остальными триггерами. Расписание живёт в
        # своём файле, где отключать больше нечего.
        for path in sorted(WORKFLOWS.iterdir()):
            triggers = [line for line in top_level_block(code(path), "on")
                        if re.fullmatch(r"  \S.*", line)]
            if "  schedule:" in triggers:
                self.assertEqual(path.name, "catchup-schedule.yml")
                self.assertEqual(triggers, ["  schedule:"], path.name)

    def test_the_runner_job_takes_only_these_events(self):
        start = self.state.index("    if: >-")
        end = self.state.index(f"    runs-on: [{DEPLOY_LABEL}]")
        condition = " ".join(" ".join(self.state[start + 1:end]).split())
        self.assertEqual(
            condition,
            "(github.event_name == 'workflow_dispatch' && "
            "github.ref_name == github.event.repository.default_branch) || "
            "(github.event_name == 'workflow_run' && "
            "github.event.workflow_run.conclusion == 'success')",
        )

    def test_no_repository_code_reaches_the_runner(self):
        state = "\n".join(self.state)
        # Ни чекаута, ни чужого action, ни скрипта из репозитория: на машине
        # с ключами исполняется только текст этого шага.
        self.assertNotIn("uses:", state)
        self.assertEqual(len(re.findall(r"^      - ", state, flags=re.M)), 1)
        self.assertIn("      - name: Голова main и ревизия на хосте", self.state)
        for foreign in ("npm", "npx", "node", "python", "scripts/", "GITHUB_WORKSPACE",
                        "docker run", "git "):
            self.assertNotIn(foreign, state, foreign)
        # Данные события в команды не подставляются: единственные выражения в
        # джобе — условие, токен и выходы шага.
        body = state[state.index("        run: |"):]
        self.assertNotIn("${{", body)
        self.assertEqual(re.findall(r"\$\{\{ (.+?) \}\}", state), [
            "steps.compare.outputs.stale",
            "steps.compare.outputs.deployed",
            "github.token",
        ])

    def test_the_runner_job_can_only_read(self):
        permissions = [line.strip() for line in top_level_block(self.lines, "permissions")]
        self.assertEqual(permissions, ["contents: read"])
        self.assertNotIn("permissions:", "\n".join(self.state))
        self.assertNotIn("secrets.", self.text)

    def test_the_revision_is_read_the_way_the_deploy_reads_it(self):
        state = "\n".join(self.state)
        deploy = "\n".join(code(WORKFLOWS / "deploy.yml"))
        for line in (
            'inv="${KITES_INVENTORY_DIR:?на раннере не задан каталог инфраструктуры}"',
            "answer=$(docker compose run --rm -T inventory ansible kites_site \\",
            "-i inventory/hosts.yml -b -m ansible.builtin.command \\",
            "-a 'cat {{ kites_root }}/.deployed-revision')",
            "deployed=$(printf '%s\\n' \"${answer}\" | tr -d '\\r' "
            "| { grep -Ex '[0-9a-f]{40}' || true; } | sort -u)",
        ):
            self.assertIn(line, state)
            self.assertIn(line, deploy)
        # Плейбуков довоз не гоняет: с хоста он только читает.
        self.assertNotIn("ansible-playbook", self.text)
        self.assertEqual(self.text.count("docker compose run"), 1)

    def test_an_unread_revision_fails_the_run_instead_of_deploying(self):
        state = "\n".join(self.state)
        self.assertIn("          set -euo pipefail", self.state)
        # `[[ =~ ]]`, а не `grep -x`: grep сверяет построчно и две разные
        # ревизии в одном значении пропустил бы.
        for what in ("head", "deployed"):
            self.assertIn(
                '          if ! [[ "${' + what + '}" =~ ^[0-9a-f]{40}$ ]]; then\n', state)
            self.assertRegex(
                state,
                r'if ! \[\[ "\$\{' + what + r'\}" =~ \S+ \]\]; then\n.*\n\s+exit 1\n\s+fi')
        self.assertNotIn("grep -Eqx", state)
        self.assertEqual(self.text.count("|| true"), 1)
        for quiet in ("continue-on-error", "set +e", "always()", "failure()"):
            self.assertNotIn(quiet, self.text)
        # «Довозить» говорит только сравнение двух прочитанных sha.
        self.assertIn(
            '          if [ "${deployed}" = "${head}" ]; then\n'
            "            stale=false\n"
            "          else\n"
            "            stale=true\n"
            "          fi", state)
        self.assertEqual(self.text.count("stale=true"), 1)

    def test_the_verdict_of_the_runner_job_reaches_the_launching_job(self):
        # Любое из этих звеньев, названное иначе, оставляет выход пустым:
        # вторая джоба пропускается всегда, все прогоны зелёные, сайт стоит.
        self.assertIn("        id: compare", self.state)
        start = self.state.index("    outputs:")
        self.assertEqual(self.state[start + 1:start + 4], [
            "      stale: ${{ steps.compare.outputs.stale }}",
            "      deployed: ${{ steps.compare.outputs.deployed }}",
            "    steps:",
        ])
        self.assertIn(
            "          {\n"
            '            echo "stale=${stale}"\n'
            '            echo "deployed=${deployed}"\n'
            '          } >> "${GITHUB_OUTPUT}"', "\n".join(self.state))
        self.assertIn("    needs: state", self.dispatch)
        self.assertIn("    if: needs.state.outputs.stale == 'true'", self.dispatch)

    def test_the_runner_job_queues_apart_from_the_deploy(self):
        # В одной группе с выкатом сверка вытесняла бы ждущий выкат.
        self.assertIn(
            "    concurrency:\n      group: catch-up-state\n      cancel-in-progress: false",
            "\n".join(self.state))
        self.assertNotIn("group: kites-deploy", self.text)

    def test_nothing_local_is_written_into_the_workflow(self):
        raw = self.path.read_text(encoding="utf-8")
        for local in ("/home/", "$HOME", "~/"):
            self.assertNotIn(local, raw)

    def test_the_launching_job_runs_off_the_runner_and_only_when_stale(self):
        self.assertEqual(self.dispatch[:3], [
            "    needs: state",
            "    if: needs.state.outputs.stale == 'true'",
            "    runs-on: ubuntu-latest",
        ])
        dispatch = "\n".join(self.dispatch)
        self.assertNotIn(DEPLOY_LABEL, dispatch)
        self.assertIn(
            "    permissions:\n      contents: read\n      actions: write\n", dispatch)
        self.assertEqual(self.text.count("actions: write"), 1)
        # Право записи — у джобы, а не у всего воркфлоу: джоба на раннере
        # выката его не получает.
        self.assertLess(self.text.index("  dispatch:"), self.text.index("actions: write"))
        self.assertIn(
            "    concurrency:\n      group: catch-up-dispatch\n      cancel-in-progress: false",
            dispatch)

    def test_the_launching_job_runs_the_script_with_the_revision_from_the_host(self):
        dispatch = "\n".join(self.dispatch)
        # Чекаут без `ref`: на всех событиях этого воркфлоу это ветка по
        # умолчанию, и токен с правом запуска исполняет только код из main.
        self.assertIn(
            "      - uses: actions/checkout@v7\n"
            "        with:\n"
            "          persist-credentials: false\n", dispatch)
        self.assertNotIn("ref:", dispatch)
        self.assertEqual(self.text.count("uses:"), 1)
        self.assertIn("          DEPLOYED_REVISION: ${{ needs.state.outputs.deployed }}", dispatch)
        self.assertIn("          GH_TOKEN: ${{ github.token }}", self.dispatch)
        self.assertIn("        run: python3 -m scripts.catchup", self.dispatch)
        self.assertIn('os.environ.get("DEPLOYED_REVISION")',
                      (WORKFLOWS.parents[1] / "scripts" / "catchup.py").read_text("utf-8"))

    def test_the_command_of_the_workflow_runs_the_script_and_passes_its_verdict_on(self):
        # Та же команда, что в воркфлоу, из корня: модуль находится, `main`
        # исполняется, и его код возврата становится кодом процесса. Без
        # ревизии и без репозитория до сети дело не доходит — argparse
        # отвечает кодом 2.
        root = WORKFLOWS.parents[1]
        env = {key: value for key, value in os.environ.items()
               if key not in ("DEPLOYED_REVISION", "GITHUB_REPOSITORY")}
        for extra, needle in (
            ([], "нужен --repo"),
            (["--repo", "octo/repo"], "нужен --deployed"),
        ):
            done = subprocess.run(
                [sys.executable, "-m", "scripts.catchup", *extra],
                cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(done.returncode, 2, done.stderr)
            self.assertIn(needle, done.stderr)
        self.assertIn('\nif __name__ == "__main__":\n    sys.exit(main())\n',
                      (root / "scripts" / "catchup.py").read_text("utf-8"))


class ScheduleWiringCase(unittest.TestCase):
    """Почасовая страховка: расписание запускает довоз и больше ничего."""

    def setUp(self):
        self.lines = code(WORKFLOWS / "catchup-schedule.yml")
        self.text = "\n".join(self.lines)

    def test_the_schedule_knocks_once_an_hour(self):
        self.assertEqual(top_level_block(self.lines, "on"), [
            "  schedule:",
            '    - cron: "17 * * * *"',
        ])
        minute, hour, day, month, weekday = re.findall(r'cron: "([^"]+)"', self.text)[0].split()
        # Одна минута в час, и не нулевая: в начале часа расписание GitHub
        # запаздывает сильнее всего.
        self.assertRegex(minute, r"^[1-9][0-9]?$")
        self.assertEqual((hour, day, month, weekday), ("*", "*", "*", "*"))

    def test_it_launches_the_catch_up_on_the_default_branch(self):
        self.assertTrue((WORKFLOWS / "catchup.yml").is_file())
        self.assertIn(
            '          gh workflow run catchup.yml --repo "${GITHUB_REPOSITORY}" --ref "${branch}"',
            self.lines)
        self.assertIn(
            """          branch=$(gh api "repos/${GITHUB_REPOSITORY}" --jq '.default_branch')""",
            self.lines)
        self.assertIn("          set -euo pipefail", self.lines)
        self.assertIn("          GH_TOKEN: ${{ github.token }}", self.lines)
        # Довоз ручной запуск принимает — и только с ветки по умолчанию.
        catchup_lines = code(WORKFLOWS / "catchup.yml")
        self.assertIn("  workflow_dispatch:", top_level_block(catchup_lines, "on"))

    def test_it_stays_off_the_runner_and_can_only_launch(self):
        self.assertEqual([line for line in self.lines if "runs-on" in line],
                         ["    runs-on: ubuntu-latest"])
        permissions = [line.strip() for line in top_level_block(self.lines, "permissions")]
        self.assertEqual(permissions, ["actions: write"])
        for foreign in ("uses:", "secrets.", "continue-on-error", "docker", "ansible"):
            self.assertNotIn(foreign, self.text, foreign)


class ChainCase(unittest.TestCase):
    """Звенья после довоза: то, что он запускает, существует и довозит до выката."""

    def test_the_launched_workflows_exist_and_take_a_manual_run(self):
        for file in (catchup.CI_WORKFLOW_FILE, catchup.DEPLOY_WORKFLOW_FILE):
            triggers = top_level_block(code(WORKFLOWS / file), "on")
            self.assertIn("  workflow_dispatch:", triggers, file)

    def test_the_script_looks_for_ci_under_the_name_the_workflow_carries(self):
        self.assertEqual(workflow_name(catchup.CI_WORKFLOW_FILE), catchup.CI_WORKFLOW_NAME)

    def test_the_deploy_listens_to_that_ci_and_takes_a_manually_launched_run(self):
        lines = code(WORKFLOWS / catchup.DEPLOY_WORKFLOW_FILE)
        triggers = top_level_block(lines, "on")
        self.assertIn(f"    workflows: [{catchup.CI_WORKFLOW_NAME}]", triggers)
        text = "\n".join(lines)
        # CI, запущенный довозом, приходит событием workflow_dispatch: без
        # этой строки он зеленеет, а выкат его пропускает.
        self.assertIn("github.event.workflow_run.event == 'workflow_dispatch'", text)
        for event in catchup.BRANCH_EVENTS:
            self.assertIn(f"github.event.workflow_run.event == '{event}'", text)

    def test_the_deploy_accepts_the_ci_run_the_script_calls_green(self):
        # Ручной выкат, которым довозит скрипт, сам ищет зелёный CI на main —
        # тем же именем и той же веткой, что `decide`.
        text = "\n".join(code(WORKFLOWS / catchup.DEPLOY_WORKFLOW_FILE))
        self.assertIn(
            r'select(.name == \"CI\" and .head_branch == \"${DEFAULT_BRANCH}\")', text)


if __name__ == "__main__":
    unittest.main()
