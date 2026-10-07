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

- у головы main нет прогона CI на main — запустить CI, дождаться его и, если
  он зелёный, запустить выкат;
- прогон CI на main у головы зелёный, а на сайте не она — запустить выкат;
- CI на main у головы завершился и не зелёный — отказ, прогон красный.

Почему довоз ждёт свой CI сам. Завершение прогона, запущенного токеном
Actions, события workflow_run не порождает: CI позеленел бы, а выкат, который
слушает его завершение, так и не стартовал бы. Измерено на первом же мерже:
CI #37638111791 на main (workflow_dispatch от github-actions[bot]) завершился
зелёным, и ни Deploy, ни Automerge на него не отозвались. Поэтому за CI,
запущенным вручную (workflow_dispatch — им запускает и сам довоз), он следит
до конца и выкат запускает сам. За CI по пушу не следит: его завершение
запускает выкат обычным путём (deploy.yml принимает только `push`), и второй
запуск выложил бы ту же ревизию дважды.

Решение принимает `decide` — чистая функция от ответов API, без сети; тесты на
неё в scripts/tests/test_catchup.py. Всё остальное — доставка ответов через
`gh`, опрос и запуск воркфлоу.

Ревизию, выложенную на сайте, скрипт не читает: её читает с хоста джоба на
машине выката и передаёт сюда (`--deployed` или DEPLOYED_REVISION).

Код возврата. 0 — делать нечего, идёт чужая работа или выкат запущен. 1 —
CI на main красный или не завершился за время опроса, очередь выката за это
время не освободилась, ответ API неполон или не пришёл, запуск отклонён: без
человека голова main на сайт не попадёт.

Чего довоз не закрывает. Одна ревизия может выехать дважды: ревизию сайта
читает джоба до очереди, и довоз, ждавший в очереди за другим, может не
увидеть только что запущенный тем выкат. Повторный выкат той же ревизии
безвреден. Выкат запускается на ветке, а не на sha: влей кто-то PR в секунды
между решением и запуском — выкат возьмёт новую голову, не найдёт у неё
зелёного CI и покраснеет; её довезёт следующий довоз.

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
import time
from dataclasses import dataclass

from scripts.automerge import CI_WORKFLOW_NAME, gh_json, report

NOTHING = "nothing"
WAIT = "wait"
BUSY = "busy"
FOLLOW = "follow"
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

# Событие CI, завершение которого запускает выкат само: только его принимает
# условие джобы в deploy.yml. Совпадение держит test_catchup_wiring.py.
SELF_DEPLOYING_EVENT = "push"

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

    WAIT — идёт CI по пушу: он довезёт сам, следить незачем. FOLLOW — идёт
    CI, запущенный вручную: его завершение выката не запустит, и за ним надо
    проследить до конца. BUSY — CI зелёный, но очередь выката занята.
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
    active = [run for run in ci if run.get("status") != "completed"]
    # Хоть один идущий прогон по пушу: его завершение запустит выкат само, и
    # довоз, выкатив рядом с ним, выложил бы ту же ревизию дважды. Проверка
    # стоит раньше зелёного: зелёный близнец, запущенный вручную, этого не
    # отменяет.
    for run in active:
        if run.get("event") == SELF_DEPLOYING_EVENT:
            return Verdict(
                WAIT, f"CI #{run.get('id')} по пушу на {head[:8]} ещё идёт ({run.get('status')})"
            )
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
                return Verdict(BUSY, f"выкат #{run.get('id')} ещё идёт ({run.get('status')})")
        return Verdict(
            RUN_DEPLOY,
            f"CI на {base} у {head[:8]} зелёный, а на сайте {deployed[:8]}",
        )
    if active:
        run = active[0]
        return Verdict(
            FOLLOW,
            f"CI #{run.get('id')} на {head[:8]} запущен вручную и ещё идёт ({run.get('status')})",
        )
    # Завершились все, зелёного нет. Перезапускать нельзя: красный CI на том
    # же дереве красным и останется, а довоз запускал бы его на каждом заходе.
    ended = ", ".join(sorted({str(run.get("conclusion")) for run in ci}))
    return Verdict(STUCK, f"CI на {base} у {head[:8]} не зелёный ({ended})")


def snapshot(repo: str, base: str) -> tuple[str, dict, dict]:
    head = gh_json("api", f"repos/{repo}/commits/{base}")["sha"]
    # Прогоны именно воркфлоу CI, а не все на этом sha: довоз, авто-мерж и
    # выкат по workflow_run ложатся на голову main же, и за несколько суток
    # общий список перерос бы страницу.
    runs = gh_json(
        "api",
        f"repos/{repo}/actions/workflows/{CI_WORKFLOW_FILE}/runs?head_sha={head}&per_page=100",
    )
    deploys = gh_json(
        "api", f"repos/{repo}/actions/workflows/{DEPLOY_WORKFLOW_FILE}/runs?per_page=30"
    )
    return head, runs, deploys


def launch(repo: str, workflow: str, base: str) -> str | None:
    """Запустить воркфлоу на ветке по умолчанию. Возвращает текст отказа или None."""
    done = subprocess.run(
        ["gh", "workflow", "run", workflow, "--repo", repo, "--ref", base],
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        return (done.stderr or done.stdout).strip()
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument(
        "--deployed",
        default=os.environ.get("DEPLOYED_REVISION"),
        help="ревизия, выложенная на сайте",
    )
    # 40 опросов по 15 с — десять минут: столько CI отведено его собственным
    # timeout-minutes.
    parser.add_argument("--attempts", type=int, default=40)
    parser.add_argument("--interval", type=float, default=15.0, help="пауза между опросами, с")
    parser.add_argument("--dry-run", action="store_true", help="вынести вердикт и ничего не запускать")
    args = parser.parse_args(argv)

    if not args.repo or "/" not in args.repo:
        parser.error("нужен --repo OWNER/REPO или GITHUB_REPOSITORY")
    if not args.deployed:
        parser.error("нужен --deployed SHA или DEPLOYED_REVISION")

    try:
        base = gh_json("api", f"repos/{args.repo}")["default_branch"]
    except (subprocess.CalledProcessError, KeyError, ValueError) as error:
        detail = (getattr(error, "stderr", "") or str(error)).strip()
        report(f"Довоз не состоялся: не удалось узнать ветку по умолчанию ({detail}).")
        return 1

    followed: str | None = None  # голова, за чьим CI следим
    launched_ci = False
    head = ""
    reason = "опрос не начинался"
    for attempt in range(1, args.attempts + 1):
        try:
            # Голова читается на каждом опросе, а не берётся у вызвавшей
            # джобы: между чтением ревизии с хоста и этим шагом main мог уйти
            # вперёд.
            head, runs, deploys = snapshot(args.repo, base)
        except (subprocess.CalledProcessError, KeyError, ValueError) as error:
            # Разовый 502 посреди опроса — не повод бросать голову: следующая
            # попытка спросит заново. Молчание API согласием не считается.
            reason = "запрос к GitHub не удался: " + (
                getattr(error, "stderr", "") or str(error)
            ).strip()
            if args.dry_run:
                report(f"Довоз не состоялся: {reason}.")
                return 1
            verdict = Verdict(FOLLOW, reason)
        else:
            if followed and head != followed:
                # Влит следующий PR. Его довоз уже стоит в очереди за этим и
                # голову довезёт сам; выкатывать прежнюю незачем.
                report(f"Голова {base} ушла с {followed[:8]} на {head[:8]} — её довезёт следующий довоз.")
                return 0
            verdict = decide(head, args.deployed, runs, deploys, base=base)
            reason = verdict.reason
            if verdict.action == RUN_CI and launched_ci:
                # CI уже запущен этим же заходом, но в списке ещё не появился.
                verdict = Verdict(FOLLOW, f"запущенный CI на {head[:8]} ещё не виден в списке прогонов")
        print(f"[{attempt}/{args.attempts}] {verdict.action}: {verdict.reason}", flush=True)

        if verdict.action == STUCK:
            report(f"Довоз не состоялся: {verdict.reason}.")
            return 1
        if verdict.action in (NOTHING, WAIT) or (verdict.action == BUSY and followed is None):
            report(f"Запускать нечего: {verdict.reason}.")
            return 0
        if args.dry_run:
            what = {RUN_CI: f"{CI_WORKFLOW_FILE} не запущен",
                    RUN_DEPLOY: f"{DEPLOY_WORKFLOW_FILE} не запущен"}.get(verdict.action, "опроса нет")
            report(f"{verdict.reason}; --dry-run, {what}.")
            return 0
        if verdict.action == RUN_DEPLOY:
            refusal = launch(args.repo, DEPLOY_WORKFLOW_FILE, base)
            if refusal is not None:
                report(f"Довоз не состоялся: запуск {DEPLOY_WORKFLOW_FILE} отклонён: {refusal}")
                return 1
            report(f"{verdict.reason} — запущен {DEPLOY_WORKFLOW_FILE} на {base}.")
            return 0
        if verdict.action == RUN_CI:
            refusal = launch(args.repo, CI_WORKFLOW_FILE, base)
            if refusal is not None:
                report(f"Довоз не состоялся: запуск {CI_WORKFLOW_FILE} отклонён: {refusal}")
                return 1
            launched_ci = True
            report(f"{verdict.reason} — запущен {CI_WORKFLOW_FILE} на {base}, жду его завершения.")
        # RUN_CI и FOLLOW: дальше следим за CI этой головы. BUSY сюда доходит,
        # только когда мы уже следим: CI позеленел, но идёт выкат прежнего
        # коммита (два PR влиты подряд) — уйди довоз сейчас, эту голову до
        # расписания никто бы не повёз.
        if followed is None and SHA.fullmatch(head):
            followed = head
        if attempt < args.attempts:
            time.sleep(args.interval)

    report(f"Довоз не состоялся: за {args.attempts} опросов голова не довезена — {reason}.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
