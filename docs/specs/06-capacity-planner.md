# 06 — Workload Planner rebuild (capacity)

Replaces /analytics/workload. Three tabs. Default tab for PMs: Team week. Owner sees all practices; PMs see their own billers and practices.

## Tab 1: Data health (shown first when it has items)
Chips with counts, each linking to the fix:
- Runaway or auto-stopped timers awaiting correction (01 P1-01)
- Duplicate series (01 P1-08)
- AR work without an assignment or practice schedule (05)
- Billers with no time logged on a scheduled working day
- Piled-up instances / Missed counts (02 F-04)

## Tab 2: Team week (default)
- Mon–Fri of the selected week (no weekends unless someone is scheduled), rows = billers.
- Past shift days: **actual / planned** hours. Today: planned, highlighted. Future: planned.
- Colours: within 10% of plan · under plan · nothing logged or over shift · planned only. Always with a legend.
- Week total per biller.
- Click a biller → practice-by-day grid for that week (rows = practices, cells = planned hours by source: recurring series, AR assignment, one-off), plus each AR assignment's pace status.
- "What needs attention" text uses date ranges and one line per person (UX-05).

## Tab 3: Free hours and AR planning
### Free hours by week
Rows = billers, columns = next 4–6 weeks.
`free = shift hours − leave/holidays − recurring series hours − reserved AR hours − one-off tasks due`
- Recurring hours use actual average minutes (01 P1-03), not estimates.
- Keep a planning buffer: DEFAULT (confirm) 10% of shift hours is never shown as free.
- Colour bands: 15h+ · 8–14h · 1–7h · full/on leave.

### AR assignment helper
Inputs: practice, claims (e.g. unassigned claims in the open batch), minutes per claim, schedule (from practice), target date.
Output: billers **with access to that practice**, free hours on scheduled days before target, suggested share (claims and hours), finish date per biller, and a total "fits by date / short by Xh".
- PM can tick/untick billers and edit shares.
- **Create assignments and reserve hours** creates the AR assignments (05) and reserves their hours so they disappear from free hours immediately.

### AR plans list
All active AR assignments: practice, biller, claims, target, required pace, worked today, projected finish, status. Links to the pace view. This list also feeds the audit queue (04).

## Removed / changed
- Remove the 31-day grid as default and the "AR — daily hours not set" state (no longer possible after 05).
- Projected cells never include one-off or unconfigured work (01 P1-03).

## Done when
- A PM can see each biller's free hours for the next 4 weeks and assign an AR batch across billers with a feasible target date in one flow.
- Over-capacity counts reflect real plans, not data errors.
