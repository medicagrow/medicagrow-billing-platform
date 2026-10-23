# MedicaGrow Billing Ops — Build Specs (Oct 2026)

These specs turn a design review of billing.medicagrow.com into build work. Read this file first, then each spec in order.

## How Claude Code should work through this

1. **Read every file in this folder before writing code.** The specs depend on each other (see "Shared records" below).
2. **Inspect the repo first.** Follow the existing stack, ORM, folder structure, role checks, PM scoping, URL-persisted filters and the existing pagination component. Don't introduce new libraries without asking.
3. **Verify before fixing.** Items marked `[VERIFY]` in `AUDIT-2026-10.md` were inferred from the UI. Confirm each one in code and report back before changing it.
4. **One phase at a time.** For each phase: propose the schema changes and a file-by-file plan, wait for approval, then build. Show every migration before running it. No destructive migrations. Back-fill scripts must be idempotent.
5. **Reference IDs in commits**, e.g. `CALC-02`, `TASKPLAN-03`.
6. **Ask when a spec is ambiguous.** Items marked `DEFAULT (confirm)` are recommended choices the owner hasn't signed off on yet. Build them behind a setting where practical.

## Files

| File | What it covers |
|---|---|
| `AUDIT-2026-10.md` | Full audit findings (CALC, LOGIC, UX) with evidence |
| `01-phase1-data-fixes.md` | Make the numbers trustworthy: timers, projection, productivity, validation |
| `02-foundations.md` | Shift day, people calendar, task type definitions, instance statuses |
| `03-task-plan.md` | Series-level view of all recurring work, gaps panel |
| `04-audit-module.md` | Manual auditor queue for tasks and AR pace |
| `05-ar-assignments-and-pace.md` | AR assignments, practice AR schedules, daily pace, Blue claim handling |
| `06-capacity-planner.md` | Workload Planner rebuild: data health, team week, free hours, AR assignment helper |
| `07-eligibility.md` | Eligibility validation module: guided plan logic, payer rules, roster, fee schedule, estimates, note |

## Build order

| Phase | Specs | Why this order |
|---|---|---|
| 1 | `01` | Nothing downstream can be trusted until timers, projection and counts are right |
| 2 | `02`, then `03` | Shared foundations, then the Task Plan, which is the source for audit and capacity |
| 3 | `04` (tasks only) | Auditor can start working while AR changes are built |
| 4 | `05`, then add AR pace items to `04` | |
| 5 | `06` | Needs Task Plan, AR assignments and people calendar |
| 6 | `07` Phase A, then Phase B | Eligibility checks and denial prevention first, estimates second |

## Owner decisions already made — do not change

- **AR aging is snapshotted at the batch upload date on purpose.** Do not make aging live. (Timely-filing deadlines are a separate calculation; see `AUDIT-2026-10.md` CALC-11.)
- **Audit is fully manual for now.** No auto-pass, no auto-verify. The system lists and gathers details; the auditor decides.
- **Eligibility outputs a note only.** No "copy as sheet row" — every practice's sheet layout differs.
- **Provider roster is maintained manually** (CSV upload + edit screen). The credentialing portal may become its source later, so key it by NPI.
- **AR outstanding balance includes green claims** (existing decision, keep).
- **Work-note audit trail stays add-only** (existing rule, keep). The auditor never edits work records.
- **Two shifts:** Day 09:00–19:00 IST and Night 18:30–05:00 IST, 8 paid hours each. Shift day = the IST date the shift started.
- **Forgotten timers auto-stop at a set time per shift** and go to a PM/Owner Timer review queue to modify and approve. Unapproved hours are not counted.

## Shared records (one source each)

Every screen reads these. If two screens show different hours for the same person and shift day, that's a bug.

| Record | Owned by spec | Read by |
|---|---|---|
| Task series (Task Plan) | 03 | Audit queue, capacity planner, resource requirements |
| Task instances (+ Missed / Returned statuses) | 02 | Audit queue, productivity, My Tasks |
| Timer sessions (by shift day) | 01, 02 | Productivity, capacity planner, audit item details |
| AR assignments + practice AR schedules | 05 | Pace tracker, audit queue, capacity planner |
| AR work notes | existing | Pace, productivity units for AR |
| People calendar (shift hours, leave, holidays) | 02 | Capacity planner, pace (working days) |
| Task type definitions | 02 | Units, estimates, suspicious-activity rules, audit checklists |
| Audit items + outcomes | 04 | PM scorecard, Tracker E and H, instance status |
| Payer rules, provider roster, fee schedules, visit types | 07 | Eligibility check |

## New table prefixes

Keep existing prefixes (`ar_` etc.). Suggested new ones: `aud_` (audit), `elig_` (eligibility checks), `ref_` (payer rules, roster, fee schedules, visit types), `cap_` (capacity reservations, if a separate table is needed). Follow whatever naming the repo already uses for shared core tables (users, practices).

## Suggested first prompt in Claude Code

> Read every file in docs/specs/ starting with 00-README.md. Then inspect the repo and give me: (1) your understanding of the current data model for tasks, timer sessions, AR batches/claims/notes and EOB; (2) for each [VERIFY] item in AUDIT-2026-10.md, whether the code confirms it, with file references; (3) a file-by-file plan for Phase 1 only. Don't change any code yet.
