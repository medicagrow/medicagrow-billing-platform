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

function bucketFor(agingDays: number): BucketKey {
  if (agingDays <= 30) return "bucket0_30";
  if (agingDays <= 60) return "bucket31_60";
  if (agingDays <= 90) return "bucket61_90";
  return "bucket90plus";
}

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
  const claims = await prisma.arClaim.findMany({
    where: {
      ...(assignedToId ? { assignedToId } : {}),
      batch: {
        status: BatchStatus.OPEN,
        ...(selectedPracticeId
          ? { practiceId: selectedPracticeId }
          : practiceIds === null
            ? {}
            : { practiceId: { in: practiceIds } }),
      },
    },
    select: {
      insuranceName: true,
      agingDays: true,
      balance: true,
      statusCategory: true,
    },
  });

  const buckets: Record<CategoryFilter, Map<string, Accumulator>> = {
    ALL: new Map(),
    RED: new Map(),
    BLUE: new Map(),
    GREEN: new Map(),
  };

  for (const claim of claims) {
    const key = bucketFor(claim.agingDays);
    const cents = toCents(claim.balance.toString());

    for (const scope of ["ALL", claim.statusCategory] as CategoryFilter[]) {
      const map = buckets[scope];
      let accumulator = map.get(claim.insuranceName);

      if (!accumulator) {
        accumulator = emptyAccumulator();
        map.set(claim.insuranceName, accumulator);
      }

      accumulator.claims[key] += 1;
      accumulator.cents[key] += cents;
      accumulator.totalClaims += 1;
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
