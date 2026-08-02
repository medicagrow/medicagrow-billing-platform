/**
 * EOB status list after consolidation, and that no retired label survives.
 *
 *   npx tsx scripts/test-eob-status.ts
 */

import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import {
  ALL_EOB_STATUSES,
  EOB_BLUE_STATUSES,
  EOB_GREEN_STATUSES,
  EOB_RED_STATUSES,
  eobStatusToCategory,
  isKnownEobStatus,
  isResolvingStatus,
} from "../lib/eob-status";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** The three labels this consolidation retired. */
const RETIRED = [
  "Corrected and Resubmitted",
  "Awaiting Info from Practice",
  "Duplicate — Ignore",
];

console.log("=== the consolidated list ===");
{
  check(
    "five red statuses",
    EOB_RED_STATUSES.length === 5,
    EOB_RED_STATUSES.join(", "),
  );
  check(
    "one blue status",
    EOB_BLUE_STATUSES.length === 1 &&
      EOB_BLUE_STATUSES[0] === "Check with Office",
    EOB_BLUE_STATUSES.join(", "),
  );
  check(
    "five green statuses",
    EOB_GREEN_STATUSES.length === 5,
    EOB_GREEN_STATUSES.join(", "),
  );
  check("eleven in total", ALL_EOB_STATUSES.length === 11);

  check(
    "Duplicate replaced Duplicate — Ignore",
    (EOB_GREEN_STATUSES as readonly string[]).includes("Duplicate"),
  );

  for (const label of RETIRED) {
    check(
      `"${label}" is gone from the list`,
      !(ALL_EOB_STATUSES as string[]).includes(label),
    );
    check(`"${label}" is no longer a known status`, !isKnownEobStatus(label));
  }
}

console.log("\n=== categories and resolution ===");
{
  check("Check with Office is BLUE", eobStatusToCategory("Check with Office") === "BLUE");
  check("Resubmitted is GREEN", eobStatusToCategory("Resubmitted") === "GREEN");
  check("Duplicate is GREEN", eobStatusToCategory("Duplicate") === "GREEN");
  check("Pending Review is RED", eobStatusToCategory("Pending Review") === "RED");

  // A retired label reaching this function is unknown, and unknown means
  // outstanding rather than silently resolved.
  check(
    "a retired label falls back to RED",
    RETIRED.every((label) => eobStatusToCategory(label) === "RED"),
  );

  check(
    "every green status resolves",
    EOB_GREEN_STATUSES.every((label) => isResolvingStatus(label)),
  );
  check(
    "no red status resolves",
    EOB_RED_STATUSES.every((label) => !isResolvingStatus(label)),
  );
  check("Check with Office does not resolve", !isResolvingStatus("Check with Office"));
}

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  try {
    console.log("\n=== the database carries no retired label ===");

    const entries = await client.query<{ n: number }>(
      `select count(*)::int as n from eob_entries where "statusLabel" = any($1)`,
      [RETIRED],
    );
    check("no EOB entry uses one", entries.rows[0]!.n === 0, String(entries.rows[0]!.n));

    const notes = await client.query<{ n: number }>(
      `select count(*)::int as n from eob_work_notes where "statusChangedTo" = any($1)`,
      [RETIRED],
    );
    check("no EOB work note uses one", notes.rows[0]!.n === 0, String(notes.rows[0]!.n));

    const unknown = await client.query<{ statusLabel: string }>(
      `select distinct "statusLabel" from eob_entries`,
    );
    const stray = unknown.rows
      .map((row) => row.statusLabel)
      .filter((label) => !isKnownEobStatus(label));
    check(
      "every stored status is a known one",
      stray.length === 0,
      stray.join(", ") || "none stray",
    );

    // The AR module has its own "Corrected and Resubmitted" and the migration
    // must not have touched it.
    const arStill = await client.query<{ n: number }>(
      `select count(*)::int as n from ar_work_notes
        where "statusChangedTo" = 'Corrected and Resubmitted'`,
    );
    console.log(
      `      (AR notes still using "Corrected and Resubmitted": ${arStill.rows[0]!.n} — the AR list is separate and keeps it)`,
    );
  } finally {
    await client.end();
  }
}

main()
  .catch((error) => {
    console.error(error);
    fail++;
  })
  .finally(() => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
    console.log("=".repeat(60));
    process.exit(fail === 0 ? 0 : 1);
  });
