import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  getArActivityDetail,
  getArProductivity,
  getArRecentActivity,
} from "@/lib/productivity/ar-productivity";
import {
  getWorkActivityDetail,
  getWorkProductivity,
  getWorkRecentActivity,
} from "@/lib/productivity/work-productivity";
import {
  totalActivity,
  type ActivityDetailPage,
  type ActivityDetailProvider,
  type ActivitySummary,
  type BillerProductivity,
  type ProductivityProvider,
  type ProductivityQuery,
} from "@/lib/productivity/types";

export * from "@/lib/productivity/types";
export { AR_ACTIVITIES, AR_ACTIVITY_LABELS } from "@/lib/productivity/ar-activities";
export {
  WORK_ACTIVITIES,
  WORK_ACTIVITY_LABELS,
} from "@/lib/productivity/work-activities";

/**
 * TO ADD A NEW MODULE: import its productivity function and add it here.
 * Nothing else needs to change — the API routes and pages iterate this array.
 */
const moduleProviders: ProductivityProvider[] = [
  getArProductivity,
  getWorkProductivity,
  // getEligibilityProductivity,  // uncomment when Eligibility module is built
  // getDenialProductivity,       // uncomment when Denial module is built
  // getEraPostingProductivity,   // uncomment when ERA/EOB module is built
];

/** And its drill-down provider here, so detail pages resolve its activities. */
const detailProviders: ActivityDetailProvider[] = [
  getArActivityDetail,
  getWorkActivityDetail,
  // getEligibilityActivityDetail,
];

/** And its timeline provider here. */
const recentActivityProviders = [
  getArRecentActivity,
  getWorkRecentActivity,
  // getEligibilityRecentActivity,
];

export async function getActivitySummaries(
  query: ProductivityQuery,
): Promise<ActivitySummary[]> {
  const results = await Promise.all(
    moduleProviders.map((provider) => provider(query)),
  );

  return results.flat();
}

export async function getBillerProductivity(
  query: ProductivityQuery,
): Promise<BillerProductivity | null> {
  const user = await prisma.user.findUnique({
    where: { id: query.userId },
    select: {
      id: true,
      name: true,
      role: true,
      practices: { select: { practice: { select: { name: true } } } },
    },
  });

  if (!user) return null;

  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    assignedPractices:
      user.role === Role.OWNER
        ? ["All practices"]
        : user.practices.map((entry) => entry.practice.name),
    activities: await getActivitySummaries(query),
    dateRange: { from: query.from, to: query.to },
  };
}

/**
 * Team view. Includes billers and PMs — the people who work claims — and any
 * user with recorded activity, ranked by total output.
 */
export async function getTeamProductivity(query: {
  from: Date;
  to: Date;
  practiceId?: string;
  /** Restrict to practices the caller can see; null means all. */
  practiceIds: string[] | null;
}): Promise<BillerProductivity[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: [Role.BILLER, Role.PROJECT_MANAGER] },
      // A PM scoped to specific practices should not see staff from others.
      ...(query.practiceIds === null
        ? {}
        : { practices: { some: { practiceId: { in: query.practiceIds } } } }),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      role: true,
      practices: { select: { practice: { select: { name: true } } } },
    },
  });

  const entries = await Promise.all(
    users.map(async (user) => ({
      userId: user.id,
      userName: user.name,
      role: user.role,
      assignedPractices: user.practices.map((entry) => entry.practice.name),
      activities: await getActivitySummaries({
        userId: user.id,
        from: query.from,
        to: query.to,
        practiceId: query.practiceId,
      }),
      dateRange: { from: query.from, to: query.to },
    })),
  );

  return entries.sort(
    (a, b) => totalActivity(b.activities) - totalActivity(a.activities),
  );
}

export async function getActivityDetail(
  query: ProductivityQuery & {
    activityKey: string;
    skip: number;
    take: number;
  },
): Promise<ActivityDetailPage | null> {
  for (const provider of detailProviders) {
    const page = await provider(query);
    if (page) return page;
  }

  return null;
}

export async function getRecentActivity(
  query: ProductivityQuery,
  limit = 20,
) {
  const results = await Promise.all(
    recentActivityProviders.map((provider) => provider(query, limit)),
  );

  return results
    .flat()
    .sort((a, b) => b.workedAt.localeCompare(a.workedAt))
    .slice(0, limit);
}
