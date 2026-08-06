import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { AssignTaskButton } from "@/components/task/AssignTaskButton";
import { TeamTasksClient } from "@/components/task/TeamTasksClient";
import { TimeEditRequestsPanel } from "@/components/task/TimeEditRequestsPanel";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { Role, TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { teamTaskScope } from "@/lib/task-access";
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
  searchParams: { practiceId?: string; practiceIds?: string };
}) {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const practiceIds = await accessiblePracticeIds(user);

  // practiceIds is the multi-select; practiceId is kept so older links and
  // bookmarks still land somewhere sensible.
  const requested = [
    ...(searchParams.practiceIds?.split(",") ?? []),
    ...(searchParams.practiceId ? [searchParams.practiceId] : []),
  ]
    .map((id) => id.trim())
    .filter((id) => id !== "");

  const selectedPracticeIds = Array.from(
    new Set(
      requested.filter(
        (id) => practiceIds === null || practiceIds.includes(id),
      ),
    ),
  );

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

  // A PM sees a shared biller's work for *their* practices only, never the
  // whole of that person's workload.
  const practiceFilter = teamTaskScope({
    accessiblePracticeIds: practiceIds,
    selectedPracticeIds,
  });

  /**
   * Two queries for the whole team, not five per person.
   *
   * The status counts are one `groupBy` over (assignee, status); overdue
   * needs its own because it is a date condition rather than a status.
   */
  const memberIds = members.map((member) => member.id);

  const base = { assignedToId: { in: memberIds }, ...practiceFilter };

  const [byStatus, overdueByMember] =
    memberIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.task.groupBy({
            by: ["assignedToId", "status"],
            where: base,
            _count: { _all: true },
          }),
          prisma.task.groupBy({
            by: ["assignedToId"],
            where: {
              ...base,
              dueDate: { lt: today },
              // Matches GET /api/tasks?overdue=true, so the count and the link
              // it points at cannot disagree.
              status: {
                in: [TaskStatus.OPEN, TaskStatus.IN_PROCESS, TaskStatus.HOLD],
              },
            },
            _count: { _all: true },
          }),
        ]);

  const countOf = (memberId: string, status: TaskStatus) =>
    byStatus.find(
      (row) => row.assignedToId === memberId && row.status === status,
    )?._count._all ?? 0;

  const stats = members.map((member) => ({
    ...member,
    open: countOf(member.id, TaskStatus.OPEN),
    inProcess: countOf(member.id, TaskStatus.IN_PROCESS),
    hold: countOf(member.id, TaskStatus.HOLD),
    overdue:
      overdueByMember.find((row) => row.assignedToId === member.id)?._count
        ._all ?? 0,
    closed: countOf(member.id, TaskStatus.CLOSED),
  }));

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

      <TeamTasksClient
        members={stats}
        practices={practices}
        selectedPracticeIds={selectedPracticeIds}
      />

      <div className="mt-6">
        <TimeEditRequestsPanel />
      </div>
    </div>
  );
}
