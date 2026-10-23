/**
 * Stored dates with an implausible year (CALC-03, P1-04).
 *
 *   npx tsx scripts/report-bad-dates.ts
 *
 * Read-only. The validation bounds added in P1-04 stop new ones arriving;
 * these are the rows that were saved before it, and they have to be corrected
 * by hand because only the person who typed them knows what was meant.
 *
 * One of them — an EOB batch dated in the year 0206 — was on its own
 * responsible for "avg days to resolve: 2,428" against a median of 6.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { PrismaClient } from "../lib/generated/prisma/client";
import { MAX_DATE_YEARS_AHEAD, MIN_DATE_YEAR } from "../lib/calendar";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** table, column, and a column to identify the row by in the report. */
const COLUMNS: [string, string, string][] = [
  ["ar_claims", "dateOfService", "patientName"],
  ["ar_claims", "followUpDate", "patientName"],
  ["ar_batches", "targetCompletionDate", "id"],
  ["eob_batches", "batchDate", "payerName"],
  ["eob_entries", "dateOfService", "patientName"],
  ["tasks", "dueDate", "title"],
  ["tasks", "startDate", "title"],
  ["tasks", "holdReleaseDate", "title"],
  ["todos", "dueDate", "title"],
  ["todos", "holdReleaseDate", "title"],
  ["tracker_entries", "monthYear", "id"],
  ["time_blocks", "specificDate", "label"],
];

const SAMPLE_LIMIT = 20;

async function main() {
  const maxYear = new Date().getUTCFullYear() + MAX_DATE_YEARS_AHEAD;

  console.log(
    `Dates outside ${MIN_DATE_YEAR}–${maxYear}, by column.\n` +
      "Nothing is changed. Correct these through the app, or with a\n" +
      "one-off script once the intended value is known.\n",
  );

  let total = 0;

  for (const [table, column, label] of COLUMNS) {
    const condition = `"${column}" IS NOT NULL
      AND (EXTRACT(YEAR FROM "${column}") < ${MIN_DATE_YEAR}
           OR EXTRACT(YEAR FROM "${column}") > ${maxYear})`;

    const [count] = await prisma.$queryRawUnsafe<{ bad: number }[]>(
      `SELECT count(*)::int AS bad FROM "${table}" WHERE ${condition}`,
    );

    if (!count || count.bad === 0) continue;

    total += count.bad;
    console.log(`\n${table}.${column} — ${count.bad} row(s)`);

    const rows = await prisma.$queryRawUnsafe<
      { id: string; label: string | null; value: Date }[]
    >(
      `SELECT id, "${label}"::text AS label, "${column}" AS value
       FROM "${table}" WHERE ${condition}
       ORDER BY "${column}" LIMIT ${SAMPLE_LIMIT}`,
    );

    for (const row of rows) {
      console.log(
        `  ${row.value.toISOString().slice(0, 10)}  ${row.id}  ${row.label ?? ""}`,
      );
    }

    if (count.bad > rows.length) {
      console.log(`  … and ${count.bad - rows.length} more`);
    }
  }

  console.log(total === 0 ? "\nNothing out of range." : `\n${total} row(s) total.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
