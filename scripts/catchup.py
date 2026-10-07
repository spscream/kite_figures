#!/usr/bin/env python3
"""Довезти голову main до сайта, если на сайте не она. Зовётся из .github/workflows/catchup.yml.

Зачем. Коммит, влитый авто-мержем, прогона CI на main не получает: мерж делает
токен Actions, а событие, порождённое этим токеном, воркфлоу не запускает.
Выкат слушает именно завершение CI на main — и не стартует. Из этого правила
у GitHub два исключения, workflow_dispatch и repository_dispatch: запуск
воркфлоу тем же токеном прогон создаёт. На этом и стоит довоз — секрет ему не
нужен.

Что делает. Сам ничего не выкатывает и на машину выката не попадает: он
запускает штатные воркфлоу, а выкатывает по-прежнему deploy.yml, со всеми
своими проверками.

- у головы main нет прогона CI на main — запустить CI; его зелёное завершение
  само запустит выкат;
- прогон CI на main у головы зелёный, а на сайте не она — запустить выкат;
- CI на main или выкат ещё идут — ничего не делать: придёт следующий запуск;
- CI на main у головы завершился и не зелёный — отказ, прогон красный.

Решение принимает `decide` — чистая функция от ответов API, без сети; тесты на
неё в scripts/tests/test_catchup.py. Всё остальное — доставка ответов через
`gh` и запуск воркфлоу.

Ревизию, выложенную на сайте, скрипт не читает: её читает с хоста джоба на
машине выката и передаёт сюда (`--deployed` или DEPLOYED_REVISION).

Код возврата. 0 — делать нечего, идёт чужая работа или воркфлоу запущен. 1 —
CI на main красный, ответ API неполон или не пришёл, запуск отклонён: без
человека голова main на сайт не попадёт.

Локальная проверка на настоящем репозитории, без запусков (модулем из корня:
общие с авто-мержем функции берутся из scripts/automerge.py):

    python3 -m scripts.catchup --repo OWNER/REPO --deployed SHA --dry-run
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass

from scripts.automerge import CI_WORKFLOW_NAME, gh_json, report

NOTHING = "nothing"
WAIT = "wait"
RUN_CI = "run-ci"
RUN_DEPLOY = "run-deploy"
STUCK = "stuck"

# Файлы воркфлоу, которые запускает довоз. Что они существуют и принимают
# ручной запуск, держит scripts/tests/test_catchup_wiring.py.
CI_WORKFLOW_FILE = "ci.yml"
DEPLOY_WORKFLOW_FILE = "deploy.yml"

# События, прогон CI по которым проверял саму ветку main, а не PR в неё.
# pull_request сюда не входит: PR из ветки с именем main — тоже head_branch
# «main».
BRANCH_EVENTS = frozenset({"push", "workflow_dispatch"})

SHA = re.compile(r"[0-9a-f]{40}")


@dataclass
class Verdict:
    action: str
    reason: str


def decide(head: str, deployed: str, runs: dict, deploys: dict, *, base: str) -> Verdict:
    """Что делать с головой main при таком срезе состояния.

    `head` — sha головы `base`; `deployed` — ревизия, выложенная на сайте;
    `runs` — прогоны воркфлоу CI на этом sha,
    /actions/workflows/ci.yml/runs?head_sha=HEAD; `deploys` — последние
    прогоны воркфлоу выката, /actions/workflows/deploy.yml/runs.
    """
    if not SHA.fullmatch(head):
        return Verdict(STUCK, f"голова {base} — не sha: «{head[:60]}»")
    if not SHA.fullmatch(deployed):
        return Verdict(STUCK, f"ревизия на сайте — не sha: «{deployed[:60]}»")
    if head == deployed:
        return Verdict(NOTHING, f"на сайте голова {base} {head[:8]}")

    all_runs = runs.get("workflow_runs")
    total = runs.get("total_count")
    if not isinstance(all_runs, list) or not isinstance(total, int) or total > len(all_runs):
        # «Прогона CI нет» на неполном списке утверждать нечем.
        got = len(all_runs) if isinstance(all_runs, list) else 0
        return Verdict(STUCK, f"список прогонов на {head[:8]} неполон: пришло {got} из {total}")
    ci = [
        run for run in all_runs
        if run.get("name") == CI_WORKFLOW_NAME
        and run.get("head_branch") == base
        and run.get("event") in BRANCH_EVENTS
    ]
    if not ci:
        # Идущий выкат этому не помеха: он чужого коммита, а CI ему не мешает.
        return Verdict(RUN_CI, f"у головы {base} {head[:8]} нет прогона CI на {base}")
    if any(run.get("status") == "completed" and run.get("conclusion") == "success" for run in ci):
        # Идущий выкат — любого коммита: очередь у выката одна, и запущенный
        # поверх неё второй выложил бы ту же ревизию дважды. Смотрим только
        # на незавершённые, а они в списке первые; завершённым верить нечему
        # — зелёный выкат бывает и пропуском (коммит уже не голова), а
        # красный надо повторить.
        all_deploys = deploys.get("workflow_runs")
        if not isinstance(all_deploys, list):
            return Verdict(STUCK, "в ответе о прогонах выката нет списка")
        for run in all_deploys:
            if run.get("status") != "completed":
                return Verdict(WAIT, f"выкат #{run.get('id')} ещё идёт ({run.get('status')})")
        return Verdict(
            RUN_DEPLOY,
            f"CI на {base} у {head[:8]} зелёный, а на сайте {deployed[:8]}",
        )
    for run in ci:
        if run.get("status") != "completed":
            return Verdict(WAIT, f"CI #{run.get('id')} на {head[:8]} ещё идёт ({run.get('status')})")
    # Завершились все, зелёного нет. Перезапускать нельзя: красный CI на том
    # же дереве красным и останется, а довоз запускал бы его на каждом заходе.
    ended = ", ".join(sorted({str(run.get("conclusion")) for run in ci}))
    return Verdict(STUCK, f"CI на {base} у {head[:8]} не зелёный ({ended})")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument(
        "--deployed",
        default=os.environ.get("DEPLOYED_REVISION"),
        help="ревизия, выложенная на сайте",
    )
    parser.add_argument("--dry-run", action="store_true", help="вынести вердикт и ничего не запускать")
    args = parser.parse_args(argv)

    if not args.repo or "/" not in args.repo:
        parser.error("нужен --repo OWNER/REPO или GITHUB_REPOSITORY")
    if not args.deployed:
        parser.error("нужен --deployed SHA или DEPLOYED_REVISION")

    try:
        base = gh_json("api", f"repos/{args.repo}")["default_branch"]
        # Голова читается здесь, а не берётся у вызвавшей джобы: между чтением
        # ревизии с хоста и этим шагом main мог уйти вперёд.
        head = gh_json("api", f"repos/{args.repo}/commits/{base}")["sha"]
        # Прогоны именно воркфлоу CI, а не все на этом sha: довоз, авто-мерж
        # и выкат по workflow_run и расписанию ложатся на голову main же, и
        # за несколько суток общий список перерос бы страницу.
        runs = gh_json(
            "api",
            f"repos/{args.repo}/actions/workflows/{CI_WORKFLOW_FILE}/runs"
            f"?head_sha={head}&per_page=100",
        )
        deploys = gh_json(
            "api", f"repos/{args.repo}/actions/workflows/{DEPLOY_WORKFLOW_FILE}/runs?per_page=30"
        )
    except (subprocess.CalledProcessError, KeyError, ValueError) as error:
        detail = (getattr(error, "stderr", "") or str(error)).strip()
        report(f"Довоз не состоялся: запрос к GitHub не удался ({detail}).")
        return 1

    verdict = decide(head, args.deployed, runs, deploys, base=base)
    if verdict.action == STUCK:
        report(f"Довоз не состоялся: {verdict.reason}.")
        return 1
    if verdict.action in (NOTHING, WAIT):
        report(f"Запускать нечего: {verdict.reason}.")
        return 0

    workflow = CI_WORKFLOW_FILE if verdict.action == RUN_CI else DEPLOY_WORKFLOW_FILE
    if args.dry_run:
        report(f"{verdict.reason}; --dry-run, {workflow} не запущен.")
        return 0
    launch = subprocess.run(
        ["gh", "workflow", "run", workflow, "--repo", args.repo, "--ref", base],
        capture_output=True,
        text=True,
    )
    if launch.returncode != 0:
        report(f"Довоз не состоялся: запуск {workflow} отклонён: "
               f"{(launch.stderr or launch.stdout).strip()}")
        return 1
    report(f"{verdict.reason} — запущен {workflow} на {base}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
