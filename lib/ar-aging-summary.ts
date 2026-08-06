import { Prisma } from "@/lib/generated/prisma/client";
import { AGING_BUCKETS } from "@/lib/ar-aging";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";

/**
 * The five-bucket aging chart on the AR dashboard, grouped in the database.
 *
 * The page and the API route both used to fetch every claim in every open
 * batch — two columns, but all of them — and then run five `Array.filter`
 * passes over the result to draw five numbers. Postgres can bucket while it
 * scans, so this returns five rows instead of ten thousand.
 *
 * Kept beside the four-bucket insurance breakdown rather than merged with it:
 * the two use different bucket boundaries on purpose, and one function
 * pretending to serve both would have to take the boundaries as an argument
 * and would still run two queries.
 */

export interface AgingBucketSummary {
  key: string;
  label: string;
  claimCount: number;
  /** Decimal-safe string, summed by Postgres. */
  balance: string;
}

interface AgingBucketRow {
  bucket: string;
  claims: number;
  balance: string;
}

/**
 * The bucket boundaries as a SQL `CASE`, built from the same `AGING_BUCKETS`
 * the UI labels come from — so the chart's buckets and its axis cannot drift.
 */
function bucketExpression(): Prisma.Sql {
  const branches = AGING_BUCKETS.filter(
    (bucket) => bucket.max !== Number.MAX_SAFE_INTEGER,
  ).map(
    (bucket) =>
      Prisma.sql`WHEN c."agingDays" <= ${bucket.max} THEN ${bucket.key}`,
  );

  const last = AGING_BUCKETS[AGING_BUCKETS.length - 1]!;

  return Prisma.sql`CASE ${Prisma.join(branches, " ")} ELSE ${last.key} END`;
}

export async function agingSummary({
  batchIds,
  assignedToId,
}: {
  /** The open batches in view. An empty list yields empty buckets. */
  batchIds: string[];
  /** Narrows to one person's claims — a biller's view of their own book. */
  assignedToId?: string;
}): Promise<AgingBucketSummary[]> {
  const empty = () =>
    AGING_BUCKETS.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      claimCount: 0,
      balance: "0.00",
    }));

  if (batchIds.length === 0) return empty();

  const conditions: Prisma.Sql[] = [
    Prisma.sql`c."batchId" IN (${Prisma.join(batchIds)})`,
  ];

  if (assignedToId) {
    conditions.push(Prisma.sql`c."assignedToId" = ${assignedToId}`);
  }

  const rows = await prisma.$queryRaw<AgingBucketRow[]>`
    SELECT
      ${bucketExpression()} AS "bucket",
      COUNT(*)::int AS "claims",
      COALESCE(SUM(c.balance), 0)::text AS "balance"
    FROM ar_claims c
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY 1
  `;

  const byKey = new Map(rows.map((row) => [row.bucket, row]));

  // Buckets with nothing in them still appear, so the chart keeps its shape.
  return AGING_BUCKETS.map((bucket) => {
    const row = byKey.get(bucket.key);

    return {
      key: bucket.key,
      label: bucket.label,
      claimCount: row?.claims ?? 0,
      balance: row ? centsToDecimalString(toCents(row.balance)) : "0.00",
    };
  });
}
