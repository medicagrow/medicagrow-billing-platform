# 07 — Eligibility validation module

Replaces the "Eligibility — Soon" placeholder.

## Context
- Eligibility runs daily, several times a day, in Google Sheets whose layouts differ by practice. Sheets stay as the client-facing record.
- The app does **not** import those sheets. Billers enter what they collected (no demographics beyond a patient identifier) into a guided check. The app validates it and generates a **standard note** the biller copies into the sheet.
- No "copy as sheet row" output (owner decision).
- Most misses today: behavioral health carve-outs, Medicare Advantage, Medicaid managed care, HMO referral requirements, and IPA / medical group responsibility.

## Phase A — Guided check, payer rules, roster, note (build first)

### A1. Daily worklist (catches skipped patients)
- Biller pastes or uploads the day's appointment list for a practice: patient identifier (EHR patient ID or name), DOS, provider, optional CPT, optional visit type. Minimal columns; CSV or paste.
- The worklist shows each appointment as Not checked / Checked / Blocked. End-of-day count of unchecked appointments per practice feeds the audit queue as a coverage item.

### A2. Guided check form
Header: practice, patient identifier, DOS, rendering provider, payer, plan product.
The plan product drives which sections appear:

| Plan product | Extra required questions |
|---|---|
| HMO | PCP on file, medical group / IPA, referral required, referral on file (yes / requested / no), who pays the claim |
| Medicare Advantage | Plan name, confirm not billed to original Medicare, network for MA product |
| Medicaid managed care | Managed care organization, BH responsibility (MCO / county / state) |
| Any plan with BH carve-out | Carve-out payer, active with carve-out payer, carve-out auth required, carve-out reference # |

Always required: active (yes/no), plan end date if known, network status (from roster, see A4), copay, deductible remaining, coinsurance, out-of-pocket remaining (optional), auth required (+ auth # or "requested"), visits used / limit (when applicable), secondary insurance (yes/no + payer), checked via (portal / IVR / call), reference #, checked by (auto), checked at (auto).

**Who pays rule** (computed, shown on screen and in the note): carve-out payer for BH services if carved out → else delegated medical group for HMO when delegated → else the health plan.

**Prefill:** when the same patient + payer was checked before, prefill from the last check, outline changed fields, and require the biller to confirm each section.

### A3. Validation
**Block (copy disabled):** required field missing for the plan product; HMO with referral required and referral-on-file unanswered; carve-out = yes with no carve-out payer; inactive coverage with no action recorded; auth required with no auth # and not "requested"; provider terminated or not yet effective on DOS (roster); template placeholders left empty.
**Warn (allowed, shown in note):** plan ends within 30 days; visits remaining ≤ 1; provider status Pending or Out of network; deductible remaining > deductible; payer differs from last check; roster row last verified > 90 days ago; fee source is average paid (Phase B).
**Action items:** warnings marked actionable (visits running out, plan ending, referral requested, auth requested) create a to-do for the practice's PM, linked to the check.

### A4. Payer rules (ref_payer_rule)
Per payer + plan product: plan type, known BH carve-out partner, referral rule, delegated medical groups, claims address/payer ID note, timely filing days (shared with 01 P1-09).
- Rules **suggest** values in the form; the biller still confirms.
- A biller can **propose** a new or changed rule from the check; PM approves before it applies to others.
- Seed: payer list from existing AR and EOB data (includes medical groups such as Regal Medical, Heritage, Optum Care Network, Desert Oasis); rules filled in by PMs.

### A5. Provider roster (manual) (ref_provider_roster)
One row per practice + provider (NPI) + payer + plan product (or "All products"):
status (In network / Out of network / Pending / Terminated / Not enrolled), effective date, end date, source (contract / portal / call + ref), last verified date, verified by, notes.
- Carve-out payers (e.g. MHN, Magellan) have their own rows; BH network status comes from the carve-out payer row.
- CSV upload (same pattern as AR batch upload) + edit screen + history (add-only change log).
- Keyed by NPI so the credentialing portal can become the source later without changing this module.
- Recurring "Roster review" series per practice (quarterly) in the Task Plan.
- Check behaviour: in network on DOS → confirmed; Pending → warn; Terminated or effective after DOS → block; no row → biller must confirm on the call and can propose a roster row (PM approves).

### A6. Generated note
One standard, compact note per check, e.g.:
`10/27 ELIG: Health Net Comm HMO, active. Med grp Regal: referral REQ, [requested]. BH carved out to MHN: active, INN eff 03/01/26, no auth, ref MHN-88231. Copay $0, ded left $150, 20% coins. Bill to MHN. –Mike D`
- Note template configurable per practice (field order and which fields appear), not per sheet column.
- Copy button disabled while any Block exists.

### A7. Audit link
- Each check is stored (`elig_check`, add-only versions). The auditor can sample checks per biller/practice (audit item source = eligibility check sample, DEFAULT (confirm) 10% per biller per day) and see unchecked appointments from A1.
- Report: checks per biller, block rate, warnings, and (later) eligibility-related denials matched from EOB by patient + DOS.

## Phase B — Fee schedules, visit types, estimates

### B1. Fee schedule (ref_fee_schedule)
Per practice + payer (+ plan product optional) + CPT (+ modifier): allowed amount, effective date, end date, source (contract / average paid), last updated.
- CSV upload + edit.
- Fallback when no contract fee: average paid for that practice + payer + CPT from posted payments over the last 6 months, labelled "Avg paid" (lower confidence). If neither exists: "No fee data".

### B2. Visit types (ref_visit_type)
Per practice: name (e.g. Therapy 53 min, Med management, TMS session) and one or more CPT scenarios (e.g. `99214` · `99214 + 90833`).
- If the appointment has a CPT → one estimate line for that CPT.
- If not → one line per scenario of the chosen visit type.

### B3. Estimate calculation
Per scenario: sum of allowed amounts → apply plan rules:
- Copay: per visit or per CPT (setting on the check, default per visit)
- Deductible remaining applied first, then coinsurance on the rest
- Capped at out-of-pocket remaining when entered
Show: allowed, patient pays, source per line (Contract / Avg paid / None). Add estimate lines to the note.

## Out of scope for now
- Copy-as-sheet-row output.
- Automatic roster sync from the credentialing portal.
- Direct EHR schedule import (A1 uses paste/CSV first).
- Good Faith Estimates for self-pay patients (possible later extension of B3).

## Done when (Phase A)
- For any practice, the PM can see which of the day's appointments are unchecked.
- A check can't produce a note while a carve-out, HMO referral, medical group or roster issue is unresolved.
- Every note for every practice follows the same structure.
