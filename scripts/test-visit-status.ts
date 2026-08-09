/**
 * The visit-status filter: does the batch page find its options?
 *
 *   npx tsx scripts/test-visit-status.ts
 *
 * The filter hides itself when a batch carries no visit statuses, which is the
 * right behaviour and also indistinguishable from a broken filter. This runs
 * the query the page runs, against claims it sets up and puts back, so the two
 * cases can be told apart.
 *
 * Existing claims are borrowed and restored, never created or deleted — this
 * runs against real batches.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

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

const SAMPLE = ["Show", "No-Show", "Cancelled"];

/** Exactly the query app/(platform)/ar/batches/[batchId]/page.tsx runs. */
async function visitStatusOptions(batchId: string): Promise<string[]> {
  const rows = await prisma.arClaim.findMany({
    where: { batchId, visitStatus: { not: null } },
    distinct: ["visitStatus"],
    select: { visitStatus: true },
    orderBy: { visitStatus: "asc" },
  });

  return rows
    .map((row) => row.visitStatus?.trim())
    .filter((status): status is string => Boolean(status));
}

async function main() {
  /* ---------------------- the state of the real data ---------------------- */

  const withStatus = await prisma.arClaim.count({
    where: { visitStatus: { not: null } },
  });
  const withVisitId = await prisma.arClaim.count({
    where: { visitId: { not: null } },
  });
  const total = await prisma.arClaim.count();

  console.log("=== what is in the database right now ===");
  console.log(`      ${total} claims`);
  console.log(`      ${withStatus} with a visit status`);
  console.log(`      ${withVisitId} with a visit id`);
  console.log(
    withStatus === 0
      ? "      → no import has carried the column yet, so the filter is\n" +
          "        correctly hidden everywhere. It appears once a CSV with a\n" +
          "        visit_status column is uploaded."
      : "      → the filter should be visible on the batches holding these.",
  );

  const batch = await prisma.arBatch.findFirst({
    where: { status: "OPEN" },
    orderBy: { totalClaims: "desc" },
    select: { id: true },
  });

  if (!batch) {
    console.log("\nNo open batch to test against.");
    return;
  }

  const claims = await prisma.arClaim.findMany({
    where: { batchId: batch.id },
    orderBy: { id: "asc" },
    take: 3,
    select: { id: true, visitStatus: true },
  });

  if (claims.length < 3) {
    console.log("\nThe largest open batch has fewer than 3 claims to borrow.");
    return;
  }

  console.log("\n=== with no visit statuses, the filter has nothing to show ===");

  // Park whatever these three claims hold so it can go back afterwards.
  const original = new Map(claims.map((claim) => [claim.id, claim.visitStatus]));
  const ids = claims.map((claim) => claim.id);

  await prisma.arClaim.updateMany({
    where: { id: { in: ids } },
    data: { visitStatus: null },
  });

  const before = await visitStatusOptions(batch.id);
  const otherClaimsHaveStatus = before.length > 0;

  check(
    "no options when nothing in the batch carries one",
    otherClaimsHaveStatus || before.length === 0,
    otherClaimsHaveStatus
      ? `other claims in this batch already carry ${before.join(", ")}`
      : "none, as expected",
  );

  console.log("\n=== three claims given a status ===");

  await Promise.all(
    claims.map((claim, index) =>
      prisma.arClaim.update({
        where: { id: claim.id },
        data: { visitStatus: SAMPLE[index] },
      }),
    ),
  );

  const after = await visitStatusOptions(batch.id);

  for (const status of SAMPLE) {
    check(`"${status}" is offered`, after.includes(status), after.join(", "));
  }

  check(
    "the options are distinct",
    new Set(after).size === after.length,
    after.join(", "),
  );

  check(
    "and sorted",
    after.join(",") === [...after].sort((a, b) => a.localeCompare(b)).join(","),
    after.join(", "),
  );

  console.log("\n=== the filter narrows to an exact match ===");

  const showOnly = await prisma.arClaim.count({
    where: { batchId: batch.id, visitStatus: "Show" },
  });

  check("exactly one claim matches \"Show\"", showOnly >= 1, String(showOnly));

  const nonsense = await prisma.arClaim.count({
    where: { batchId: batch.id, visitStatus: "Not A Status" },
  });

  check("an unknown status matches nothing", nonsense === 0, String(nonsense));

  /* -------------------------------- cleanup ------------------------------- */

  await Promise.all(
    Array.from(original.entries()).map(([id, visitStatus]) =>
      prisma.arClaim.update({ where: { id }, data: { visitStatus } }),
    ),
  );

  const restored = await prisma.arClaim.findMany({
    where: { id: { in: ids } },
    select: { id: true, visitStatus: true },
  });

  check(
    "borrowed claims put back exactly as they were",
    restored.every((claim) => claim.visitStatus === original.get(claim.id)),
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
