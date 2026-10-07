"""Проводка гейта: CI гоняет ровно те команды, что `npm run gate`.

Локальный гейт и шаги ci.yml записаны в двух местах. Разойдись они — гейт
зелёный, а CI перестал что-то проверять (или наоборот), и ни один другой тест
этого не заметит.

Запуск: python3 -m unittest discover -s scripts/tests -t .
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class GateWiringCase(unittest.TestCase):
    def setUp(self):
        self.scripts = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["scripts"]
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.ci = [line for line in ci.splitlines() if not line.lstrip().startswith("#")]

    def gate_scripts(self) -> list[str]:
        parts = [part.strip() for part in self.scripts["gate"].split("&&")]
        for part in parts:
            self.assertRegex(part, r"^npm run [a-z:]+$")
        return [part.removeprefix("npm run ") for part in parts]

    def ci_scripts(self) -> list[str]:
        return [
            match.group(1)
            for line in self.ci
            if (match := re.fullmatch(r"\s+run: npm run ([a-z:]+)", line))
        ]

    def test_ci_steps_are_the_gate_in_the_same_order(self):
        self.assertEqual(self.ci_scripts(), self.gate_scripts())

    def test_gate_covers_lint_tests_build_and_the_built_site(self):
        gate = self.gate_scripts()
        for name in ("lint", "typecheck", "test", "test:automerge", "build", "check:export"):
            self.assertIn(name, gate)
            self.assertIn(name, self.scripts)
        # Собранное проверяется после сборки, а не до неё.
        self.assertLess(gate.index("build"), gate.index("check:export"))

    def test_no_step_is_allowed_to_fail_quietly(self):
        self.assertFalse([line for line in self.ci if "continue-on-error" in line])

    def test_ci_runs_on_pushes_to_main_too(self):
        text = "\n".join(self.ci)
        self.assertIn("\n  push:\n    branches: [main]\n", text)


if __name__ == "__main__":
    unittest.main()
