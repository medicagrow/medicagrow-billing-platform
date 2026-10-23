/**
 * Follow-up dates that cannot be right (LOGIC-05, P1-07).
 *
 *   npx tsx scripts/report-followup-anomalies.ts
 *
 * Read-only, for PM cleanup. P1-07 stops new ones being saved; these were
 * saved before it and are still inflating every overdue count.
 *
 * Three groups, most suspicious first:
 *   1. a year that is clearly a typo — the same day and month as another year
 *   2. dated before the claim's own date of service
 *   3. simply in the past, on an open batch
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { PrismaClient } from "../lib/generated/prisma/client";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const LIMIT = 40;

async function main() {
  console.log("Follow-up dates needing a look. Nothing is changed.\n");

  const typos = await prisma.$queryRaw<
    {
      practice: string;
      patient: string;
      followUp: Date;
      dos: Date;
      assignee: string | null;
      claimId: string;
    }[]
  >`
    SELECT p.name AS practice, c."patientName" AS patient,
           c."followUpDate" AS "followUp", c."dateOfService" AS dos,
           u.name AS assignee, c.id AS "claimId"
    FROM ar_claims c
    JOIN ar_batches b ON b.id = c."batchId"
    JOIN "Practice" p ON p.id = b."practiceId"
    LEFT JOIN "User" u ON u.id = c."assignedToId"
    WHERE c."followUpDate" IS NOT NULL
      AND b.status = 'OPEN'
      AND c."followUpDate" < CURRENT_DATE - INTERVAL '1 year'
    ORDER BY c."followUpDate"
    LIMIT ${LIMIT}
  `;

  console.log(`1. Over a year in the past — likely a mistyped year (${typos.length} shown)`);
  for (const row of typos) {
    console.log(
      `   follow-up ${row.followUp.toISOString().slice(0, 10)}  DOS ${row.dos
        .toISOString()
        .slice(0, 10)}  ${row.practice} · ${row.patient} · ${row.assignee ?? "unassigned"}`,
    );
  }

  const beforeDos = await prisma.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM ar_claims c JOIN ar_batches b ON b.id = c."batchId"
    WHERE b.status = 'OPEN' AND c."followUpDate" IS NOT NULL
      AND c."followUpDate" < c."dateOfService"
  `;

  console.log(
    `\n2. Dated before the claim's date of service: ${beforeDos[0]?.count ?? 0}`,
  );

  const summary = await prisma.$queryRaw<
    { assignee: string | null; past: number; oldest: Date }[]
  >`
    SELECT u.name AS assignee, count(*)::int AS past, min(c."followUpDate") AS oldest
    FROM ar_claims c
    JOIN ar_batches b ON b.id = c."batchId"
    LEFT JOIN "User" u ON u.id = c."assignedToId"
    WHERE b.status = 'OPEN' AND c."followUpDate" < CURRENT_DATE
    GROUP BY 1 ORDER BY 2 DESC
  `;

  const total = summary.reduce((sum, row) => sum + row.past, 0);
  console.log(`\n3. Past-dated on an open batch: ${total}, by assignee`);
  for (const row of summary) {
    console.log(
      `   ${String(row.past).padStart(5)}  oldest ${row.oldest
        .toISOString()
        .slice(0, 10)}  ${row.assignee ?? "(unassigned)"}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
