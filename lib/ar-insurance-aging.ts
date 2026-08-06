import { Prisma } from "@/lib/generated/prisma/client";
import { BatchStatus, StatusCategory } from "@/lib/generated/prisma/enums";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";

/**
 * Insurance-level aging breakdown across every OPEN batch.
 *
 * Buckets here are 0–30 / 31–60 / 61–90 / 90+ — four buckets, distinct from
 * the five-bucket AGING_BUCKETS used by the summary chart.
 */

export interface AgingCell {
  claims: number;
  balance: string;
}

export interface InsuranceAgingRow {
  insuranceName: string;
  bucket0_30: AgingCell;
  bucket31_60: AgingCell;
  bucket61_90: AgingCell;
  bucket90plus: AgingCell;
  totalClaims: number;
  totalBalance: string;
}

export type CategoryFilter = "ALL" | StatusCategory;

export type InsuranceAgingByCategory = Record<
  CategoryFilter,
  InsuranceAgingRow[]
>;

type BucketKey = "bucket0_30" | "bucket31_60" | "bucket61_90" | "bucket90plus";

interface Accumulator {
  claims: Record<BucketKey, number>;
  cents: Record<BucketKey, bigint>;
  totalClaims: number;
  totalCents: bigint;
}

const emptyAccumulator = (): Accumulator => ({
  claims: { bucket0_30: 0, bucket31_60: 0, bucket61_90: 0, bucket90plus: 0 },
  cents: { bucket0_30: 0n, bucket31_60: 0n, bucket61_90: 0n, bucket90plus: 0n },
  totalClaims: 0,
  totalCents: 0n,
});

function toRow(insuranceName: string, accumulator: Accumulator): InsuranceAgingRow {
  const cell = (key: BucketKey): AgingCell => ({
    claims: accumulator.claims[key],
    balance: centsToDecimalString(accumulator.cents[key]),
  });

  return {
    insuranceName,
    bucket0_30: cell("bucket0_30"),
    bucket31_60: cell("bucket31_60"),
    bucket61_90: cell("bucket61_90"),
    bucket90plus: cell("bucket90plus"),
    totalClaims: accumulator.totalClaims,
    totalBalance: centsToDecimalString(accumulator.totalCents),
  };
}

/** Highest outstanding balance first. */
function sortByBalance(rows: InsuranceAgingRow[]): InsuranceAgingRow[] {
  return rows.sort((a, b) => {
    const difference = toCents(b.totalBalance) - toCents(a.totalBalance);
    return difference > 0n ? 1 : difference < 0n ? -1 : 0;
  });
}

/** One (insurance, status, bucket) cell as Postgres returns it. */
interface AgingGroupRow {
  insuranceName: string;
  statusCategory: StatusCategory;
  bucket: BucketKey;
  claims: number;
  /** Numeric summed in the database and handed over as text, never a float. */
  balance: string;
}

/**
 * Insurance aging, grouped in the database.
 *
 * This used to read every claim in every open batch — around ten thousand rows
 * on the current data — and bucket them in JavaScript, on a page that renders
 * a table of maybe thirty numbers. The grouping is a `CASE` the database can
 * do while it scans, so the result set is now the size of the table being
 * drawn rather than the size of the claim book.
 *
 * Raw SQL because the buckets are ranges: Prisma's `groupBy` can group by a
 * column but not by an expression over one. Column names stay camelCase and
 * therefore quoted — Prisma maps table names, not columns.
 */
export async function insuranceAgingBreakdown({
  practiceIds,
  selectedPracticeId,
  assignedToId,
}: {
  /** null means "all practices" (Owner). */
  practiceIds: string[] | null;
  selectedPracticeId?: string;
  /** Narrows to one person's claims — a biller's view of their own book. */
  assignedToId?: string;
}): Promise<InsuranceAgingByCategory> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`b.status = ${BatchStatus.OPEN}::"BatchStatus"`,
  ];

  if (selectedPracticeId) {
    conditions.push(Prisma.sql`b."practiceId" = ${selectedPracticeId}`);
  } else if (practiceIds !== null) {
    // An empty list means "no practices", which must match nothing rather
    // than degrade into no filter at all.
    conditions.push(
      practiceIds.length === 0
        ? Prisma.sql`false`
        : Prisma.sql`b."practiceId" IN (${Prisma.join(practiceIds)})`,
    );
  }

  if (assignedToId) {
    conditions.push(Prisma.sql`c."assignedToId" = ${assignedToId}`);
  }

  const rows = await prisma.$queryRaw<AgingGroupRow[]>`
    SELECT
      c."insuranceName" AS "insuranceName",
      c."statusCategory" AS "statusCategory",
      CASE
        WHEN c."agingDays" <= 30 THEN 'bucket0_30'
        WHEN c."agingDays" <= 60 THEN 'bucket31_60'
        WHEN c."agingDays" <= 90 THEN 'bucket61_90'
        ELSE 'bucket90plus'
      END AS "bucket",
      COUNT(*)::int AS "claims",
      COALESCE(SUM(c.balance), 0)::text AS "balance"
    FROM ar_claims c
    JOIN ar_batches b ON b.id = c."batchId"
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY 1, 2, 3
  `;

  const buckets: Record<CategoryFilter, Map<string, Accumulator>> = {
    ALL: new Map(),
    RED: new Map(),
    BLUE: new Map(),
    GREEN: new Map(),
  };

  for (const row of rows) {
    const cents = toCents(row.balance);

    // Every cell counts once under its own status and once under ALL.
    for (const scope of ["ALL", row.statusCategory] as CategoryFilter[]) {
      const map = buckets[scope];
      let accumulator = map.get(row.insuranceName);

      if (!accumulator) {
        accumulator = emptyAccumulator();
        map.set(row.insuranceName, accumulator);
      }

      accumulator.claims[row.bucket] += row.claims;
      accumulator.cents[row.bucket] += cents;
      accumulator.totalClaims += row.claims;
      accumulator.totalCents += cents;
    }
  }

  const build = (scope: CategoryFilter) =>
    sortByBalance(
      Array.from(buckets[scope].entries()).map(([name, accumulator]) =>
        toRow(name, accumulator),
      ),
    );

  return {
    ALL: build("ALL"),
    RED: build(StatusCategory.RED),
    BLUE: build(StatusCategory.BLUE),
    GREEN: build(StatusCategory.GREEN),
  };
}
