/**
 * Manual verification of the standard CSV parser — not a test framework.
 *
 *   npx tsx scripts/test-parsers.ts            # built-in cases
 *   npx tsx scripts/test-parsers.ts <file.csv> # parse a real file
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildMappingReport,
  parseStandardCsv,
} from "../lib/ar-parsers/standard-csv";
import { ArParseError } from "../lib/ar-parsers/types";
import {
  autoFieldMapping,
  missingRequiredFields,
  MERGE_SENTINEL,
} from "../lib/ar-parsers/detect";

const AS_OF = new Date(Date.UTC(2026, 6, 28)); // fixed, so aging is stable

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const buf = (text: string) => Buffer.from(text, "utf8");
const run = (csv: string) => parseStandardCsv(buf(csv), { asOfDate: AS_OF });

const FULL_HEADER =
  "patient_name,date_of_service,provider_name,insurance_name,billed_amount,balance,cpt_code,claim_number,subscriber_id,patient_id,aging_days";
const CORE = FULL_HEADER.split(",").slice(0, 6).join(",");

/** Filler rows to keep a file above the 10-row abort floor. */
const filler = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `Filler ${i},03/0${(i % 9) + 1}/2026,Dr. A,Aetna,100,100`,
  ).join("\n");

console.log("=== happy path ===");
{
  const result = run(`${FULL_HEADER}
Alvarez Maria,03/14/2026,Dr. Chen,Aetna,240.50,240.50,99213,ENC-1001,SUB-4401,PT-5501,136
Boone Darrell,04/02/2026,Dr. Patel,Blue Cross,1120.00,420.00,99214,ENC-1002,SUB-4402,PT-5502,`);

  check("2 claims parsed", result.claims.length === 2, `got ${result.claims.length}`);
  check("no errors", result.errors.length === 0, JSON.stringify(result.errors));
  check("DOS exact", result.claims[0]!.dateOfService.toISOString() === "2026-03-14T00:00:00.000Z", result.claims[0]!.dateOfService.toISOString());
  check("aging from column", result.claims[0]!.agingDays === 136, `${result.claims[0]!.agingDays}`);
  check("aging calculated when blank", result.claims[1]!.agingDays === 117, `${result.claims[1]!.agingDays}`);
  check("balance decimal-safe", result.claims[1]!.balance === "420.00", result.claims[1]!.balance);
  check("all import Pending/RED", result.claims.every((c) => c.statusLabel === "Pending" && c.statusCategory === "RED"));
}

console.log("\n=== fuzzy header detection ===");
{
  const result = run(`Patient,DOS,Rendering Provider,Payer,Charges,Amount Due
Alvarez Maria,03/14/2026,Dr. Chen,Aetna,240.50,240.50`);
  check("aliases detected", result.claims.length === 1, JSON.stringify(result.errors));
  check("provider via alias", result.claims[0]?.providerName === "Dr. Chen", result.claims[0]?.providerName ?? "");
  check("insurance via alias", result.claims[0]?.insuranceName === "Aetna", result.claims[0]?.insuranceName ?? "");
}

console.log("\n=== spacing / punctuation insensitive ===");
{
  const result = run(`Patient Name,DATE OF SERVICE,Provider-Name,INSURANCE_NAME,Billed Amount,BALANCE
Chowdhury Anita,02/19/2026,Dr. Okafor,Cigna,300,87.25`);
  check("mixed separators matched", result.claims.length === 1, JSON.stringify(result.errors));
}

console.log("\n=== first + last name merge ===");
{
  const result = run(`first_name,last_name,date_of_service,provider_name,insurance_name,billed_amount,balance
Olivia,Nakamura,03/05/2026,Dr. Rivera,Optum,180,180`);
  check("merged as First Last", result.claims[0]?.patientName === "Olivia Nakamura", result.claims[0]?.patientName ?? "");
  check("merge reported", result.warnings.some((w) => w.includes("patient_name ←")), result.warnings.join(" | "));

  const prefixed = run(`patient_first_name,patient_last_name,date_of_service,provider_name,insurance_name,billed_amount,balance
Peter,Osei,03/12/2026,Dr. Rivera,Aetna,140,0`);
  check("patient_first/last variant merged", prefixed.claims[0]?.patientName === "Peter Osei", prefixed.claims[0]?.patientName ?? "");
}

console.log("\n=== date auto-correction ===");
{
  const iso = run(`${CORE}
A,2026-03-14,Dr. A,Aetna,100,100`);
  check("YYYY-MM-DD accepted", iso.claims[0]?.dateOfService.toISOString() === "2026-03-14T00:00:00.000Z", iso.claims[0]?.dateOfService.toISOString() ?? "none");

  const short = run(`${CORE}
A,03/14/26,Dr. A,Aetna,100,100
B,03/15/99,Dr. A,Aetna,100,100`);
  check("MM/DD/26 -> 2026", short.claims[0]?.dateOfService.getUTCFullYear() === 2026, String(short.claims[0]?.dateOfService.getUTCFullYear()));
  check("MM/DD/99 -> 1999", short.claims[1]?.dateOfService.getUTCFullYear() === 1999, String(short.claims[1]?.dateOfService.getUTCFullYear()));

  const single = run(`${CORE}
A,3/4/2026,Dr. A,Aetna,100,100`);
  check("M/D/YYYY padded", single.claims[0]?.dateOfService.toISOString() === "2026-03-04T00:00:00.000Z", single.claims[0]?.dateOfService.toISOString() ?? "none");

  const dashed = run(`${CORE}
A,03-14-2026,Dr. A,Aetna,100,100`);
  check("MM-DD-YYYY accepted", dashed.claims[0]?.dateOfService.toISOString() === "2026-03-14T00:00:00.000Z", dashed.claims[0]?.dateOfService.toISOString() ?? "none");

  // The order is decided once for the whole column, never per row.
  const dayFirst = run(`${CORE}
A,14/03/2026,Dr. A,Aetna,100,100
B,04/03/2026,Dr. A,Aetna,100,100`);
  check("DD/MM detected for column", dayFirst.claims[0]?.dateOfService.toISOString() === "2026-03-14T00:00:00.000Z", dayFirst.claims[0]?.dateOfService.toISOString() ?? "none");
  check("ambiguous row uses same order", dayFirst.claims[1]?.dateOfService.toISOString() === "2026-03-04T00:00:00.000Z", dayFirst.claims[1]?.dateOfService.toISOString() ?? "none");
  check("day-first auto-detection warned", dayFirst.warnings.some((w) => w.includes("DD/MM/YYYY detected")), dayFirst.warnings.join(" | "));

  const mdyDefault = run(`${CORE}
A,03/04/2026,Dr. A,Aetna,100,100`);
  check("unproven column stays MM/DD", mdyDefault.claims[0]?.dateOfService.toISOString() === "2026-03-04T00:00:00.000Z", mdyDefault.claims[0]?.dateOfService.toISOString() ?? "none");

  const leap = run(`${CORE}
A,02/29/2026,Dr. A,Aetna,100,100
B,03/01/2026,Dr. A,Aetna,100,100`);
  check("Feb 29 in non-leap year rejected", leap.errors.some((e) => e.field === "date_of_service"), JSON.stringify(leap.errors));

  const impossible = run(`${CORE}
A,02/30/2026,Dr. A,Aetna,100,100
B,03/01/2026,Dr. A,Aetna,100,100`);
  check("Feb 30 rejected", impossible.errors.some((e) => e.field === "date_of_service"), JSON.stringify(impossible.errors));

  const garbage = run(`${CORE}
A,notadate,Dr. A,Aetna,100,100
B,03/01/2026,Dr. A,Aetna,100,100`);
  check("unparseable date rejected", garbage.errors.some((e) => e.field === "date_of_service"), JSON.stringify(garbage.errors));
}

console.log("\n=== amounts ===");
{
  const result = run(`${CORE}
"Vasquez, Hector",03/16/2026,"Dr. Sandoval, MD","Cigna HMO","$1,234.50","  890.00  "
Credit Patient,03/17/2026,Dr. A,Aetna,100,-40.00`);
  check("quoted comma in name", result.claims[0]?.patientName === "Vasquez, Hector", result.claims[0]?.patientName ?? "");
  check("currency and commas stripped", result.claims[0]?.billedAmount === "1234.50", result.claims[0]?.billedAmount ?? "");
  check("whitespace trimmed", result.claims[0]?.balance === "890.00", result.claims[0]?.balance ?? "");
  check("negative balance accepted", result.claims[1]?.balance === "-40.00", result.claims[1]?.balance ?? "");
}

console.log("\n=== blank rows skipped silently ===");
{
  const result = run(`${FULL_HEADER}
Doyle Kevin,01/30/2026,Dr. Chen,United,415,415,,,,,

,,,,,,,,,,
Estrada Luis,05/08/2026,Dr. Chen,Humana,63.75,63.75,,,,,`);
  check("blanks ignored", result.claims.length === 2, `got ${result.claims.length}`);
  check("blanks are not errors", result.errors.length === 0);
  check("totalRows excludes blanks", result.totalRows === 2, `got ${result.totalRows}`);
}

console.log("\n=== all errors collected, not just the first ===");
{
  const result = run(`${CORE}
,03/14/2026,Dr. A,Aetna,100,100
Good Row,03/14/2026,Dr. A,Aetna,100,100
Bad Everything,notadate,,,abc,xyz
${filler(8)}`);

  check("good rows still imported", result.claims.length === 9, `got ${result.claims.length}`);
  check("bad row reports 5 field errors", result.errors.filter((e) => e.row === 4).length === 5, `${result.errors.filter((e) => e.row === 4).length}`);
  check("missing patient_name flagged", result.errors.some((e) => e.row === 2 && e.field === "patient_name"));
  check("row numbers 1-based incl header", result.errors.every((e) => e.row >= 2));
}

console.log("\n=== 20% abort, with a 10-row floor ===");
{
  // Small file: 1 of 4 bad is 25%, but under the floor, so it must still import.
  const small = run(`${CORE}
Good,03/14/2026,Dr. A,Aetna,100,100
Bad,notadate,Dr. A,Aetna,100,100
Good2,03/15/2026,Dr. A,Aetna,100,100
Good3,03/16/2026,Dr. A,Aetna,100,100`);
  check("small file exempt from abort", small.claims.length === 3, `got ${small.claims.length}`);
  check("small file still reports the bad row", small.errors.length > 0);

  // Large file above the floor with >20% bad must abort.
  try {
    run(`${CORE}
${filler(8)}
Bad1,notadate,Dr. A,Aetna,100,100
Bad2,notadate,Dr. A,Aetna,100,100
Bad3,notadate,Dr. A,Aetna,100,100
Bad4,notadate,Dr. A,Aetna,100,100`);
    check("large file aborts", false, "no error thrown");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("large file aborts", error instanceof ArParseError && message.includes("Too many invalid rows"), message);
  }
}

console.log("\n=== missing required column ===");
{
  try {
    run(`patient_name,date_of_service,provider_name
A,03/14/2026,Dr. A`);
    check("missing columns rejected", false, "no error thrown");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("missing columns rejected", message.includes("insurance_name") && message.includes("billed_amount"), message);
  }
}

console.log("\n=== BOM and CRLF ===");
{
  const result = run(`﻿${CORE}\r\nXiong Mai,01/08/2026,Dr. A,Humana,75,75\r\n`);
  check("BOM + CRLF handled", result.claims.length === 1 && result.claims[0]!.patientName === "Xiong Mai", JSON.stringify(result.errors));
}

console.log("\n=== mapping preview ===");
{
  const report = buildMappingReport(
    buf(`first_name,last_name,DOS,Rendering Provider,Payer,Charges,Amount Due,CPT
Olivia,Nakamura,03/05/26,Dr. Rivera,Optum,180,180,90837`),
  );
  check("preview can import", report.missingRequired.length === 0, report.missingRequired.join(", "));
  check("preview flags the name merge", report.patientNameMerged);
  check("preview reports date format", report.dateFormat?.description === "MM/DD/YYYY", report.dateFormat?.description ?? "none");
  check("preview notes 2-digit year", report.dateNotes.some((n) => n.includes("2-digit")), report.dateNotes.join(" | "));
  check("preview finds cpt_code", report.mappings.some((m) => m.field === "cpt_code" && m.found));
  check("preview marks aging_days absent", report.mappings.some((m) => m.field === "aging_days" && !m.found));

  const broken = buildMappingReport(buf(`patient_name,date_of_service\nA,03/14/2026`));
  check("preview blocks when required missing", broken.missingRequired.length === 4, broken.missingRequired.join(", "));
}

console.log("\n=== explicit field mapping overrides detection ===");
{
  // Two plausible name columns: detection picks one, the PM picks the other.
  const csv = `Client,Alt Name,DOS,Rendering Provider,Payer,Charges,Amount Due
Auto Picked,PM Picked,03/14/2026,Dr. Chen,Aetna,240.50,240.50`;

  const auto = run(csv);
  check("auto-detection uses Client", auto.claims[0]?.patientName === "Auto Picked", auto.claims[0]?.patientName ?? "none");

  const overridden = parseStandardCsv(buf(csv), {
    asOfDate: AS_OF,
    fieldMapping: {
      patient_name: "Alt Name",
      first_name_col: null,
      last_name_col: null,
      date_of_service: "DOS",
      provider_name: "Rendering Provider",
      insurance_name: "Payer",
      billed_amount: "Charges",
      balance: "Amount Due",
      cpt_code: null,
      claim_number: null,
      subscriber_id: null,
      patient_id: null,
      aging_days: null,
      visit_id: null,
      visit_status: null,
    },
  });
  check("explicit mapping wins", overridden.claims[0]?.patientName === "PM Picked", overridden.claims[0]?.patientName ?? "none");
  check("explicit mapping keeps other fields", overridden.claims[0]?.insuranceName === "Aetna", overridden.claims[0]?.insuranceName ?? "none");

  // Merge chosen by hand, from columns detection would not have paired.
  const mergeCsv = `Given,Family,DOS,Provider,Payer,Charges,Amount Due
Olivia,Nakamura,03/05/2026,Dr. Rivera,Optum,180,180`;

  const mergedByHand = parseStandardCsv(buf(mergeCsv), {
    asOfDate: AS_OF,
    fieldMapping: {
      patient_name: MERGE_SENTINEL,
      first_name_col: "Given",
      last_name_col: "Family",
      date_of_service: "DOS",
      provider_name: "Provider",
      insurance_name: "Payer",
      billed_amount: "Charges",
      balance: "Amount Due",
      cpt_code: null,
      claim_number: null,
      subscriber_id: null,
      patient_id: null,
      aging_days: null,
      visit_id: null,
      visit_status: null,
    },
  });
  check("manual merge sentinel honoured", mergedByHand.claims[0]?.patientName === "Olivia Nakamura", mergedByHand.claims[0]?.patientName ?? "none");

  // An optional field explicitly set to null must stay unmapped even though
  // detection would have found it.
  const withCpt = `patient_name,date_of_service,provider_name,insurance_name,billed_amount,balance,cpt_code
A,03/14/2026,Dr. A,Aetna,100,100,99213`;

  const cptSuppressed = parseStandardCsv(buf(withCpt), {
    asOfDate: AS_OF,
    fieldMapping: {
      patient_name: "patient_name",
      first_name_col: null,
      last_name_col: null,
      date_of_service: "date_of_service",
      provider_name: "provider_name",
      insurance_name: "insurance_name",
      billed_amount: "billed_amount",
      balance: "balance",
      cpt_code: null,
      claim_number: null,
      subscriber_id: null,
      patient_id: null,
      aging_days: null,
      visit_id: null,
      visit_status: null,
    },
  });
  check("unmapped optional stays unmapped", cptSuppressed.claims[0]?.cptCode === undefined, String(cptSuppressed.claims[0]?.cptCode));
}

console.log("\n=== auto mapping + missing-required helpers ===");
{
  const headers = ["First Name", "Last Name", "DOS", "Rendering Provider", "Payer", "Charges", "Amount Due"];
  const mapping = autoFieldMapping(headers);
  check("auto mapping proposes merge", mapping.patient_name === MERGE_SENTINEL, String(mapping.patient_name));
  check("auto mapping fills first/last", mapping.first_name_col === "First Name" && mapping.last_name_col === "Last Name");
  check("auto mapping resolves aliases", mapping.insurance_name === "Payer", String(mapping.insurance_name));
  check("nothing missing", missingRequiredFields(mapping).length === 0, missingRequiredFields(mapping).join(", "));

  const broken = autoFieldMapping(["Something", "Else"]);
  check("missing required detected", missingRequiredFields(broken).length === 6, String(missingRequiredFields(broken).length));

  const halfMerge = { ...mapping, last_name_col: null };
  check("merge without last name counts as missing", missingRequiredFields(halfMerge).includes("patient_name"));
}

console.log("\n=== optional visit columns ===");
{
  // Both are optional: a file without them parses exactly as before.
  const withoutVisit = run(`patient_name,date_of_service,provider_name,insurance_name,billed_amount,balance
Ann Lee,03/14/2026,Dr. Chen,Aetna,240.50,240.50`);

  check("a file with no visit columns still parses", withoutVisit.claims.length === 1);
  check("visit id is absent, not blank", withoutVisit.claims[0]?.visitId === undefined);
  check("visit status likewise", withoutVisit.claims[0]?.visitStatus === undefined);

  const withVisit = run(`patient_name,date_of_service,provider_name,insurance_name,billed_amount,balance,visit_id,visit_status
Ann Lee,03/14/2026,Dr. Chen,Aetna,240.50,240.50,V-8891,Checked Out`);

  check("visit_id maps", withVisit.claims[0]?.visitId === "V-8891", withVisit.claims[0]?.visitId ?? "none");
  check(
    "visit_status maps",
    withVisit.claims[0]?.visitStatus === "Checked Out",
    withVisit.claims[0]?.visitStatus ?? "none",
  );

  // Header spellings people actually export.
  const spellings = run(`Patient,DOS,Provider,Payer,Charges,Balance,Visit ID,Visit Status
Bob Ray,03/14/2026,Dr. Chen,Aetna,100.00,100.00,V-1,Arrived`);

  check("spaced headers detect", spellings.claims[0]?.visitId === "V-1", spellings.claims[0]?.visitId ?? "none");
  check(
    "and so does the status beside it",
    spellings.claims[0]?.visitStatus === "Arrived",
    spellings.claims[0]?.visitStatus ?? "none",
  );

  // "visit" alone is a visit_id candidate; visit_status resolves first so it
  // cannot be swallowed by it.
  const ambiguous = run(`patient_name,date_of_service,provider_name,insurance_name,billed_amount,balance,VisitStatus,Visit
Cy Diaz,03/14/2026,Dr. Chen,Aetna,50.00,50.00,Pending,V-77`);

  check(
    "status wins its own column",
    ambiguous.claims[0]?.visitStatus === "Pending",
    ambiguous.claims[0]?.visitStatus ?? "none",
  );
  check(
    "and the bare 'Visit' becomes the id",
    ambiguous.claims[0]?.visitId === "V-77",
    ambiguous.claims[0]?.visitId ?? "none",
  );
}

console.log("\n=== shipped template parses ===");
{
  const templatePath = path.resolve(process.cwd(), "public/templates/ar-claims-template.csv");
  const result = parseStandardCsv(fs.readFileSync(templatePath), { asOfDate: AS_OF });
  check("template has 2 valid rows", result.claims.length === 2, `got ${result.claims.length}`);
  check("template has no errors", result.errors.length === 0, JSON.stringify(result.errors));
}

const fileArg = process.argv[2];
if (fileArg) {
  console.log(`\n=== parsing ${fileArg} ===`);
  try {
    const buffer = fs.readFileSync(path.resolve(fileArg));
    const report = buildMappingReport(buffer);
    console.log("detected mapping:");
    for (const mapping of report.mappings) {
      console.log(`  ${mapping.field.padEnd(18)} -> ${mapping.detectedColumn ?? "(not found)"}`);
    }
    const result = parseStandardCsv(buffer);
    console.log(`claims: ${result.claims.length}  errors: ${result.errors.length}  rows: ${result.totalRows}`);
    result.claims.slice(0, 3).forEach((claim, index) => {
      console.log(`  [${index + 1}] ${claim.patientName} | ${claim.insuranceName} | ${claim.dateOfService.toISOString().slice(0, 10)} | ${claim.balance} | ${claim.agingDays}d`);
    });
    result.errors.slice(0, 10).forEach((error) => {
      console.log(`  row ${error.row} [${error.field}]: ${error.message}`);
    });
  } catch (error) {
    console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
console.log("=".repeat(60));
process.exit(fail === 0 ? 0 : 1);
