import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { AssignTaskButton } from "@/components/task/AssignTaskButton";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { Role, TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import {
  activeTaskTypes,
  assignableUsersFor,
  taskPracticeOptions,
} from "@/lib/task-options";
import { dayStart } from "@/lib/todo/access";

export const metadata: Metadata = { title: "Team Tasks" };
export const dynamic = "force-dynamic";

export default async function TeamTasksPage({
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

  const [practices, assignableUsers, taskTypes, members] = await Promise.all([
    taskPracticeOptions(user),
    assignableUsersFor(user),
    activeTaskTypes(),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [Role.BILLER, Role.PROJECT_MANAGER, Role.OWNER] },
        ...(practiceIds === null
          ? {}
          : { practices: { some: { practiceId: { in: practiceIds } } } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  const today = dayStart();

  const practiceFilter = selectedPracticeId
    ? { practiceId: selectedPracticeId }
    : {};

  const stats = await Promise.all(
    members.map(async (member) => {
      const base = { assignedToId: member.id, ...practiceFilter };

      const [open, inProcess, hold, overdue, closed] = await Promise.all([
        prisma.task.count({ where: { ...base, status: TaskStatus.OPEN } }),
        prisma.task.count({ where: { ...base, status: TaskStatus.IN_PROCESS } }),
        prisma.task.count({ where: { ...base, status: TaskStatus.HOLD } }),
        prisma.task.count({
          where: {
            ...base,
            dueDate: { lt: today },
            status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROCESS] },
          },
        }),
        prisma.task.count({ where: { ...base, status: TaskStatus.CLOSED } }),
      ]);

      return { ...member, open, inProcess, hold, overdue, closed };
    }),
  );

  /** Links land on the full list, pre-filtered to that person and status. */
  const listHref = (memberId: string, status?: TaskStatus) => {
    const params = new URLSearchParams({ assignedToId: memberId });
    if (status) params.set("status", status);
    if (selectedPracticeId) params.set("practiceId", selectedPracticeId);
    return `/tasks/list?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Team Tasks"
        description="Workload across the team, by status."
        action={
          <AssignTaskButton
            practices={practices}
            assignableUsers={assignableUsers}
            taskTypes={taskTypes}
            currentUserId={user.id}
          />
        }
      />

      <form className="mb-3 flex items-center gap-2">
        <Select
          name="practiceId"
          defaultValue={selectedPracticeId ?? ""}
          className="w-auto min-w-[180px]"
          aria-label="Practice"
        >
          <option value="">All practices</option>
          {practices.map((practice) => (
            <option key={practice.id} value={practice.id}>
              {practice.name}
            </option>
          ))}
        </Select>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Apply
        </button>
      </form>

      {stats.length === 0 ? (
        <EmptyState
          title="No team members to show"
          description="People appear here once they are assigned to a practice."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Open</th>
                <th className="px-4 py-3 text-right">In process</th>
                <th className="px-4 py-3 text-right">On hold</th>
                <th className="px-4 py-3 text-right">Overdue</th>
                <th className="px-4 py-3 text-right">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={listHref(member.id)}
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
                  {(
                    [
                      [member.open, TaskStatus.OPEN, "text-slate-700"],
                      [member.inProcess, TaskStatus.IN_PROCESS, "text-slate-700"],
                      [member.hold, TaskStatus.HOLD, "text-amber-700"],
                    ] as const
                  ).map(([count, status, tone]) => (
                    <td
                      key={status}
                      className="px-4 py-3 text-right tabular-nums"
                    >
                      <Link
                        href={listHref(member.id, status)}
                        className={`hover:underline ${tone}`}
                      >
                        {count}
                      </Link>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums">
                    {member.overdue > 0 ? (
                      <span className="font-medium text-red-700">
                        {member.overdue}
                      </span>
                    ) : (
                      <span className="text-slate-500">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <Link
                      href={listHref(member.id, TaskStatus.CLOSED)}
                      className="text-slate-700 hover:underline"
                    >
                      {member.closed}
                    </Link>
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
