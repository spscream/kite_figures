#!/usr/bin/env python3
"""Сквош-мерж PR, если он прошёл все условия. Зовётся из .github/workflows/automerge.yml.

Условия, при которых PR вливается, и ни одним меньше:

1. PR открыт владельцем репозитория, и голова ветки лежит в этом же
   репозитории (не форк).
2. Все проверки на голове PR завершились и все зелёные.
3. GitHub считает PR mergeable, и mergeStateStatus равен CLEAN.
4. PR не черновик и не несёт метки `hold`.

Решение принимает `judge` — чистая функция от ответов API, без сети; на ней и
на `main` стоят тесты в scripts/tests/test_automerge.py. Всё остальное в файле
— доставка этих ответов через `gh` и сам мерж.

Две вещи, ради которых файл устроен именно так:

- mergeStateStatus около минуты после любого мержа в базовую ветку отдаёт
  UNKNOWN. Поэтому состояние читается не один раз, а опрашивается с паузой
  (`--attempts`, `--interval`); UNKNOWN — «подождать», а не «отказать».
- `gh pr merge --auto` проверок не ждёт. Здесь его нет: проверки читаются
  самим скриптом, а мерж идёт обычным `gh pr merge --squash` с
  `--match-head-commit` — если голова успела уйти вперёд проверенной, GitHub
  откажет, а не вольёт непроверенное.

Код возврата. 0 — PR влит, либо не влит по причине, которая и есть штатная
работа воркфлоу (черновик, метка hold, чужой PR, голова ушла вперёд — придёт
новый CI). 1 — всё остальное: красная или отменённая проверка, конфликт, не
дождались CLEAN, API не ответил, GitHub отклонил мерж. Такой PR без человека
не сдвинется, и прогон обязан быть красным. Ручной запуск красный при любом
отказе: зелёный прогон, который ничего не влил, в списке неотличим от влившего.

Локальная проверка на настоящем PR, без мержа:

    python3 scripts/automerge.py --repo OWNER/REPO --pr N --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field

MERGE = "merge"
WAIT = "wait"
REFUSE = "refuse"

# Чем может закончиться проверка, чтобы считаться зелёной. `skipped` — джоба,
# отключённая собственным `if`; `neutral` GitHub тоже не считает провалом.
GREEN = frozenset({"success", "neutral", "skipped"})

# Состояния, которые не пройдут сами: ждать их бессмысленно.
DEAD_MERGE_STATES = frozenset({"DIRTY", "BLOCKED", "BEHIND", "DRAFT"})

HOLD_LABEL = "hold"
CI_WORKFLOW_NAME = "CI"

PR_FIELDS = (
    "number,title,state,isDraft,author,isCrossRepository,headRepositoryOwner,"
    "headRefOid,baseRefName,labels,mergeable,mergeStateStatus"
)


@dataclass
class Verdict:
    decision: str
    reasons: list[str] = field(default_factory=list)
    # Только для REFUSE: среди причин есть штатная (см. «Код возврата») — PR
    # придержан намеренно, и красить прогон незачем.
    routine: bool = False


def _login(node: object) -> str:
    return node.get("login") or "" if isinstance(node, dict) else ""


def judge(
    pr: dict,
    check_runs: dict,
    status: dict,
    runs: dict,
    *,
    owner: str,
    base: str,
    expected_head: str | None = None,
) -> Verdict:
    """Вердикт по одному срезу состояния PR.

    `pr` — `gh pr view --json PR_FIELDS`; `check_runs`, `status`, `runs` —
    ответы REST по голове PR: /commits/SHA/check-runs, /commits/SHA/status,
    /actions/runs?head_sha=SHA. `base` — ветка по умолчанию.

    REFUSE — условие нарушено и само не исправится. WAIT — пока не выполнено,
    но может выполниться (проверки идут, GitHub ещё считает mergeability).
    MERGE — выполнены все четыре.
    """
    routine: list[str] = []
    broken: list[str] = []
    wait: list[str] = []

    # --- 1. Кто открыл, откуда ветка и куда она идёт ----------------------
    if pr.get("state") != "OPEN":
        routine.append(f"PR не открыт (state={pr.get('state')})")
    author = _login(pr.get("author"))
    if author != owner:
        routine.append(f"PR открыт «{author}», а не владельцем репозитория «{owner}»")
    head_owner = _login(pr.get("headRepositoryOwner"))
    # `is not False`: отсутствующее поле — отказ, а не «видимо, не форк».
    if pr.get("isCrossRepository") is not False or head_owner != owner:
        routine.append(
            f"голова ветки лежит не в этом репозитории (владелец головы «{head_owner}»)"
        )
    if pr.get("baseRefName") != base:
        routine.append(f"PR идёт в «{pr.get('baseRefName')}», а не в «{base}»")

    # --- 4. Черновик и метка hold -----------------------------------------
    if pr.get("isDraft") is not False:
        routine.append("PR — черновик")
    labels = pr.get("labels")
    if not isinstance(labels, list):
        # Без списка меток «hold нет» утверждать нечем.
        broken.append("в ответе о PR нет списка меток")
    elif HOLD_LABEL in {(label.get("name") or "").lower() for label in labels}:
        routine.append(f"на PR метка «{HOLD_LABEL}»")

    head = pr.get("headRefOid") or ""
    if not head:
        broken.append("у PR нет headRefOid")
    elif expected_head and head != expected_head:
        routine.append(f"голова PR {head[:8]} ушла вперёд проверенной {expected_head[:8]}")

    # --- 2. Проверки на голове --------------------------------------------
    # В счёт идёт всё, что висит на голове: исключений «для своих» нет.
    # Прогоны этого воркфлоу по workflow_run и ручные с ветки по умолчанию
    # ложатся на коммит main, а не на голову PR; ручной запуск с ветки PR
    # отключён в automerge.yml — он повесил бы на голову собственную
    # проверку, и GitHub перестал бы отдавать CLEAN.
    all_runs = runs.get("workflow_runs") or []
    all_checks = check_runs.get("check_runs") or []
    all_statuses = status.get("statuses") or []
    # Ответы читаются одной страницей в 100 записей. Если GitHub говорит, что
    # записей больше, чем пришло, «все зелёные» утверждать нечем.
    for what, total, got in (
        ("прогонов воркфлоу", runs.get("total_count"), len(all_runs)),
        ("check-run'ов", check_runs.get("total_count"), len(all_checks)),
        ("commit-статусов", status.get("total_count"), len(all_statuses)),
    ):
        if not isinstance(total, int) or total > got:
            broken.append(f"список {what} неполон: пришло {got} из {total}")

    for run in all_runs:
        label = f"прогон «{run.get('name')}» #{run.get('id')}"
        if run.get("status") != "completed":
            wait.append(f"{label} не завершён ({run.get('status')})")
        elif run.get("conclusion") not in GREEN:
            # Отменённый прогон остаётся на голове навсегда, даже если рядом
            # есть зелёный близнец: перезапустить его или запушить коммит.
            broken.append(f"{label} — {run.get('conclusion')}")
    # Требуется именно CI по событию pull_request: «нет ни одной красной
    # проверки» выполняется и на коммите, который никто не проверял.
    if not any(
        run.get("name") == CI_WORKFLOW_NAME
        and run.get("event") == "pull_request"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        for run in all_runs
    ):
        wait.append(
            f"на голове {head[:8]} нет зелёного прогона «{CI_WORKFLOW_NAME}» по pull_request"
        )

    if not all_checks:
        wait.append(f"на голове {head[:8]} нет ни одной проверки")
    for check in all_checks:
        label = f"проверка «{check.get('name')}»"
        if check.get("status") != "completed":
            wait.append(f"{label} не завершена ({check.get('status')})")
        elif check.get("conclusion") not in GREEN:
            broken.append(f"{label} — {check.get('conclusion')}")

    for commit_status in all_statuses:
        label = f"статус «{commit_status.get('context')}»"
        state = commit_status.get("state")
        if state == "pending":
            wait.append(f"{label} не завершён")
        elif state != "success":
            broken.append(f"{label} — {state}")

    # --- 3. Mergeable и CLEAN ---------------------------------------------
    mergeable = pr.get("mergeable")
    if mergeable == "CONFLICTING":
        broken.append("конфликт с базовой веткой (mergeable=CONFLICTING)")
    elif mergeable != "MERGEABLE":
        wait.append(f"GitHub ещё не посчитал mergeable ({mergeable})")
    merge_state = pr.get("mergeStateStatus")
    if merge_state in DEAD_MERGE_STATES:
        # У черновика DRAFT — то же самое «PR — черновик», а не поломка.
        if not (merge_state == "DRAFT" and pr.get("isDraft") is True):
            broken.append(f"mergeStateStatus={merge_state}")
    elif merge_state != "CLEAN":
        wait.append(f"mergeStateStatus={merge_state}, нужен CLEAN")

    if routine or broken:
        return Verdict(REFUSE, routine + broken, routine=bool(routine))
    if wait:
        return Verdict(WAIT, wait)
    return Verdict(MERGE, [])


def target_from_event(env: dict) -> tuple[int | None, str | None, str]:
    """Номер PR и проверенная голова из окружения джобы.

    Возвращает (номер, sha или None, причина). Номер None — мержить нечего.
    """
    if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        raw = env.get("INPUT_PR") or ""
        # Номер приходит из поля ввода и уезжает в аргументы `gh`.
        if not re.fullmatch(r"[0-9]+", raw):
            return None, None, f"«{raw}» — не номер PR"
        return int(raw), None, "ручной запуск"
    try:
        pulls = json.loads(env.get("PULL_REQUESTS") or "[]") or []
    except json.JSONDecodeError:
        return None, None, "PULL_REQUESTS — не JSON"
    sha = env.get("RUN_HEAD_SHA") or ""
    if len(pulls) != 1 or not isinstance(pulls[0].get("number"), int):
        return None, None, f"прогон CI привязан не к одному PR этого репозитория ({len(pulls)})"
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        return None, None, "у прогона CI нет head_sha"
    return pulls[0]["number"], sha, "завершился CI"


def gh_json(*args: str) -> dict:
    out = subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def snapshot(repo: str, number: int) -> tuple[dict, dict, dict, dict]:
    pr = gh_json("pr", "view", str(number), "--repo", repo, "--json", PR_FIELDS)
    head = pr.get("headRefOid") or ""
    if not re.fullmatch(r"[0-9a-f]{40}", head):
        return pr, {}, {}, {}
    check_runs = gh_json("api", f"repos/{repo}/commits/{head}/check-runs?per_page=100")
    status = gh_json("api", f"repos/{repo}/commits/{head}/status?per_page=100")
    runs = gh_json("api", f"repos/{repo}/actions/runs?head_sha={head}&per_page=100")
    return pr, check_runs, status, runs


def report(text: str) -> None:
    print(text, flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(text + "\n\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY"))
    parser.add_argument("--pr", type=int, help="номер PR; без него берётся из события джобы")
    parser.add_argument("--expected-head", help="sha, на котором проверки были зелёными")
    parser.add_argument("--attempts", type=int, default=12)
    parser.add_argument("--interval", type=float, default=15.0, help="пауза между опросами, с")
    parser.add_argument("--dry-run", action="store_true", help="вынести вердикт и не мержить")
    args = parser.parse_args(argv)

    if not args.repo or "/" not in args.repo:
        parser.error("нужен --repo OWNER/REPO или GITHUB_REPOSITORY")
    owner = args.repo.split("/", 1)[0]
    manual = os.environ.get("GITHUB_EVENT_NAME") != "workflow_run"

    number, expected_head = args.pr, args.expected_head
    if number is None:
        number, expected_head, why = target_from_event(dict(os.environ))
        if number is None:
            # Сюда джоба доходит, только если фильтр в automerge.yml уже
            # сказал «зелёный CI по PR этого репозитория». PR при этом не
            # нашёлся — это не штатный отказ, а потерянный мерж.
            report(f"Не мержим: {why}.")
            return 1
        report(f"PR #{number}: {why}.")

    try:
        base = gh_json("api", f"repos/{args.repo}")["default_branch"]
    except (subprocess.CalledProcessError, KeyError, ValueError) as error:
        report(f"PR #{number} не влит: не удалось узнать ветку по умолчанию ({error}).")
        return 1

    verdict = Verdict(WAIT, ["опрос не начинался"])
    pr: dict = {}
    for attempt in range(1, args.attempts + 1):
        try:
            pr, check_runs, status, runs = snapshot(args.repo, number)
        except (subprocess.CalledProcessError, ValueError) as error:
            # Разовый 502 посреди опроса — не повод бросать PR: следующая
            # попытка спросит заново. Молчание API согласием не считается —
            # если не ответил и последний опрос, прогон красный.
            detail = (getattr(error, "stderr", "") or str(error)).strip()
            verdict = Verdict(WAIT, [f"запрос к GitHub не удался: {detail}"])
        else:
            verdict = judge(
                pr, check_runs, status, runs, owner=owner, base=base, expected_head=expected_head
            )
        print(
            f"[{attempt}/{args.attempts}] PR #{number} @ {(pr.get('headRefOid') or '')[:8]}: "
            f"mergeable={pr.get('mergeable')} mergeStateStatus={pr.get('mergeStateStatus')} "
            f"-> {verdict.decision}",
            flush=True,
        )
        for reason in verdict.reasons:
            print(f"    {reason}", flush=True)
        if verdict.decision != WAIT:
            break
        if attempt < args.attempts:
            time.sleep(args.interval)

    if verdict.decision == REFUSE:
        report(f"PR #{number} не влит: " + "; ".join(verdict.reasons) + ".")
        return 0 if verdict.routine and not manual else 1
    if verdict.decision == WAIT:
        report(
            f"PR #{number} не влит: за {args.attempts} опросов условия не выполнились — "
            + "; ".join(verdict.reasons)
            + "."
        )
        return 1

    head = pr["headRefOid"]
    if args.dry_run:
        report(f"PR #{number}: все условия выполнены на {head[:8]}; --dry-run, мержа нет.")
        return 0
    subject = f"{pr.get('title')} (#{number})"
    merge = subprocess.run(
        [
            "gh",
            "pr",
            "merge",
            str(number),
            "--repo",
            args.repo,
            "--squash",
            "--match-head-commit",
            head,
            "--subject",
            subject,
        ],
        capture_output=True,
        text=True,
    )
    if merge.returncode != 0:
        report(f"PR #{number}: мерж отклонён GitHub: {(merge.stderr or merge.stdout).strip()}")
        return 1
    report(f"PR #{number} влит сквошем на {head[:8]}: {subject}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
