# 03 — Task Plan (series view)

Problem (LOGIC-14): All Tasks lists instances (605 open, mostly repeats). PMs and the Owner can't see what work each practice is supposed to get, who owns it, how often, how long, or what's unassigned or missing. Series can only be edited from one instance via a modal.

## Page: Tasks → Task Plan
Visible to Owner (all practices) and PMs (their practices). Billers don't see it.

### Toggle: By practice | By person
**By practice** — one group per practice (header: practice name, Primary PM, monthly hours planned vs actual). One row per active series:

| Column | Source |
|---|---|
| Task type | series |
| Assigned to | series assignee (red "Unassigned" if none) |
| Frequency | recurrence pattern in plain words (Daily, Mon/Thu, Weekly, Monthly 1st) |
| Minutes per run | series estimate |
| Monthly hours: estimated / actual | estimate × runs per month / actual average × runs per month (actual only when ≥ 3 closed instances in last 4 weeks) |
| Open instances | count of active instances (highlight ≥ 3) |
| Next due | next instance date |
| Status | Active / Paused / Ended |
| Actions | Edit, Reassign, Pause |

**By person** — one group per user: all their series across practices, with total monthly recurring hours. This number feeds the capacity planner.

Also list one-off open tasks per practice in a collapsed section (count + link to filtered All Tasks).

### Gaps panel (top of page)
Each chip filters the list:
- Series with no assignee
- Assignee inactive or without access to that practice
- Duplicate series (same practice + type + assignee + overlapping schedule)
- Backlogged series (≥ 3 open instances)
- Practices missing a required task type (see blueprint below)
- One-off tasks with no practice set

### Required-task blueprint
- Per practice, a list of required task types (and optionally expected frequency). Set in Practice settings.
- Missing required series show as a greyed row with a "Create" action.
- The blueprint is the auditor's coverage check (see 04).

### Series detail panel (click a row)
Description, assignee history, instance history (last 30 with status and time), time trend, audit outcomes for this series, and the task type's audit checklist.

## Rules
- Editing a series from here changes future instances only.
- Pausing stops generation; resuming does not back-create missed instances.
- Reuse existing filter-in-URL and pagination patterns.

## Done when
- A PM can answer, for any practice, "what recurring work exists, who does it, how often, how many hours a month, and what's missing" from one screen without scrolling through instances.
