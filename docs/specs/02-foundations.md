# 02 — Foundations

Shared pieces that the Task Plan, audit, AR pace, capacity and eligibility specs all depend on.

## F-01 Shifts and shift day (LOGIC-09)
The company runs two shifts (Owner setting, editable):

| Shift | Window (IST) | Paid hours |
|---|---|---|
| Day | 09:00 – 19:00 | 8h |
| Night | 18:30 – 05:00 (crosses midnight) | 8h |

Each shift stores: name, start time, end time, paid hours, auto-stop time (see 01 P1-01).

- Each user is assigned a shift (with an effective date, so changes keep history).
- The two windows overlap 18:30–19:00, so shift day is always worked out from the **user's assigned shift**, never from the clock time alone.
- **Shift day = the IST date the shift started.** Night-shift work after midnight belongs to the previous date. Night shift starts 18:30 IST, which is the US morning of that same date, so the date matches the US working day.
- Every "daily" calculation uses shift day: timer totals, productivity, workload, pace, audit items, My Day, overdue checks.
- Utility: `getShiftDay(userId, timestamp) → date`, used everywhere instead of calendar date.

## F-02 People calendar
Per user:
- Assigned shift (F-01) and working weekdays (default Mon–Fri). Daily capacity = the shift's paid hours unless overridden for that user.
- Leave entries: date range, full or partial day hours, type (leave, training, other).
Company:
- Holidays: date, name, applies to all or selected users (Indian and US holidays may differ; keep a "calendar" field).

Used by: capacity planner (free hours), AR pace (working days), timer auto-stop (shift auto-stop time).

## F-03 Task type definitions (LOGIC-10)
Extend Settings → Task Types with:
- `unit_label` (e.g. claims, visits, ERAs) and `unit_required` (yes/no)
- `default_minutes_per_unit` (optional)
- `tracks_amount` (yes/no)
- `audit_checklist`: ordered list of check items (text). Shared across practices by default; a practice may override (DEFAULT (confirm): task-type level only in v1).
- `units_source`: `manual` or `ar_notes` (AR task types derive units from notes, see 01 P1-05)

Rules:
- Suspicious Activity "Closed without count" only fires when `unit_required = true` (CALC-09).
- Split "Charge Entry & Eligibility Check" into the two existing types (migration: owner picks per series or keeps legacy type deactivated).

## F-04 Task instance statuses (LOGIC-08)
Existing: Open, In Process, Hold, Closed. Add:
- **In Process** is set automatically when a timer starts on the instance.
- **Missed**: DEFAULT (confirm): when the next instance of the same series becomes due and the previous one is still not closed, the previous one becomes Missed. Missed instances can't be worked; they create an audit item. Owner/PM can reopen if needed.
- **Returned**: set by an audit outcome "Sent back" (see 04). Biller fixes and closes again; the audit item becomes Re-audit.
- Fix generation so only one active (Open/In Process/Hold/Returned) instance exists per series at a time [VERIFY: current code appears to keep generating while earlier instances stay open].
- Back-fill: list current piled-up instances per series for PM review before marking anything Missed.

## F-05 Practice type and PM requirement (LOGIC-06, LOGIC-12)
- Practice `type`: Practice, Client group, Internal. KPIs and practice filters default to type = Practice.
- A practice must have a Primary PM before an AR batch can be uploaded.
- Blue-claim routing: confirm order in code (practice PM → batch owner → Owner) [VERIFY]. Replace silent fallback to Owner with an "Unrouted" warning on the batch and the PM home.
