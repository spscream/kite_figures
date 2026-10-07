"""Проводка выката: кто и когда попадает на свой раннер.

Репозиторий публичный, а выкат идёт на раннере, рядом с которым лежат ключи
инфраструктуры. Всё, что здесь проверяется, — условия, при которых на эту
машину попадает код: ослабить любое из них значит дать её чужому коду.
Воркфлоу читаются текстом: yaml в стандартную библиотеку не входит. Поэтому
проверки строгие к форме записи — другая форма того же самого здесь красная,
и это нарочно: незнакомую форму тест прочитать не может.

Чего этот тест НЕ держит: на событии pull_request GitHub берёт воркфлоу из
ветки PR, и PR, вписавший метку раннера в ci.yml, исполнится раньше, чем
кто-либо увидит красный тест. От этого защищает настройка одобрения запусков
в репозитории, а не код.

Запуск: python3 -m unittest discover -s scripts/tests -t .
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
DEPLOY_LABEL = "kites-deploy"
# Довоз (catchup.yml) — второй и последний воркфлоу с джобой на раннере
# выката: она читает с хоста выложенную ревизию. Что кода репозитория в ней
# нет, держит test_catchup_wiring.py.
CATCHUP = "catchup.yml"
HEAD_ONLY = "steps.head.outputs.deploy == 'true'"


def workflows() -> list[Path]:
    return sorted(p for p in WORKFLOWS.iterdir() if p.suffix in (".yml", ".yaml"))


def code(path: Path) -> list[str]:
    """Строки воркфлоу без комментариев."""
    return [
        line for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def top_level_block(lines: list[str], key: str) -> list[str]:
    """Строки блока верхнего уровня `key:` — до следующего ключа без отступа."""
    start = lines.index(f"{key}:")
    block = []
    for line in lines[start + 1:]:
        if not line.startswith(" "):
            break
        block.append(line)
    return block


def steps(lines: list[str]) -> list[list[str]]:
    """Шаги джобы: каждый — свои строки, первая начинается с `      - `."""
    start = lines.index("    steps:")
    found: list[list[str]] = []
    for line in lines[start + 1:]:
        if line.startswith("      - "):
            found.append([line])
        else:
            found[-1].append(line)
    return found


class DeployWiringCase(unittest.TestCase):
    def setUp(self):
        self.path = WORKFLOWS / "deploy.yml"
        self.lines = code(self.path)
        self.text = "\n".join(self.lines)
        self.steps = steps(self.lines)

    def step(self, title: str) -> str:
        found = [s for s in self.steps if s[0] == f"      - {title}"]
        self.assertEqual(len(found), 1, title)
        return "\n".join(found[0])

    def test_only_the_deploy_and_the_catch_up_leave_hosted_runners(self):
        self.assertIn(self.path, workflows())
        own = f"    runs-on: [{DEPLOY_LABEL}]"
        hosted = "    runs-on: ubuntu-latest"
        for path in workflows():
            if path == self.path:
                expected = [own]
            elif path.name == CATCHUP:
                expected = [own, hosted]
            else:
                expected = None
            # Только однострочная форма: список меток на следующих строках
            # этот тест не прочитал бы.
            mentions = [line for line in code(path) if "runs-on" in line]
            self.assertTrue(mentions, path.name)
            if expected is None:
                self.assertEqual(set(mentions), {hosted}, path.name)
            else:
                self.assertEqual(mentions, expected, path.name)

    def test_the_label_is_named_nowhere_else(self):
        self.assertIn(CATCHUP, [path.name for path in workflows()])
        for path in workflows():
            if path == self.path or path.name == CATCHUP:
                continue
            text = "\n".join(code(path))
            self.assertNotIn(DEPLOY_LABEL, text, path.name)
            self.assertNotIn("self-hosted", text, path.name)

    def test_there_is_one_job(self):
        jobs = [line for line in top_level_block(self.lines, "jobs")
                if re.fullmatch(r"  \S.*", line)]
        self.assertEqual(jobs, ["  deploy:"])
        self.assertEqual(self.text.count("runs-on"), 1)

    def test_triggers_are_ci_on_main_and_a_manual_run_only(self):
        triggers = top_level_block(self.lines, "on")
        self.assertEqual(triggers, [
            "  workflow_run:",
            "    workflows: [CI]",
            "    types: [completed]",
            "    branches: [main]",
            "  workflow_dispatch:",
        ])

    def test_the_job_takes_only_a_green_push_run_of_this_repository(self):
        start = self.lines.index("    if: >-")
        end = self.lines.index(f"    runs-on: [{DEPLOY_LABEL}]")
        self.assertLess(start, end)
        condition = " ".join(" ".join(self.lines[start + 1:end]).split())
        # Условия одного пути связаны через `&&`: `||` между ними пустил бы
        # прогон по PR. Единственное `||` — между ручным путём и автоматическим.
        self.assertEqual(
            condition,
            "(github.event_name == 'workflow_dispatch' && "
            "github.ref_name == github.event.repository.default_branch) || "
            "(github.event_name == 'workflow_run' && "
            "github.event.workflow_run.conclusion == 'success' && "
            "github.event.workflow_run.event == 'push' && "
            "github.event.workflow_run.head_repository.full_name == github.repository)",
        )

    def test_the_steps_are_exactly_these(self):
        self.assertEqual([s[0].strip() for s in self.steps], [
            "- name: Коммит — голова main",
            "- name: Ручной запуск — у коммита есть зелёный прогон CI",
            "- uses: actions/checkout@v7",
            "- name: Собрать статику",
            "- name: Выложить сборку плейбуком",
            "- name: Ревизия на хосте — та, что выкатывали",
        ])
        # Чужого кода в джобе — один чекаут: ни второго action, ни локального.
        self.assertEqual(self.text.count("uses:"), 1)

    def test_only_the_head_of_main_is_deployed(self):
        # Первый шаг — до чекаута, и условия у него нет: он решает за остальных.
        head = self.step("name: Коммит — голова main")
        self.assertNotIn("        if:", head)
        self.assertIn("        id: head", head)
        # База — main, голова — выкатываемый sha: в обратном порядке `behind`
        # означал бы чужую ветку, ушедшую вперёд main.
        self.assertIn(
            'status=$(gh api "repos/${GITHUB_REPOSITORY}/compare/${DEFAULT_BRANCH}...${DEPLOY_SHA}"'
            " --jq '.status')", head)
        self.assertIn("DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}", self.text)
        branches = re.findall(r"^            (\S+)\)$", head, flags=re.M)
        self.assertEqual(branches, ["identical", "behind", "*"])
        identical, behind, other = re.split(r"^            \S+\)$", head, flags=re.M)[1:]
        self.assertIn('echo "deploy=true" >> "${GITHUB_OUTPUT}"', identical)
        # Коммит в истории main, но не голова, — пропуск, а не выкат: иначе
        # опоздавший прогон откатил бы сайт назад.
        self.assertIn('echo "deploy=false" >> "${GITHUB_OUTPUT}"', behind)
        self.assertNotIn("deploy=true", behind + other)
        self.assertIn("exit 1", other)
        self.assertEqual(self.text.count("deploy=true"), 1)

    def test_every_later_step_waits_for_the_head_check(self):
        conditions = []
        for lines in self.steps[1:]:
            own = [line.strip() for line in lines if line.startswith("        if:")]
            self.assertEqual(len(own), 1, lines[0])
            conditions.append(own[0])
        manual = f"if: {HEAD_ONLY} && github.event_name == 'workflow_dispatch'"
        self.assertEqual(conditions, [manual] + [f"if: {HEAD_ONLY}"] * 4)
        # Других `if:` в файле нет — только условие джобы и эти пять.
        self.assertEqual(len(re.findall(r"^\s+if:", self.text, flags=re.M)), 6)

    def test_a_manual_run_needs_a_green_ci_run_on_main(self):
        manual = self.step("name: Ручной запуск — у коммита есть зелёный прогон CI")
        # Прогоны самого CI, страницей в 100: в общем списке на этом sha
        # зелёный CI вытеснили бы прогоны довоза, авто-мержа и выката.
        self.assertIn(
            '"repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs'
            '?head_sha=${DEPLOY_SHA}&status=success&per_page=100"', manual)
        self.assertIn(r'select(.name == \"CI\" and .head_branch == \"${DEFAULT_BRANCH}\")', manual)
        self.assertRegex(manual, r'if \[ "\$\{green:-0\}" = "0" \]; then\n.*\n\s+exit 1\n\s+fi')

    def test_the_deployed_commit_is_the_one_ci_ran_on(self):
        self.assertIn(
            "DEPLOY_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}", self.text)
        checkout = self.step("uses: actions/checkout@v7")
        self.assertEqual(checkout.splitlines()[2:], [
            "        with:",
            "          ref: ${{ env.DEPLOY_SHA }}",
            "          persist-credentials: false",
        ])
        self.assertIn('-e "kites_expected_rev=${DEPLOY_SHA}"', self.text)

    def test_repository_code_runs_only_inside_the_build_container(self):
        # npm за пределами `docker run` исполнял бы код репозитория от
        # пользователя раннера, рядом с ключами.
        build = self.step("name: Собрать статику")
        touching = [line for line in self.lines
                    if re.search(r"\b(npm|npx|node|yarn|pnpm)\b", line)]
        self.assertEqual(len(touching), 2)
        self.assertEqual(touching[0].strip(), "node:22-bookworm-slim \\")
        self.assertRegex(touching[1].strip(), r"^sh -ec '[^']+' \\$")
        for line in touching:
            self.assertIn(line, build)
        self.assertEqual(self.text.count("docker run"), 1)
        run = build[build.index("docker run"):build.index("node:22-bookworm-slim")]
        # Чекаут — только на чтение: в нём .git, а следующий прогон исполняет
        # его хуки и конфиг уже на самой машине. Другого монтирования нет.
        self.assertEqual(re.findall(r"(?<!\S)-v \S+", run), ['-v "${GITHUB_WORKSPACE}:/src:ro"'])
        self.assertIn("docker run --rm --init", build)
        self.assertIn("timeout -k 30 900 docker run", build)
        # Контейнеру не достаётся ни токен, ни сокет докера, ни сеть хоста.
        for leaked in ("GH_TOKEN", "GITHUB_TOKEN", "docker.sock", "--privileged", "--mount",
                       "--volume", "--volumes-from", "--network", "--net", "--pid",
                       "--cap-add", "--device", "--env-file", "${HOME}", "$HOME"):
            self.assertNotIn(leaked, run, leaked)
        self.assertEqual(re.findall(r"(?<!\S)-e (\S+)", run),
                         ["HOME=/tmp/home", "NEXT_TELEMETRY_DISABLED=1"])

    def test_the_build_leaves_the_container_as_plain_files_only(self):
        build = self.step("name: Собрать статику")
        self.assertIn("--exclude=./.git", build)
        self.assertIn('out="${RUNNER_TEMP}/kites-out"', build)
        self.assertIn('tar -xf "${out}.tar" -C "${out}" --no-same-owner --no-same-permissions',
                      build)
        # Симлинк из сборки веб-сервер отдал бы как файл, на который он указывает.
        self.assertRegex(
            build,
            r'if find "\$\{out\}" ! -type f ! -type d \| grep -q \.; then\n.*\n\s+exit 1\n\s+fi')
        self.assertLess(build.index("! -type f ! -type d"), build.index("/.revision"))
        self.assertIn("printf '%s\\n' \"${DEPLOY_SHA}\" > \"${out}/.revision\"", build)
        # Плейбуку отдаётся этот каталог, а не что-то из чекаута.
        self.assertIn('KITES_OUT="${RUNNER_TEMP}/kites-out" docker compose run', self.text)
        self.assertNotIn("${GITHUB_WORKSPACE}/out", self.text)

    def test_the_build_is_checked_like_ci_checks_it(self):
        self.assertIn(
            "npm --prefix /tmp/build ci --no-audit --no-fund && "
            "npm --prefix /tmp/build run build && "
            "npm --prefix /tmp/build run check:export", self.text)

    def test_the_token_can_only_read(self):
        permissions = [line.strip() for line in top_level_block(self.lines, "permissions")]
        self.assertEqual(permissions, ["contents: read", "actions: read"])
        self.assertEqual(self.text.count("permissions:"), 1)
        self.assertNotIn("secrets.", self.text)

    def test_deploys_queue_instead_of_cancelling_each_other(self):
        self.assertIn(
            "    concurrency:\n      group: kites-deploy\n      cancel-in-progress: false",
            self.text)

    def test_the_run_fails_unless_the_host_reports_the_deployed_commit(self):
        check = self.step("name: Ревизия на хосте — та, что выкатывали")
        self.assertIn(".deployed-revision", check)
        self.assertRegex(
            check,
            r'if \[ "\$\{deployed\}" != "\$\{DEPLOY_SHA\}" \]; then\n.*\n\s+exit 1\n\s+fi')
        # Ответ читается отдельной командой: её сбой роняет шаг, а не
        # превращается в «ревизия не прочитана». `|| true` — только у grep,
        # которому нечего найти.
        self.assertIn("answer=$(docker compose run --rm -T inventory ansible kites_site", check)
        self.assertEqual(self.text.count("|| true"), 1)
        self.assertIn("{ grep -Ex '[0-9a-f]{40}' || true; } | sort -u", check)

    def test_no_step_may_fail_quietly(self):
        for quiet in ("continue-on-error", "clean: false", "set +e", "always()", "failure()"):
            self.assertNotIn(quiet, self.text)
        for lines in self.steps:
            body = "\n".join(lines)
            if "run: |" in body:
                self.assertIn("          set -euo pipefail", lines, lines[0])

    def test_nothing_local_is_written_into_the_workflow(self):
        # Каталог инфраструктуры называет окружение раннера, а не этот файл.
        raw = self.path.read_text(encoding="utf-8")
        self.assertEqual(raw.count("${KITES_INVENTORY_DIR:?"), 2)
        for local in ("/home/", "$HOME", "~/"):
            self.assertNotIn(local, raw)


if __name__ == "__main__":
    unittest.main()
