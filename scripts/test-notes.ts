/**
 * Generated note text for every outcome.
 *
 *   npx tsx scripts/test-notes.ts
 *
 * Pure — no database, no dev server.
 */

import { OutcomeType } from "../lib/generated/prisma/enums";
import { generateNote, noteDate } from "../lib/ar-note-format";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n      ${detail}`}`,
  );
}

/** The contact block every outcome shares. */
const contact = {
  spokeWith: "John",
  refNumber: "REF123",
  phone: "800-456-2583",
  howChecked: "Phone",
};

const noIso = (note: string) => !/\d{4}-\d{2}-\d{2}/.test(note);

console.log("=== date formatting ===");
{
  check(
    "ISO becomes MM/DD/YYYY",
    noteDate("2026-07-31") === "07/31/2026",
    noteDate("2026-07-31"),
  );
  check("MM/DD/YYYY passes through", noteDate("07/31/2026") === "07/31/2026");
  check("blank stays undefined", noteDate("") === undefined);
  check("undefined stays undefined", noteDate(undefined) === undefined);
}

console.log("\n=== claim prefix ===");
{
  const note = generateNote(OutcomeType.PAID, contact, {
    claimNumber: "STORED-1",
  });
  check(
    "stored claim number used when field blank",
    note.includes("Claim#STORED-1"),
    note,
  );

  const none = generateNote(OutcomeType.PAID, contact, {});
  check("no prefix when neither present", !none.includes("Claim#"), none);

  const typed = generateNote(
    OutcomeType.PAID,
    { ...contact, claimNumber: "TYPED-9" },
    { claimNumber: "STORED-1" },
  );
  check("typed claim number wins", typed.includes("Claim#TYPED-9"), typed);
}

console.log("\n=== PAID ===");
{
  const note = generateNote(OutcomeType.PAID, {
    ...contact,
    claimNumber: "CLM-1",
    claimReceivedDate: "2026-07-02",
    paymentDate: "2026-07-05",
    amountPaid: "240.50",
    copayAmount: "20.00",
    deductibleAmount: "35.00",
    paymentType: "EFT",
    paymentNumber: "EFT99123",
    paymentScope: "Single",
  });

  check(
    "claim received language",
    note.includes("Claim received by ins. on 07/02/2026"),
    note,
  );
  check(
    "paid/finalized language",
    note.includes("Paid/Finalized on 07/05/2026"),
    note,
  );
  check("amount rendered", note.includes("$240.50"), note);
  check("copay rendered", note.includes("$20.00 Copay"), note);
  check("deductible rendered", note.includes("$35.00 Deductible"), note);
  check("payment reference rendered", note.includes("EFT# EFT99123"), note);
  check("no ERA language", !note.includes("Received on"), note);
  check("no ISO dates", noIso(note), note);
  check("checked via, not checked on", note.includes("Checked via Phone"), note);
  check(
    "contact rendered",
    note.includes("Sw John Ref#REF123 Ph#800-456-2583"),
    note,
  );
  console.log(`      ${note}`);

  const bulk = generateNote(OutcomeType.PAID, {
    ...contact,
    amountPaid: "100.00",
    paymentDate: "2026-07-05",
    paymentScope: "Bulk",
    bulkTotalAmount: "5000.00",
  });
  check("bulk total rendered", bulk.includes("Bulk payment of $5,000.00"), bulk);
}

console.log("\n=== DENIED ===");
{
  const note = generateNote(OutcomeType.DENIED, {
    ...contact,
    claimNumber: "CLM-2",
    claimReceivedDate: "2026-07-02",
    denialDate: "2026-06-28",
    denialCode: "CO-197",
    denialReason: "No prior authorization",
    denialDetail: "Auth required for this CPT",
    actionTaken: "Appealed",
  });

  check("denied language", note.includes("Denied on 06/28/2026"), note);
  check("reason rendered", note.includes("No prior authorization"), note);
  check("code rendered", note.includes("Denial code CO-197"), note);
  check("detail rendered", note.includes("Auth required for this CPT"), note);
  check("action rendered", note.includes("Appealed"), note);
  check(
    "claim received stated once",
    (note.match(/Claim received by ins\./g) ?? []).length === 1,
    note,
  );
  check("no ISO dates", noIso(note), note);
  console.log(`      ${note}`);

  const other = generateNote(OutcomeType.DENIED, {
    ...contact,
    denialReason: "Timely filing",
    actionTaken: "Other",
    actionDetail: "Escalated to supervisor",
  });
  check(
    "Other action uses its detail",
    other.includes("Escalated to supervisor"),
    other,
  );
  check("Other literal not shown", !other.includes(" Other."), other);
}

console.log("\n=== NO_CLAIM_ON_FILE ===");
{
  const note = generateNote(OutcomeType.NO_CLAIM_ON_FILE, {
    ...contact,
    claimNumber: "CLM-3",
    checkedDate: "2026-07-30",
    actionTaken: "Resubmitted",
  });

  check("states no claim on file", note.includes("No claim on file"), note);
  check("checked date rendered", note.includes("Checked on 07/30/2026"), note);
  check("action rendered", note.includes("Resubmitted"), note);
  check(
    "no claim received date",
    !note.includes("Claim received by ins."),
    note,
  );
  check("no ISO dates", noIso(note), note);
  console.log(`      ${note}`);
}

console.log("\n=== PATIENT_RESPONSIBILITY ===");
{
  const note = generateNote(OutcomeType.PATIENT_RESPONSIBILITY, {
    ...contact,
    claimNumber: "CLM-4",
    claimReceivedDate: "2026-07-02",
    paymentDate: "2026-07-06",
    deductibleAmount: "150.00",
    copayAmount: "25.00",
    coinsuranceAmount: "40.00",
  });

  check(
    "finalized language",
    note.includes("Paid/Finalized on 07/06/2026"),
    note,
  );
  check("patient responsibility stated", note.includes("patient responsibility"), note);
  check("deductible rendered", note.includes("$150.00 Deductible"), note);
  check("copay rendered", note.includes("$25.00 Copay"), note);
  check("coinsurance rendered", note.includes("$40.00 Coinsurance"), note);
  check("no ISO dates", noIso(note), note);
  console.log(`      ${note}`);
}

console.log("\n=== IN_PROCESS ===");
{
  const note = generateNote(OutcomeType.IN_PROCESS, {
    ...contact,
    claimNumber: "CLM-5",
    claimReceivedDate: "2026-07-02",
    checkedDate: "2026-07-30",
    expectedResolution: "14 business days",
  });

  check("in process stated", note.includes("In Process"), note);
  check("checked date rendered", note.includes("Checked on 07/30/2026"), note);
  check("TAT rendered", note.includes("TAT: 14 business days"), note);
  check(
    "claim received rendered",
    note.includes("Claim received by ins. on 07/02/2026"),
    note,
  );
  check("no ISO dates", noIso(note), note);
  console.log(`      ${note}`);
}

console.log("\n=== CHECK_WITH_OFFICE ===");
{
  const note = generateNote(OutcomeType.CHECK_WITH_OFFICE, {
    claimNumber: "CLM-6",
    whatIsNeeded: "Corrected superbill",
    urgency: "Urgent",
  });

  check(
    "need stated",
    note.includes("Check with office — Corrected superbill"),
    note,
  );
  check("urgency flagged", note.includes("URGENT"), note);
  console.log(`      ${note}`);
}

console.log("\n=== WRITE_OFF ===");
{
  const note = generateNote(OutcomeType.WRITE_OFF, {
    ...contact,
    claimNumber: "CLM-7",
    writeOffAmount: "85.25",
    reason: "Below collection threshold",
  });

  check("amount rendered", note.includes("Write off $85.25"), note);
  check("reason rendered", note.includes("Below collection threshold"), note);
  check(
    "no claim received date",
    !note.includes("Claim received by ins."),
    note,
  );
  console.log(`      ${note}`);
}

console.log("\n=== OTHER ===");
{
  const note = generateNote(OutcomeType.OTHER, {
    ...contact,
    claimNumber: "CLM-8",
    claimReceivedDate: "2026-07-02",
    checkedDate: "2026-07-30",
  });

  check(
    "claim received rendered",
    note.includes("Claim received by ins. on 07/02/2026"),
    note,
  );
  check("checked date rendered", note.includes("Checked on 07/30/2026"), note);
  check("no ISO dates", noIso(note), note);
  console.log(`      ${note}`);

  const bare = generateNote(OutcomeType.OTHER, {});
  check("falls back when empty", bare === "Claim reviewed.", bare);
}

console.log("\n=== How Checked gating ===");
{
  const portal = generateNote(OutcomeType.IN_PROCESS, {
    checkedDate: "2026-07-30",
    howChecked: "Portal",
  });
  check("portal has no contact block", !portal.includes("Sw "), portal);
  check("portal still says how", portal.includes("Checked via Portal"), portal);

  const ivr = generateNote(OutcomeType.IN_PROCESS, {
    checkedDate: "2026-07-30",
    refNumber: "R1",
    howChecked: "IVR",
  });
  check("IVR keeps the reference", ivr.includes("Ref#R1"), ivr);
}

console.log("\n=== no outcome leaks an ISO date or ERA wording ===");
{
  const every = Object.values(OutcomeType).map((outcome) =>
    generateNote(outcome, {
      ...contact,
      claimNumber: "X",
      claimReceivedDate: "2026-07-02",
      paymentDate: "2026-07-05",
      denialDate: "2026-06-28",
      checkedDate: "2026-07-30",
      amountPaid: "10.00",
      denialReason: "R",
      whatIsNeeded: "W",
      writeOffAmount: "1.00",
      reason: "Z",
    }),
  );

  check("no ISO dates anywhere", every.every(noIso));
  check(
    "no ERA wording anywhere",
    every.every((note) => !/\bERA\b|Received on/.test(note)),
  );
  check(
    "no duplicated 'Checked on'",
    every.every((note) => (note.match(/Checked on/g) ?? []).length <= 1),
  );
}

console.log(`\n${"=".repeat(60)}`);
console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
console.log("=".repeat(60));
process.exit(fail === 0 ? 0 : 1);
