# 01 — Phase 1: Make the numbers trustworthy

Goal: every hour and count on screen is correct before any redesign. Each item links to evidence in `AUDIT-2026-10.md`.

## P1-01 Runaway timers (CALC-02)
**Auto-stop**
- Each shift (see `02-foundations.md` F-01) has an **auto-stop time** (Owner setting, clock time in IST). Any timer still running at that time is stopped automatically with `auto_stopped = true`.
  - Day shift: DEFAULT (confirm) 19:30 IST.
  - Night shift: DEFAULT (confirm) 05:30 IST.
- Fallback: any single session longer than a max length (Owner setting, DEFAULT 10h, i.e. just under the 10.5h shift window) is also auto-stopped, in case a user has no shift assigned.

**Timer review queue (PM and Owner)**
- Every auto-stopped session goes into a **Timer review** queue: PMs see their own billers, the Owner sees everyone. Show a notification badge in the header and on the PM/Owner home until the queue is empty.
- Each item shows: biller, task, practice, start, auto-stop time, the biller's other sessions that day, and the biller's optional note on when they actually stopped.
- PM/Owner can **modify the end time** (must be between start and auto-stop) and **approve**, or approve as is. Every change is logged (who, when, old and new end time), add-only.
- Until approved, the session's hours show as **"pending review"** and are not counted in productivity, workload actuals or pace. After approval they count normally.
- The biller sees their auto-stopped sessions and can add the note, but cannot approve them.

**Other rules**
- Sessions are attributed to the shift day the shift started on (F-01), even when they run past midnight.
- Add "Auto-stopped timer" to Suspicious Activity, and count auto-stops per biller per month (repeat offenders are a training issue).
- Back-fill: list all existing sessions over 10h for the Owner to review through the same queue. Do not auto-edit historical sessions.

**Done when:** no shift day shows more hours than the shift allows without an item in the Timer review queue, and nothing pending review is counted in any report.

## P1-02 Time on open tasks (CALC-04) [VERIFY]
- Productivity, Workload Planner and Session Log count every session by its shift day, regardless of the task's status.
- Show "logged on tasks not closed" as a separate figure, not hidden.

**Done when:** a biller with sessions on open tasks appears in Time & Productivity with those hours.

## P1-03 Workload projection (CALC-05)
- Future days project only recurring series (from their recurrence pattern), never one-off tasks and never unconfigured AR.
- Projected hours use the series' **actual average minutes per instance over the last 4 weeks** when at least 3 closed instances exist; otherwise the estimate. Label which one is used.

**Done when:** no future day repeats today's one-off load.

## P1-04 EOB average days to resolve (CALC-03) [VERIFY]
- Average only resolved entries: `resolved_at − received_date`. Exclude rows with a missing date. Check for null dates being treated as epoch/zero.

## P1-05 One AR productivity number (CALC-06)
- A "claim worked" = a unique claim with at least one work note by that user on that shift day, any outcome (Red, Blue or Green).
- AR task units are derived from this automatically. Remove manual unit entry on AR tasks (keep it for other task types).
- AR Dashboard "Biller productivity" and Time & Productivity must show the same AR number for the same user and period.
- Claim progress becomes period-based (selected period), and shows: done, routed to PM (Blue), remaining. Blue claims are not dropped from the biller's total.

## P1-06 Structured note validation (LOGIC-04)
- "Log new note": no default outcome. Required fields depend on the chosen outcome.
- Block save while any template placeholder (e.g. `____`) is still empty.

## P1-07 Follow-up date validation (LOGIC-05)
- Follow-up date must be today or later. More than 90 days out needs a confirm click.
- Report existing follow-ups dated in the past year with a different year than expected (possible typos) for PM cleanup.

## P1-08 Duplicate recurring series
- Report series that match on practice + task type + assignee + overlapping schedule (e.g. Vance C · Holistic Psychiatry). Owner decides; don't auto-delete.

## P1-09 Timely-filing alert (CALC-11)
- Add `timely_filing_days` per payer (default 90, editable). Deadline = DOS + limit, compared with **today** — independent of the aging snapshot, which stays as is.
- Smart Alert fires N days before each claim's own deadline (N configurable, default 30) and for claims already past it.

## P1-10 Labels that mislead (CALC-08, CALC-10)
- Rename "Overall efficiency" to "Time vs estimate"; colour > 110% as over.
- Remove the blended "Avg time per unit" across task types; show it per task type only.
- Resource Requirements: show coverage first ("3 of 29 practices have requirements set").
