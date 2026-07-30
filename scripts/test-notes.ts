/**
 * Manual verification of generated work-note text — not a test framework.
 *
 *   npx tsx scripts/test-notes.ts
 */

import { generateNote, type NoteFields } from "../lib/ar-note-format";
import { OutcomeType } from "../lib/generated/prisma/enums";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const contact: NoteFields = {
  spokeWith: "Dana",
  refNumber: "REF778",
  phone: "800-456-2583",
  howChecked: "Phone",
};

console.log("=== common fields on every outcome ===");
{
  for (const outcome of Object.values(OutcomeType)) {
    const note = generateNote(
      outcome,
      { ...contact, claimNumber: "CLM-999", claimReceivedDate: "07/01/2026" },
      { claimNumber: "STORED-1" },
    );
    check(`${outcome}: Claim# from form wins`, note.includes("Claim#CLM-999"), note);
    check(`${outcome}: claim received rendered`, note.includes("Received by insurance on 07/01/2026"), note);
  }
}

console.log("\n=== claim number falls back to the stored value ===");
{
  const note = generateNote(OutcomeType.PAID, contact, { claimNumber: "STORED-1" });
  check("stored claim number used when field blank", note.includes("Claim#STORED-1"), note);

  const none = generateNote(OutcomeType.PAID, contact, {});
  check("no prefix when neither present", !none.includes("Claim#"), none);
}

console.log("\n=== PAID ===");
{
  const note = generateNote(OutcomeType.PAID, {
    ...contact,
    claimNumber: "CLM-1",
    eraDate: "07/02/2026",
    amountPaid: "240.50",
    copayAmount: "20.00",
    allowedAmount: "260.00",
    paymentDate: "07/05/2026",
    paymentType: "EFT",
    paymentNumber: "EFT99123",
    paymentScope: "Single",
  });
  check("allowed amount rendered", note.includes("(allowed $260.00)"), note);
  check("payment date rendered", note.includes("Payment dated 07/05/2026"), note);
  check("core sentence intact", note.includes("Paid $240.50 with $20.00 Copay"), note);
  console.log(`      ${note}`);
}

console.log("\n=== DENIED ===");
{
  const note = generateNote(OutcomeType.DENIED, {
    ...contact,
    claimNumber: "CLM-2",
    eraDate: "07/02/2026",
    denialDate: "06/28/2026",
    denialCode: "CO-197",
    denialReason: "No prior authorization",
    denialDetail: "Auth required for this CPT",
    actionTaken: "Appealed",
    appealDeadline: "08/27/2026",
  });
  check("denial issued rendered", note.includes("Denial issued 06/28/2026"), note);
  check("denial code rendered", note.includes("Denial code CO-197"), note);
  check("appeal deadline rendered", note.includes("Appeal deadline 08/27/2026"), note);
  check("reason retained", note.includes("Denied for No prior authorization"), note);
  console.log(`      ${note}`);
}

console.log("\n=== NO CLAIM ON FILE ===");
{
  const note = generateNote(OutcomeType.NO_CLAIM_ON_FILE, {
    ...contact,
    claimNumber: "CLM-3",
    actionTaken: "Resubmitted",
    resubmissionDate: "07/10/2026",
    timelyFilingDeadline: "09/30/2026",
  });
  check("resubmission date rendered", note.includes("Resubmitted 07/10/2026"), note);
  check("timely filing rendered", note.includes("Timely filing deadline 09/30/2026"), note);
  check("action and date not duplicated", !note.includes("Resubmitted. Resubmitted"), note);
  console.log(`      ${note}`);

  const dateOnly = generateNote(OutcomeType.NO_CLAIM_ON_FILE, {
    ...contact,
    resubmissionDate: "07/10/2026",
  });
  check("date without action still reads", dateOnly.includes("Resubmitted 07/10/2026"), dateOnly);

  const actionOnly = generateNote(OutcomeType.NO_CLAIM_ON_FILE, {
    ...contact,
    actionTaken: "Contacted Clearinghouse",
  });
  check("action without date still reads", actionOnly.includes("Contacted Clearinghouse."), actionOnly);
}

console.log("\n=== PATIENT RESPONSIBILITY ===");
{
  const note = generateNote(OutcomeType.PATIENT_RESPONSIBILITY, {
    ...contact,
    eraDate: "07/02/2026",
    deductibleAmount: "150.00",
    patientBalance: "150.00",
    statementSentDate: "07/06/2026",
  });
  check("patient balance rendered", note.includes("Patient balance $150.00"), note);
  check("statement sent rendered", note.includes("Statement sent 07/06/2026"), note);
  console.log(`      ${note}`);
}

console.log("\n=== IN PROCESS ===");
{
  const note = generateNote(OutcomeType.IN_PROCESS, {
    ...contact,
    checkedDate: "07/20/2026",
    expectedResolution: "14 business days",
    expectedPaymentDate: "08/03/2026",
  });
  check("expected payment rendered", note.includes("Expected payment 08/03/2026"), note);
  console.log(`      ${note}`);
}

console.log("\n=== CHECK WITH OFFICE ===");
{
  const note = generateNote(OutcomeType.CHECK_WITH_OFFICE, {
    ...contact,
    whatIsNeeded: "Updated insurance card",
    urgency: "Urgent",
    neededByDate: "07/31/2026",
  });
  check("needed by rendered", note.includes("Needed by 07/31/2026"), note);
  check("urgent retained", note.includes("URGENT."), note);
  console.log(`      ${note}`);
}

console.log("\n=== WRITE OFF ===");
{
  const note = generateNote(OutcomeType.WRITE_OFF, {
    ...contact,
    writeOffAmount: "87.25",
    reason: "Past timely filing",
    writeOffType: "Timely Filing",
    approvedBy: "Vishal",
  });
  check("write-off type rendered", note.includes("Type: Timely Filing"), note);
  check("approver rendered", note.includes("Approved by Vishal"), note);
  console.log(`      ${note}`);
}

console.log("\n=== How Checked gating shows up in the note ===");
{
  const phone = generateNote(OutcomeType.IN_PROCESS, {
    checkedDate: "07/20/2026",
    spokeWith: "Dana",
    refNumber: "REF1",
    phone: "800-456-2583",
    howChecked: "Phone",
  });
  check("Phone keeps all three", phone.includes("Sw Dana") && phone.includes("Ref#REF1") && phone.includes("Ph#"), phone);

  // The form clears the blocked values, so the note simply omits them.
  const ivr = generateNote(OutcomeType.IN_PROCESS, {
    checkedDate: "07/20/2026",
    spokeWith: "",
    refNumber: "REF1",
    phone: "800-456-2583",
    howChecked: "IVR",
  });
  check("IVR omits Spoke With", !ivr.includes("Sw "), ivr);
  check("IVR keeps Ref#", ivr.includes("Ref#REF1"), ivr);

  const portal = generateNote(OutcomeType.IN_PROCESS, {
    checkedDate: "07/20/2026",
    spokeWith: "",
    refNumber: "",
    phone: "",
    howChecked: "Portal",
  });
  check("Portal omits all three", !portal.includes("Sw ") && !portal.includes("Ref#") && !portal.includes("Ph#"), portal);
  check("Portal still records how checked", portal.includes("Checked on Portal."), portal);
}

console.log("\n=== no stray punctuation when everything optional is blank ===");
{
  const note = generateNote(OutcomeType.WRITE_OFF, {
    writeOffAmount: "10.00",
    reason: "Small balance",
  });
  check("no double spaces", !note.includes("  "), note);
  check("no space before period", !/ \./.test(note), note);
}

console.log(`\n${"=".repeat(60)}`);
console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
console.log("=".repeat(60));
process.exit(fail === 0 ? 0 : 1);
