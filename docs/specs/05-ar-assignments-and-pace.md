# 05 — AR assignments, practice AR schedules and pace

Problem (LOGIC-01): AR is currently set up as one task per day (e.g. 17 daily tasks for one practice) with no daily hours, so there's no pace, no target-date check, and the planner can't place AR work. Each practice works AR on different days and hours.

## Practice AR schedule (Practice settings)
Two types, set by the PM per practice:
- **Fixed days:** weekdays + hours per day (e.g. Mon/Wed/Fri, 3h).
- **Flexible weekly hours:** hours per week, any day (e.g. 6h/week).
Optional: minutes per claim default for this practice (fallback to task type default).

## AR assignment
Created when the PM assigns claims (existing claim assignment flow, or from the capacity planner helper in 06).
Fields: batch, practice, biller, claims assigned (snapshot count + link to the claim set), minutes per claim, total hours, start date, target date, schedule (inherits practice schedule; PM can override per assignment), reserved hours per shift day/week (for capacity), status (Active / Completed / Cancelled).

Rules:
- One active assignment per biller per batch.
- Replaces the daily AR tasks going forward. Migration: list existing daily AR tasks per practice; PM converts them into one assignment; old tasks are closed with a reason, not deleted.
- At creation, the system checks feasibility: hours needed vs scheduled hours available before the target date (from people calendar). If short, show the gap and let the PM change the date, the hours, or split across billers.

## Pace calculation (recalculated each shift day)
- Working days = scheduled days from today to target date, minus leave and holidays.
- Remaining claims = assigned − worked − routed to PM (Blue, see below).
- Required pace = remaining claims ÷ remaining working days (fixed); per week for flexible.
- Claims worked today = unique claims with a note by the biller this shift day (same definition as 01 P1-05).
- Projected finish = remaining claims ÷ average claims per working day over the last 3 working days.
- Status: On track (projected ≤ target) · Behind (projected > target) · At risk (projected > target + 5 working days).
- Claims per hour vs planned (from minutes per claim) shown alongside, so "enough hours but slow" is visible.

## Blue claims (reassigned to PM)
- The note that routes a claim to Blue counts as a claim worked for the biller that day.
- Routed claims leave the biller's remaining count and show as "routed to PM" in progress (not dropped).
- Routed claims form the PM's **practice-coordination queue**, shown separately from the PM's own AR progress (CALC-07). Age of each routed claim is visible; the existing "sitting unactioned 3+ days" smart alert stays.
- Require a reason on every Blue routing (existing structured outcomes cover this; make it mandatory).

## Screens
- **Assignment pace view** (from batch page and from AR plans tab in 06): header (practice, biller, claims, estimate, dates, schedule), cards (required from now, worked today, done so far vs plan, projected finish), day-by-day log (plan, worked, hours, gap), and the auditor checklist when opened from the audit queue.
- **Biller home** shows each of their active assignments with today's target and progress.

## Batch closing (LOGIC-02)
- Closing a batch requires a reason.
- Unresolved claims are listed at close; PM chooses: carry over to the next batch for that practice, or close with reason. Report "batches closed with open claims" for the Owner.

## Terminal outcomes (LOGIC-03)
- Add outcomes: **Write-off recommended** (needs PM or Owner approval) and **Transferred to patient**. Once approved, the claim leaves active AR and appears in a separate report. Note stays in the add-only trail.

## Done when
- No new daily AR tasks are created; each biller's AR work is one assignment per batch with a live pace status.
- The AR productivity number on every screen matches.
