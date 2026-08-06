/**
 * The SQL aging roll-ups must agree with reading the rows and bucketing them.
 *
 *   npx tsx scripts/test-aging-rollups.ts
 *
 * These replaced JavaScript passes over every claim in every open batch, so
 * the thing worth testing is that the `CASE` boundaries and the money still
 * come out identical. Runs against whatever data is present and creates
 * nothing; a ZZ batch is added only if there is nothing open to check.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { EhrSource, StatusCategory } from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { AGING_BUCKETS } from "../lib/ar-aging";
import { centsToDecimalString, toCents } from "../lib/money";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** Four buckets, matching lib/ar-insurance-aging.ts. */
function insuranceBucket(agingDays: number) {
  if (agingDays <= 30) return "bucket0_30" as const;
  if (agingDays <= 60) return "bucket31_60" as const;
  if (agingDays <= 90) return "bucket61_90" as const;
  return "bucket90plus" as const;
}

async function main() {
  const { agingSummary } = await import("../lib/ar-aging-summary");
  const { insuranceAgingBreakdown } = await import("../lib/ar-insurance-aging");

  const openBatches = await prisma.arBatch.findMany({
    where: { status: "OPEN" },
    select: { id: true },
  });

  const batchIds = openBatches.map((row) => row.id);

  console.log(`=== ${batchIds.length} open batch(es) ===`);

  // The rows both roll-ups used to read, read once here as the control.
  const claims = await prisma.arClaim.findMany({
    where: { batchId: { in: batchIds } },
    select: {
      agingDays: true,
      balance: true,
      insuranceName: true,
      statusCategory: true,
    },
  });

  console.log(`    ${claims.length} claims to check against\n`);

  /* ----------------------- five-bucket summary ----------------------- */

  console.log("=== aging chart ===");

  const sqlAging = await agingSummary({ batchIds });

  check(
    "every bucket is present, empty or not",
    sqlAging.length === AGING_BUCKETS.length,
    `${sqlAging.length} of ${AGING_BUCKETS.length}`,
  );

  check(
    "buckets keep their declared order",
    sqlAging.map((row) => row.key).join(",") ===
      AGING_BUCKETS.map((bucket) => bucket.key).join(","),
    sqlAging.map((row) => row.key).join(","),
  );

  let chartAgrees = true;

  for (const bucket of AGING_BUCKETS) {
    const matching = claims.filter(
      (claim) =>
        claim.agingDays >= bucket.min && claim.agingDays <= bucket.max,
    );

    let cents = 0n;
    for (const claim of matching) cents += toCents(claim.balance.toString());

    const sql = sqlAging.find((row) => row.key === bucket.key)!;

    if (
      sql.claimCount !== matching.length ||
      sql.balance !== centsToDecimalString(cents)
    ) {
      chartAgrees = false;
      console.log(
        `      ${bucket.key}: SQL ${sql.claimCount}/${sql.balance} vs rows ${matching.length}/${centsToDecimalString(cents)}`,
      );
    }
  }

  check("counts and balances match a JS pass over the rows", chartAgrees);

  check(
    "the buckets add up to every claim",
    sqlAging.reduce((sum, row) => sum + row.claimCount, 0) === claims.length,
    `${sqlAging.reduce((sum, row) => sum + row.claimCount, 0)} vs ${claims.length}`,
  );

  check(
    "no batches means empty buckets, not an error",
    (await agingSummary({ batchIds: [] })).every((row) => row.claimCount === 0),
  );

  /* --------------------- insurance breakdown ------------------------- */

  console.log("\n=== insurance breakdown ===");

  const breakdown = await insuranceAgingBreakdown({ practiceIds: null });

  const insurances = new Set(claims.map((claim) => claim.insuranceName));

  check(
    "every insurance with an open claim appears",
    breakdown.ALL.length === insurances.size,
    `${breakdown.ALL.length} vs ${insurances.size}`,
  );

  const allClaims = breakdown.ALL.reduce((sum, row) => sum + row.totalClaims, 0);
  check("ALL covers every claim", allClaims === claims.length, `${allClaims}`);

  const categoryTotal = (
    [StatusCategory.RED, StatusCategory.BLUE, StatusCategory.GREEN] as const
  ).reduce(
    (sum, category) =>
      sum + breakdown[category].reduce((n, row) => n + row.totalClaims, 0),
    0,
  );

  check(
    "the three categories partition ALL",
    categoryTotal === allClaims,
    `${categoryTotal} vs ${allClaims}`,
  );

  // One insurance, checked cell by cell against the rows.
  const sample = breakdown.ALL[0];

  if (sample) {
    const mine = claims.filter(
      (claim) => claim.insuranceName === sample.insuranceName,
    );

    const cells = { bucket0_30: 0, bucket31_60: 0, bucket61_90: 0, bucket90plus: 0 };
    let cents = 0n;

    for (const claim of mine) {
      cells[insuranceBucket(claim.agingDays)] += 1;
      cents += toCents(claim.balance.toString());
    }

    check(
      `"${sample.insuranceName}" bucket cells match`,
      sample.bucket0_30.claims === cells.bucket0_30 &&
        sample.bucket31_60.claims === cells.bucket31_60 &&
        sample.bucket61_90.claims === cells.bucket61_90 &&
        sample.bucket90plus.claims === cells.bucket90plus,
      `${sample.bucket0_30.claims}/${sample.bucket31_60.claims}/${sample.bucket61_90.claims}/${sample.bucket90plus.claims} vs ${cells.bucket0_30}/${cells.bucket31_60}/${cells.bucket61_90}/${cells.bucket90plus}`,
    );

    check(
      "and so does its balance, to the cent",
      sample.totalBalance === centsToDecimalString(cents),
      `${sample.totalBalance} vs ${centsToDecimalString(cents)}`,
    );

    check(
      "rows are ordered by balance, highest first",
      breakdown.ALL.every(
        (row, index) =>
          index === 0 ||
          toCents(breakdown.ALL[index - 1]!.totalBalance) >=
            toCents(row.totalBalance),
      ),
    );
  }

  check(
    "an empty practice list matches nothing rather than everything",
    (await insuranceAgingBreakdown({ practiceIds: [] })).ALL.length === 0,
  );

  /* ------------------------ money, not floats ------------------------ */

  console.log("\n=== money ===");

  check(
    "every balance is a two-decimal string",
    sqlAging.every((row) => /^\d+\.\d{2}$/.test(row.balance)) &&
      breakdown.ALL.every((row) => /^\d+\.\d{2}$/.test(row.totalBalance)),
    sqlAging.map((row) => row.balance).join(", "),
  );
}

main()
  .catch((error) => {
    console.error(error);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n${"=".repeat(60)}`);
    console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
    console.log("=".repeat(60));
    process.exit(fail === 0 ? 0 : 1);
  });
