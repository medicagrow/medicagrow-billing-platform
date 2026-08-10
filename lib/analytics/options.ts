import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { accessiblePracticeIds } from "@/lib/ar-access";

/**
 * What the analytics filter bar offers, scoped to the person asking.
 *
 * Loaded once per page rather than per filter: three dropdowns are three
 * round trips if each fetches its own, and every analytics page needs the
 * same three.
 */
export async function analyticsFilterOptions(user: {
  id: string;
  role: Role;
}) {
  const practiceIds = await accessiblePracticeIds(user);

  const [billers, practices, taskTypes] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        // Anyone who can run a timer can appear in these reports; PMs work
        // tasks too, so the roster is not only billers.
        ...(practiceIds === null
          ? {}
          : { practices: { some: { practiceId: { in: practiceIds } } } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.practice.findMany({
      where: {
        isActive: true,
        ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.taskType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return { billers, practices, taskTypes };
}
