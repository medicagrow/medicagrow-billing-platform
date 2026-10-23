# 04 — Audit module (manual)

New role: **Auditor** (sees all practices, read access to tasks, sessions, AR, EOB; write access only to audit records). Owner also has full access.

Principle: the system lists what needs auditing and gathers the details. The auditor checks and records the outcome. **No auto-pass.** The auditor never edits work records.

## Audit item sources
| Source | When an item is created | One item per |
|---|---|---|
| Task instance | Instance becomes Closed or Missed | instance |
| AR assignment pace | Each scheduled shift day of an active AR assignment (see 05) | assignment + shift day |
| Coverage | Task Plan gap: required series missing, series unassigned | gap (stays open until resolved) |
| Re-audit | A Returned instance is closed again | instance (links to the original item) |

## Page: Audit queue
Filters: shift day / date range, PM, practice, biller, source, audit status. Default: Pending, oldest first.
Counts at top: due, audited, pending, sent back.

Columns: practice · task, frequency, due, assigned to, task status, audit status.

## Audit item detail
**Task details:** practice, task type, assignee, PM, frequency, due, closed at (or Missed), EHR.
**Work logged:** expected time (series), time logged (sessions, count), units (per task type), biller notes.
**Checklist:** from the task type's `audit_checklist`, each item ticked by the auditor.
**For AR pace items:** plan vs claims worked today, hours today, required pace, projected finish, sample of today's notes (link to claims).
**Auditor update:**
- Outcome (required): Verified · Done late · Not done · Done with errors · Wrong production count. AR pace items: On track · Behind, recovery plan set · Behind, sent to PM · Note quality issue.
- Severity: Critical (24h) · High (3 days) · Normal (7 days)
- Send back to: none · biller · PM. Sending back sets the instance to **Returned** with the auditor's note and a due date.
- Note (required for anything other than Verified / On track).
- Button: **Save and next**.

## Audit statuses
Pending → Verified (closed)
Pending → Sent back → Re-audit → Verified

Repeat rule: the same outcome type for the same person 3 times in 30 days creates an escalation to the Owner.

## Reporting
- **PM scorecard** (weekly, per PM): audits, findings by outcome, repeat findings, sent-back items closed on time, average days to fix.
- **Biller view** of the same, scoped to their own work.
- Feed Tracker **E (Follow-up compliance)** and **H (Team & management)** from audit outcomes per practice per month (formula configurable in Tracker Settings).

## Tables (suggested)
`aud_item` (source type, source id, shift day, practice, assignee, status, timestamps), `aud_outcome` (item, outcome, severity, note, auditor, created at — add-only), `aud_checklist_answer` (item, checklist item, checked), `aud_escalation`.

## Done when
- Every closed or missed instance and every AR pace day appears in the queue without manual setup.
- An auditor can work the day's queue with Save and next, and a sent-back item returns to the biller and comes back for re-audit.
