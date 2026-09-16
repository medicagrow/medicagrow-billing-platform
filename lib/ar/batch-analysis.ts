import type { Prisma } from "@/lib/generated/prisma/client";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import type {
  AnalysisDimension,
  AnalysisResult,
  AnalysisRow,
} from "@/lib/ar/batch-insights-shared";

export * from "@/lib/ar/batch-insights-shared";

/**
 * The batch Analysis tab: claims pivoted by one dimension, optionally nested
 * by a second.
 *
 * **One grouped query**, whatever the dimensions — grouped by every column
 * either dimension needs, then folded into the tree in memory. The result set
 * is the number of distinct combinations, which is the size of the table being
 * drawn, not the size of the batch.
 *
 * Averages are **weighted**: the query returns summed aging days, and each
 * parent's average is its sum divided by its count. Averaging the children's
 * averages would let a two-claim status swing a two-hundred-claim payer.
 *
 * The `where` is the caller's, and must already carry the 0–30 day exclusion.
 */

type GroupColumn =
  | "insuranceName"
  | "statusLabel"
  | "visitStatus"
  | "renderingProvider"
  | "providerName"
  | "assignedToId"
  | "statusCategory";

const COLUMNS: Record<AnalysisDimension, GroupColumn[]> = {
  insurance: ["insuranceName"],
  statusLabel: ["statusLabel"],
  visitStatus: ["visitStatus"],
  // The claim list shows whichever provider field the claim has, so the pivot
  // does too — grouped by both, then merged on the one that is set.
  provider: ["renderingProvider", "providerName"],
  assignee: ["assignedToId"],
  statusCategory: ["statusCategory"],
};

type GroupedRow = Partial<Record<GroupColumn, string | null>> & {
  _count: { _all: number };
  _sum: { balance: unknown; agingDays: number | null };
};

function keyOf(dimension: AnalysisDimension, row: GroupedRow): string | null {
  switch (dimension) {
    case "insurance":
      return row.insuranceName ?? null;
    case "statusLabel":
      return row.statusLabel ?? null;
    case "visitStatus":
      return row.visitStatus?.trim() || null;
    case "provider":
      return row.renderingProvider?.trim() || row.providerName?.trim() || null;
    case "assignee":
      return row.assignedToId ?? null;
    case "statusCategory":
      return row.statusCategory ?? null;
  }
}

interface Accumulator {
  key: string | null;
  claims: number;
  cents: bigint;
  agingSum: number;
  children: Map<string, Accumulator>;
}

const newAccumulator = (key: string | null): Accumulator => ({
  key,
  claims: 0,
  cents: 0n,
  agingSum: 0,
  children: new Map(),
});

function add(target: Accumulator, row: GroupedRow) {
  target.claims += row._count._all;
  target.cents += toCents(row._sum.balance?.toString());
  target.agingSum += row._sum.agingDays ?? 0;
}

/** Map keys cannot be null, so "none" travels under a sentinel. */
const NONE = "\u0000none";

export async function runBatchAnalysis(input: {
  where: Prisma.ArClaimWhereInput;
  primary: AnalysisDimension;
  sub?: AnalysisDimension | null;
}): Promise<AnalysisResult> {
  const sub = input.sub && input.sub !== input.primary ? input.sub : null;

  const by = Array.from(
    new Set([...COLUMNS[input.primary], ...(sub ? COLUMNS[sub] : [])]),
  );

  const grouped = (await prisma.arClaim.groupBy({
    by,
    where: input.where,
    _count: { _all: true },
    _sum: { balance: true, agingDays: true },
  })) as unknown as GroupedRow[];

  const total = newAccumulator(null);
  const primaries = new Map<string, Accumulator>();

  for (const row of grouped) {
    add(total, row);

    const primaryKey = keyOf(input.primary, row);
    const primaryMapKey = primaryKey ?? NONE;

    let primary = primaries.get(primaryMapKey);
    if (!primary) {
      primary = newAccumulator(primaryKey);
      primaries.set(primaryMapKey, primary);
    }

    add(primary, row);

    if (sub) {
      const subKey = keyOf(sub, row);
      const subMapKey = subKey ?? NONE;

      let child = primary.children.get(subMapKey);
      if (!child) {
        child = newAccumulator(subKey);
        primary.children.set(subMapKey, child);
      }

      add(child, row);
    }
  }

  /**
   * Assignees group by id; the table shows names. One lookup for every id in
   * the result, not one per row.
   */
  const assigneeIds = new Set<string>();

  if (input.primary === "assignee" || sub === "assignee") {
    for (const row of grouped) {
      if (row.assignedToId) assigneeIds.add(row.assignedToId);
    }
  }

  const names = new Map(
    (assigneeIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: Array.from(assigneeIds) } },
          select: { id: true, name: true },
        })
      : []
    ).map((user) => [user.id, user.name]),
  );

  const labelFor = (dimension: AnalysisDimension, key: string | null) => {
    if (key === null) {
      return dimension === "assignee" ? "Unassigned" : "(none)";
    }

    if (dimension === "assignee") return names.get(key) ?? "Unknown user";
    return key;
  };

  const finish = (
    dimension: AnalysisDimension,
    accumulator: Accumulator,
  ): AnalysisRow => ({
    key: accumulator.key,
    label: labelFor(dimension, accumulator.key),
    claims: accumulator.claims,
    balance: centsToDecimalString(accumulator.cents),
    avgAgingDays:
      accumulator.claims === 0
        ? 0
        : Math.round(accumulator.agingSum / accumulator.claims),
  });

  // Largest balance first — the order a manager reads a payer list in.
  const byBalance = (a: Accumulator, b: Accumulator) =>
    b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : b.claims - a.claims;

  const rows = Array.from(primaries.values())
    .sort(byBalance)
    .map((primary) => ({
      ...finish(input.primary, primary),
      ...(sub
        ? {
            children: Array.from(primary.children.values())
              .sort(byBalance)
              .map((child) => finish(sub, child)),
          }
        : {}),
    }));

  const totals = finish(input.primary, total);

  return {
    primary: input.primary,
    sub,
    rows,
    total: {
      claims: totals.claims,
      balance: totals.balance,
      avgAgingDays: totals.avgAgingDays,
    },
  };
}
