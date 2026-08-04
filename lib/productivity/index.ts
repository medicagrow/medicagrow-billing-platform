import { Role, TaskStatus } from "@/lib/generated/prisma/enums";
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
  getLoggedMinutes,
  getTaskTypeProductivity,
} from "@/lib/productivity/task-time";
import {
  practiceFilterFor,
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

  const [activities, totalLoggedMinutes, taskTypeBreakdown] = await Promise.all([
    getActivitySummaries(query),
    getLoggedMinutes(query),
    getTaskTypeProductivity(query),
  ]);

  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    assignedPractices:
      user.role === Role.OWNER
        ? ["All practices"]
        : user.practices.map((entry) => entry.practice.name),
    activities,
    totalLoggedMinutes,
    taskTypeBreakdown,
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
  /** The report's own practice filter, already narrowed to what is allowed. */
  selectedPracticeIds?: string[];
  /** Restrict to practices the caller can see; null means all. */
  practiceIds: string[] | null;
  /** The report's biller filter; empty or absent means everyone in scope. */
  userIds?: string[];
}): Promise<BillerProductivity[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      /**
       * Billers and PMs are the standing roster. Anyone else who actually
       * closed work in the window joins them — an Owner covering a queue was
       * doing the work, and leaving them out made their completions vanish
       * from the only report that counts completions.
       */
      OR: [
        { role: { in: [Role.BILLER, Role.PROJECT_MANAGER] } },
        {
          tasksCompleted: {
            some: {
              status: TaskStatus.CLOSED,
              completedAt: { gte: query.from, lte: query.to },
              ...practiceFilterFor({
                practiceId: query.practiceId,
                practiceIds: query.selectedPracticeIds,
              }),
            },
          },
        },
      ],
      // A PM scoped to specific practices should not see staff from others.
      ...(query.practiceIds === null
        ? {}
        : { practices: { some: { practiceId: { in: query.practiceIds } } } }),
      ...(query.userIds && query.userIds.length > 0
        ? { id: { in: query.userIds } }
        : {}),
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
    users.map(async (user) => {
      const scoped = {
        userId: user.id,
        from: query.from,
        to: query.to,
        practiceId: query.practiceId,
        practiceIds: query.selectedPracticeIds,
      };

      const [activities, totalLoggedMinutes, taskTypeBreakdown] =
        await Promise.all([
          getActivitySummaries(scoped),
          getLoggedMinutes(scoped),
          getTaskTypeProductivity(scoped),
        ]);

      return {
        userId: user.id,
        userName: user.name,
        role: user.role,
        assignedPractices: user.practices.map((entry) => entry.practice.name),
        activities,
        totalLoggedMinutes,
        taskTypeBreakdown,
        dateRange: { from: query.from, to: query.to },
      };
    }),
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
