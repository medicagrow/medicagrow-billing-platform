import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { AssignTodoButton } from "@/components/todo/AssignTodoButton";
import { ProgressBar, progressTextClass } from "@/components/ui/ProgressBar";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { Role, TodoStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { assignableUsersFor, taskPracticeOptions } from "@/lib/task-options";
import { dayEnd, dayStart } from "@/lib/todo/access";

export const metadata: Metadata = { title: "Team To Dos" };
export const dynamic = "force-dynamic";

export default async function TeamTodosPage({
  searchParams,
}: {
  searchParams: { practiceId?: string };
}) {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const practiceIds = await accessiblePracticeIds(user);

  const selectedPracticeId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  const today = dayStart();
  const endOfToday = dayEnd(today);

  const startOfMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );

  const endOfWeek = new Date(today);
  endOfWeek.setUTCDate(endOfWeek.getUTCDate() + 7);

  const [practices, assignableUsers] = await Promise.all([
    taskPracticeOptions(user),
    assignableUsersFor(user),
  ]);

  const members = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: [Role.BILLER, Role.PROJECT_MANAGER] },
      ...(practiceIds === null
        ? {}
        : { practices: { some: { practiceId: { in: practiceIds } } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  const practiceFilter = selectedPracticeId
    ? { practiceId: selectedPracticeId }
    : {};

  const open = { status: { in: [TodoStatus.OPEN, TodoStatus.IN_PROCESS] } };

  /**
   * Five queries for the whole team, not five per person.
   *
   * Each is a `groupBy` over the assignee, which is what the table is keyed
   * on anyway. The date conditions differ between them, so they stay separate
   * queries rather than becoming one grouped by status.
   */
  const memberIds = members.map((member) => member.id);

  const forAll = { assignedToId: { in: memberIds }, ...practiceFilter };

  const countBy = (where: Record<string, unknown>) =>
    prisma.todo.groupBy({
      by: ["assignedToId"],
      where,
      _count: { _all: true },
    });

  const [
    dueTodayRows,
    overdueRows,
    thisWeekRows,
    completedRows,
    createdRows,
  ] =
    memberIds.length === 0
      ? [[], [], [], [], []]
      : await Promise.all([
          countBy({ ...forAll, dueDate: { gte: today, lte: endOfToday }, ...open }),
          countBy({ ...forAll, dueDate: { lt: today }, ...open }),
          countBy({ ...forAll, dueDate: { gte: today, lt: endOfWeek }, ...open }),
          countBy({
            ...forAll,
            status: TodoStatus.CLOSED,
            completedAt: { gte: startOfMonth },
          }),
          countBy({ ...forAll, createdAt: { gte: startOfMonth } }),
        ]);

  const countFor = (
    rows: { assignedToId: string; _count: { _all: number } }[],
    memberId: string,
  ) => rows.find((row) => row.assignedToId === memberId)?._count._all ?? 0;

  const stats = members.map((member) => {
    const completedThisMonth = countFor(completedRows, member.id);
    const createdThisMonth = countFor(createdRows, member.id);

    // Completion rate compares what was closed against what landed on them
    // this month — a rate over 100% just means they cleared a backlog.
    const completionRate =
      createdThisMonth === 0
        ? completedThisMonth > 0
          ? 100
          : 0
        : Math.min(
            100,
            Math.round((completedThisMonth / createdThisMonth) * 100),
          );

    return {
      ...member,
      dueToday: countFor(dueTodayRows, member.id),
      overdue: countFor(overdueRows, member.id),
      thisWeek: countFor(thisWeekRows, member.id),
      completedThisMonth,
      createdThisMonth,
      completionRate,
    };
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Team To Dos"
        description="Workload and completion across the team this month."
        action={
          <AssignTodoButton
            practices={practices}
            assignableUsers={assignableUsers}
            currentUserId={user.id}
          />
        }
      />

      {stats.length === 0 ? (
        <EmptyState
          title="No team members to show"
          description="Billers and project managers appear here once assigned to a practice."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Due today</th>
                <th className="px-4 py-3 text-right">Overdue</th>
                <th className="px-4 py-3 text-right">This week</th>
                <th className="px-4 py-3 text-right">Done this month</th>
                <th className="px-4 py-3">Completion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/todos/list?assignedToId=${member.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {member.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={roleBadgeVariants[member.role]}>
                      {roleLabels[member.role]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {member.dueToday}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {member.overdue > 0 ? (
                      <span className="font-medium text-red-700">
                        {member.overdue}
                      </span>
                    ) : (
                      <span className="text-slate-500">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {member.thisWeek}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {member.completedThisMonth}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        percent={member.completionRate}
                        className="w-20"
                      />
                      <span
                        className={`w-9 text-right text-xs tabular-nums ${progressTextClass(member.completionRate)}`}
                      >
                        {member.completionRate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
