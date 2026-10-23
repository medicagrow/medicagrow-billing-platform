/**
 * The one EOB batch date typed as the year 0206 (CALC-03, P1-04).
 *
 *   npx tsx scripts/fix-eob-batch-date-0206.ts            # dry run
 *   npx tsx scripts/fix-eob-batch-date-0206.ts --confirm  # applies
 *
 * Owner-approved, one row: a Noridian batch stored as 0206-10-02, which is
 * 2026-10-02 with a digit dropped. Its entry resolved on 2026-10-06, so the
 * corrected date puts the gap at 4 days instead of 664,747.
 *
 * Idempotent and narrow by construction: it matches only batches whose year
 * is below MIN_DATE_YEAR and whose month and day already agree with the
 * intended date, and it corrects the year alone. Run twice and the second run
 * finds nothing.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { PrismaClient } from "../lib/generated/prisma/client";
import { MIN_DATE_YEAR } from "../lib/calendar";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const confirmed = process.argv.includes("--confirm");

/**
 * Corrections the owner has approved, as exact dates.
 *
 * Deliberately a lookup rather than a rule. There is no reliable way to derive
 * 2026 from 206 — it could be a dropped digit or a transposition — and a
 * script that guesses at a year would be a worse problem than the one it
 * fixes. The intended value here comes from context: the batch's own entry was
 * resolved on 2026-10-06, four days after the corrected date.
 */
const APPROVED: { from: string; to: string; payer: string }[] = [
  {
    from: "0206-10-02",
    to: "2026-10-02",
    payer: "NORIDIAN HEALTHCARE SOLUTIONS, LLC",
  },
];

async function main() {
  const suspect = await prisma.$queryRawUnsafe<
    { id: string; payerName: string; batchDate: Date; entries: number }[]
  >(`
    SELECT b.id, b."payerName", b."batchDate",
           (SELECT count(*)::int FROM eob_entries e WHERE e."eobBatchId" = b.id) AS entries
    FROM eob_batches b
    WHERE EXTRACT(YEAR FROM b."batchDate") < ${MIN_DATE_YEAR}
    ORDER BY b."batchDate"
  `);

  if (suspect.length === 0) {
    console.log("No EOB batch date is below the supported range. Nothing to do.");
    return;
  }

  console.log(`${suspect.length} batch date(s) below year ${MIN_DATE_YEAR}:\n`);

  for (const batch of suspect) {
    const asIso = batch.batchDate.toISOString().slice(0, 10);
    const approved = APPROVED.find(
      (entry) => entry.from === asIso && entry.payer === batch.payerName,
    );

    if (!approved) {
      console.log(
        `  SKIP  ${asIso}  ${batch.payerName} — not in the approved list, correct by hand`,
      );
      continue;
    }

    console.log(
      `  ${confirmed ? "FIXED" : "WOULD FIX"}  ${asIso} → ${approved.to}  ${
        batch.payerName
      }  (${batch.entries} entr${batch.entries === 1 ? "y" : "ies"})`,
    );

    if (confirmed) {
      await prisma.eobBatch.update({
        where: { id: batch.id },
        data: { batchDate: new Date(`${approved.to}T00:00:00.000Z`) },
      });
    }
  }

  console.log(
    confirmed
      ? "\nDone. Re-run to confirm nothing remains."
      : "\nDry run. Pass --confirm to apply.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
