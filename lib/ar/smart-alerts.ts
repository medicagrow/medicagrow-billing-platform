import { Prisma } from "@/lib/generated/prisma/client";
import { Role, StatusCategory } from "@/lib/generated/prisma/enums";
import { ACTIONABLE_WHERE } from "@/lib/ar-actionable";
import { daysBetween, startOfTodayUtc } from "@/lib/ar-stats";
import { formatDate, formatUSD } from "@/lib/format";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { workingDaysBetween } from "@/lib/task/daily-hours";
import { isWeekend } from "@/lib/task/recurrence-config";
import {
  ALERT_THRESHOLDS as T,
  SEVERITY_ORDER,
  type AlertType,
  type SmartAlert,
} from "@/lib/ar/batch-insights-shared";

export * from "@/lib/ar/batch-insights-shared";

/**
 * Smart Alerts: the things in a batch a manager should look at today.
 *
 * Every detector here is a **claim condition first and an alert second**.
 * `alertClaimWhere()` returns the Prisma condition for a detector, and the
 * same function serves two callers: the detector, which counts and sums it,
 * and the claim list, which shows it when "View affected claims" is pressed.
 * An alert that says "14 claims" and a list that then shows 11 would be worse
 * than no alert, and sharing the condition is what rules that out.
 *
 * **Every claim condition excludes 0–30 day claims.** It is added once, in
 * `baseWhere`, rather than remembered by each detector.
 */

export interface AlertContext {
  batchId: string;
  today: Date;
  uploadedAt: Date;
  targetCompletionDate: Date | null;
  /** Set for a biller: every figure is their own claims. */
  assignedToId?: string;
}

const daysAgo = (today: Date, days: number) => {
  const date = new Date(today.getTime());
  date.setUTCDate(date.getUTCDate() - days);
  return date;
};

/** N working days before today — weekends do not count as idle days. */
function workingDaysAgo(today: Date, days: number) {
  const date = new Date(today.getTime());
  let remaining = days;

  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (!isWeekend(date)) remaining--;
  }

  return date;
}

function addWorkingDays(from: Date, days: number) {
  const date = new Date(from.getTime());
  let remaining = Math.ceil(days);

  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!isWeekend(date)) remaining--;
  }

  return date;
}

function baseWhere(context: AlertContext): Prisma.ArClaimWhereInput {
  return {
    batchId: context.batchId,
    ...ACTIONABLE_WHERE,
    ...(context.assignedToId ? { assignedToId: context.assignedToId } : {}),
  };
}

const noNoteSince = (since: Date): Prisma.ArClaimWhereInput => ({
  workNotes: { none: { workedAt: { gte: since } } },
});

/** Case- and space-insensitive, so "PRECERTIFICATION…" and "Precertification…" are one reason. */
const normaliseReason = Prisma.sql`LOWER(TRIM(n."structuredFields"->>'denialReason'))`;

/**
 * Claim ids behind one systematic-denial group. Resolved by id because the
 * grouping is case-insensitive, which a Prisma JSON filter cannot express.
 * Bounded by the batch, so the list stays small.
 */
async function systematicDenialClaimIds(
  context: AlertContext,
  insuranceName: string,
  reasonKey: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT c.id
    FROM ar_work_notes n
    JOIN ar_claims c ON c.id = n."claimId"
    WHERE c."batchId" = ${context.batchId}
      AND c."agingDays" > 30
      AND n."outcomeType" = 'DENIED'::"OutcomeType"
      AND c."insuranceName" = ${insuranceName}
      AND ${normaliseReason} = ${reasonKey}
      ${context.assignedToId ? Prisma.sql`AND c."assignedToId" = ${context.assignedToId}` : Prisma.empty}
  `;

  return rows.map((row) => row.id);
}

/**
 * The claim condition behind an alert. `key` distinguishes alerts of one type
 * that cover different claims — a payer and reason for a denial pattern.
 */
export async function alertClaimWhere(
  type: AlertType,
  key: string | null,
  context: AlertContext,
): Promise<Prisma.ArClaimWhereInput> {
  const base = baseWhere(context);
  const { today } = context;

  switch (type) {
    case "TIMELY_FILING":
      return {
        AND: [
          base,
          {
            agingDays: {
              gt: T.timelyFilingMinDays,
              lte: T.timelyFilingMaxDays,
            },
          },
          noNoteSince(daysAgo(today, T.timelyFilingQuietDays)),
        ],
      };

    case "PACE":
      // What is left to do: actionable claims nobody has logged a note on.
      return { AND: [base, { workNotes: { none: {} } }] };

    case "SYSTEMATIC_DENIAL": {
      const [insuranceName, reasonKey] = parseKey(key);
      const ids = insuranceName
        ? await systematicDenialClaimIds(context, insuranceName, reasonKey)
        : [];
      return { AND: [base, { id: { in: ids } }] };
    }

    case "FORGOTTEN_IN_PROCESS":
      return {
        AND: [
          base,
          { statusLabel: "In Process", followUpDate: { lt: today } },
          noNoteSince(daysAgo(today, T.forgottenInProcessQuietDays)),
        ],
      };

    case "UNACTIONED_BLUE":
      return {
        AND: [
          base,
          {
            statusCategory: StatusCategory.BLUE,
            assignedTo: {
              is: { role: { in: [Role.PROJECT_MANAGER, Role.OWNER] } },
            },
          },
          noNoteSince(daysAgo(today, T.unactionedBlueDays)),
        ],
      };

    case "HIGH_BALANCE_IDLE":
      return {
        AND: [
          base,
          { balance: { gt: T.highBalanceMin } },
          noNoteSince(daysAgo(today, T.highBalanceQuietDays)),
        ],
      };

    case "AGING_WORSENING": {
      // Claims that crossed into 90+ days in the last week and are unresolved.
      const since = daysBetween(context.uploadedAt, today);
      const threshold = 90 - since;

      return {
        AND: [
          base,
          { statusCategory: { not: StatusCategory.GREEN } },
          {
            agingDays: {
              gt: threshold,
              lte: threshold + T.agingWorseningWindowDays,
            },
          },
        ],
      };
    }

    case "BILLER_IDLE":
      return {
        AND: [
          base,
          { statusCategory: StatusCategory.RED, assignedToId: key ?? "" },
        ],
      };
  }
}

const packKey = (...parts: string[]) => JSON.stringify(parts);

function parseKey(key: string | null): [string, string] {
  try {
    const parsed = JSON.parse(key ?? "");
    return Array.isArray(parsed) && parsed.length === 2
      ? [String(parsed[0]), String(parsed[1])]
      : ["", ""];
  } catch {
    return ["", ""];
  }
}

/* -------------------------------------------------------------------------- */

async function measure(where: Prisma.ArClaimWhereInput) {
  const result = await prisma.arClaim.aggregate({
    where,
    _count: { _all: true },
    _sum: { balance: true },
  });

  return {
    count: result._count._all,
    balance: (result._sum.balance ?? 0).toString(),
  };
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Builds an alert from a detector's claim condition, or nothing when the
 * condition matches no claims.
 */
async function alertFrom(
  context: AlertContext,
  spec: Omit<SmartAlert, "affectedCount" | "affectedBalance" | "claimFilter" | "title"> & {
    key?: string;
    title: (count: number, balance: string) => string;
    claimFilter?: Record<string, string>;
    /** Some alerts still show at zero affected claims (pace is about time). */
    allowEmpty?: boolean;
  },
): Promise<SmartAlert | null> {
  const where = await alertClaimWhere(spec.type, spec.key ?? null, context);
  const { count, balance } = await measure(where);

  if (count === 0 && !spec.allowEmpty) return null;

  return {
    id: spec.id,
    type: spec.type,
    category: spec.category,
    severity: spec.severity,
    title: spec.title(count, balance),
    description: spec.description,
    affectedCount: count,
    affectedBalance: balance,
    claimFilter: spec.claimFilter ?? {
      alert: spec.type,
      ...(spec.key ? { alertKey: spec.key } : {}),
    },
  };
}

/* ------------------------------- detectors ------------------------------- */

const timelyFiling = (context: AlertContext) =>
  alertFrom(context, {
    id: "TIMELY_FILING",
    type: "TIMELY_FILING",
    category: "TIMELY_FILING",
    severity: "HIGH",
    title: (count) => `${plural(count, "claim")} approaching timely filing risk`,
    description:
      "These claims are 90-120 days old with no recent follow-up. Act before timely filing deadline.",
  });

async function pace(context: AlertContext): Promise<SmartAlert | null> {
  const target = context.targetCompletionDate;
  if (!target) return null;

  const base = baseWhere(context);

  const [total, worked] = await Promise.all([
    prisma.arClaim.count({ where: base }),
    prisma.arClaim.count({
      where: { AND: [base, { workNotes: { some: {} } }] },
    }),
  ]);

  if (total === 0) return null;

  const totalDays = workingDaysBetween(context.uploadedAt, target);
  if (totalDays <= 0) return null;

  const elapsedEnd = context.today < target ? context.today : target;
  const elapsedDays = workingDaysBetween(context.uploadedAt, elapsedEnd);

  const timeRate = Math.min(1, elapsedDays / totalDays);
  const completionRate = worked / total;

  if (completionRate >= timeRate - T.paceTolerance) return null;

  /**
   * Projected from the rate so far: claims worked per working day elapsed,
   * carried forward over what is left. With nothing worked yet there is no
   * rate to carry, and saying so beats inventing a date.
   */
  const perDay = elapsedDays > 0 ? worked / elapsedDays : 0;
  const projection =
    perDay > 0
      ? `On current pace, completion expected ${formatDate(
          addWorkingDays(context.today, (total - worked) / perDay),
        )}.`
      : "No claims have been worked yet, so completion cannot be projected.";

  return alertFrom(context, {
    id: "PACE",
    type: "PACE",
    category: "PACE",
    severity: "HIGH",
    title: () =>
      "Batch is behind pace — at current rate will not complete by target date",
    description: `${Math.round(completionRate * 100)}% complete with ${Math.round(
      timeRate * 100,
    )}% of time elapsed. ${projection}`,
    allowEmpty: true,
  });
}

async function systematicDenials(context: AlertContext) {
  const groups = await prisma.$queryRaw<
    { insuranceName: string; reasonKey: string; reason: string; claims: number }[]
  >`
    SELECT c."insuranceName" AS "insuranceName",
           ${normaliseReason} AS "reasonKey",
           MIN(TRIM(n."structuredFields"->>'denialReason')) AS "reason",
           COUNT(DISTINCT c.id)::int AS "claims"
    FROM ar_work_notes n
    JOIN ar_claims c ON c.id = n."claimId"
    WHERE c."batchId" = ${context.batchId}
      AND c."agingDays" > 30
      AND n."outcomeType" = 'DENIED'::"OutcomeType"
      AND COALESCE(TRIM(n."structuredFields"->>'denialReason'), '') <> ''
      ${context.assignedToId ? Prisma.sql`AND c."assignedToId" = ${context.assignedToId}` : Prisma.empty}
    GROUP BY 1, 2
    HAVING COUNT(DISTINCT c.id) >= ${T.systematicDenialMinClaims}
    ORDER BY 4 DESC
  `;

  const alerts = await Promise.all(
    groups.map((group) =>
      alertFrom(context, {
        id: `SYSTEMATIC_DENIAL:${group.insuranceName}:${group.reasonKey}`,
        type: "SYSTEMATIC_DENIAL",
        key: packKey(group.insuranceName, group.reasonKey),
        category: "QUALITY",
        severity: "MEDIUM",
        title: (count) =>
          `${group.insuranceName} denying ${plural(count, "claim")} for ${group.reason}`,
        description:
          "Systematic denial pattern detected. A single call may resolve multiple claims.",
      }),
    ),
  );

  return alerts;
}

const forgottenInProcess = (context: AlertContext) =>
  alertFrom(context, {
    id: "FORGOTTEN_IN_PROCESS",
    type: "FORGOTTEN_IN_PROCESS",
    category: "QUALITY",
    severity: "MEDIUM",
    title: (count) =>
      `${plural(count, "'In Process' claim")} with overdue follow-up (30+ days since last action)`,
    description:
      "These claims were marked In Process but have not been followed up. They may need to be re-checked.",
  });

const unactionedBlue = (context: AlertContext) =>
  alertFrom(context, {
    id: "UNACTIONED_BLUE",
    type: "UNACTIONED_BLUE",
    category: "QUALITY",
    severity: "MEDIUM",
    title: (count) =>
      `${plural(count, "claim")} reassigned to PM sitting unactioned for 3+ days`,
    description:
      "These claims need practice coordination but have had no action since being reassigned.",
  });

const highBalanceIdle = (context: AlertContext) =>
  alertFrom(context, {
    id: "HIGH_BALANCE_IDLE",
    type: "HIGH_BALANCE_IDLE",
    category: "FINANCIAL",
    severity: "HIGH",
    title: (count, balance) =>
      `${plural(count, "high-value claim")} (${formatUSD(balance)} total) with no recent follow-up`,
    description:
      "Claims over $500 with no follow-up in 14+ days. Prioritize these to protect revenue.",
  });

/**
 * Whether the 90+ day balance grew by more than 10% over the last week.
 *
 * `agingDays` is a snapshot taken at import and does not move, so a claim's
 * **current** age is its snapshot plus the days since the batch was uploaded.
 * That makes "90+ now" and "90+ a week ago" two thresholds on one column.
 * Resolution is read from the notes: a claim that turned green within the week
 * was still unresolved a week ago, so it counts in "then" but not in "now".
 */
async function agingWorsening(context: AlertContext): Promise<SmartAlert | null> {
  const since = daysBetween(context.uploadedAt, context.today);

  // A batch younger than the window has no "a week ago" to compare against.
  if (since < T.agingWorseningWindowDays) return null;

  const weekAgo = daysAgo(context.today, T.agingWorseningWindowDays);
  const base = baseWhere(context);

  const [now, then] = await Promise.all([
    prisma.arClaim.aggregate({
      where: {
        AND: [
          base,
          { statusCategory: { not: StatusCategory.GREEN } },
          { agingDays: { gt: 90 - since } },
        ],
      },
      _sum: { balance: true },
    }),
    prisma.arClaim.aggregate({
      where: {
        AND: [
          base,
          { agingDays: { gt: 90 - (since - T.agingWorseningWindowDays) } },
          {
            OR: [
              { statusCategory: { not: StatusCategory.GREEN } },
              { lastWorkedAt: { gte: weekAgo } },
            ],
          },
        ],
      },
      _sum: { balance: true },
    }),
  ]);

  const nowCents = toCents((now._sum.balance ?? 0).toString());
  const thenCents = toCents((then._sum.balance ?? 0).toString());

  if (thenCents === 0n || nowCents <= thenCents) return null;

  const increase = Number(nowCents - thenCents) / Number(thenCents);

  if (increase <= T.agingWorseningIncrease) return null;

  return alertFrom(context, {
    id: "AGING_WORSENING",
    type: "AGING_WORSENING",
    category: "FINANCIAL",
    severity: "MEDIUM",
    title: () =>
      `AR aging is worsening — 90+ day balance increased ${Math.round(
        increase * 100,
      )}% this week`,
    description: `More claims are aging into the 90+ day bucket than are being resolved (${formatUSD(
      centsToDecimalString(thenCents),
    )} a week ago, ${formatUSD(centsToDecimalString(nowCents))} now).`,
    allowEmpty: true,
  });
}

async function billersIdle(context: AlertContext) {
  const red = await prisma.arClaim.groupBy({
    by: ["assignedToId"],
    where: {
      ...baseWhere(context),
      statusCategory: StatusCategory.RED,
      assignedToId: { not: null },
      assignedTo: { is: { role: Role.BILLER, isActive: true } },
    },
    _count: { _all: true },
    _sum: { balance: true },
  });

  const loaded = red.filter(
    (row) => row.assignedToId && row._count._all > T.billerIdleMinRedClaims,
  );

  if (loaded.length === 0) return [];

  const ids = loaded.map((row) => row.assignedToId!);
  const cutoff = workingDaysAgo(context.today, T.billerIdleWorkingDays);

  // Any note anywhere counts: a biller busy on another practice is not idle.
  const [active, users] = await Promise.all([
    prisma.arWorkNote.groupBy({
      by: ["workedById"],
      where: { workedById: { in: ids }, workedAt: { gte: cutoff } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    }),
  ]);

  const busy = new Set(active.map((row) => row.workedById));

  return loaded
    .filter((row) => !busy.has(row.assignedToId!))
    .map((row): SmartAlert => {
      const userId = row.assignedToId!;
      const name = users.find((user) => user.id === userId)?.name ?? "A biller";

      return {
        id: `BILLER_IDLE:${userId}`,
        type: "BILLER_IDLE",
        category: "BILLER",
        severity: "LOW",
        title: `${name} has ${row._count._all} assigned claims with no activity in 3 days`,
        description: "May need follow-up from PM.",
        affectedCount: row._count._all,
        affectedBalance: (row._sum.balance ?? 0).toString(),
        // The list's ordinary filters express this one exactly.
        claimFilter: {
          statusCategories: StatusCategory.RED,
          assignedToIds: userId,
        },
      };
    });
}

/* -------------------------------------------------------------------------- */

export async function loadAlertContext(
  batchId: string,
  assignedToId?: string,
): Promise<AlertContext | null> {
  const batch = await prisma.arBatch.findUnique({
    where: { id: batchId },
    select: { uploadedAt: true, targetCompletionDate: true },
  });

  if (!batch) return null;

  return {
    batchId,
    today: startOfTodayUtc(),
    uploadedAt: batch.uploadedAt,
    targetCompletionDate: batch.targetCompletionDate,
    assignedToId,
  };
}

/**
 * Every alert for a batch, most severe first.
 *
 * For a biller the claim alerts are narrowed to their own claims, and the
 * three that are about managing a team or a batch — pace, unactioned blue
 * claims and idle billers — are left out.
 */
export async function detectSmartAlerts(
  context: AlertContext,
): Promise<SmartAlert[]> {
  const managerView = !context.assignedToId;

  const results = await Promise.all([
    timelyFiling(context),
    managerView ? pace(context) : null,
    systematicDenials(context),
    forgottenInProcess(context),
    managerView ? unactionedBlue(context) : null,
    highBalanceIdle(context),
    agingWorsening(context),
    managerView ? billersIdle(context) : [],
  ]);

  return results
    .flat()
    .filter((alert): alert is SmartAlert => alert !== null)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        Number(toCents(b.affectedBalance) - toCents(a.affectedBalance)),
    );
}
