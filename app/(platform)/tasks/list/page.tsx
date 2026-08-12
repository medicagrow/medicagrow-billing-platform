import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { AssignTaskButton } from "@/components/task/AssignTaskButton";
import { TaskListClient } from "@/components/task/TaskListClient";
import { Role } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/lib/session";
import {
  activeTaskTypes,
  assignableUsersFor,
  taskPracticeOptions,
} from "@/lib/task-options";

export const metadata: Metadata = { title: "All Tasks" };
export const dynamic = "force-dynamic";

export default async function TaskListPage({
  searchParams,
}: {
  searchParams: {
    assignedToId?: string;
    status?: string;
    practiceId?: string;
    overdue?: string;
  };
}) {
  const user = await requireUser();

  const [practices, assignableUsers, taskTypes] = await Promise.all([
    taskPracticeOptions(user),
    assignableUsersFor(user),
    activeTaskTypes(),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="All Tasks"
        description="Every task you can see, with filters, bulk actions and export."
        action={
          <AssignTaskButton
            practices={practices}
            assignableUsers={assignableUsers}
            taskTypes={taskTypes}
            currentUserId={user.id}
            label="Add task"
          />
        }
      />
      <TaskListClient
        practices={practices}
        assignableUsers={assignableUsers}
        taskTypes={taskTypes}
        canBulkEdit={user.role !== Role.BILLER}
        canEditEstimate={user.role !== Role.BILLER}
        canCloseWithoutTimer={user.role !== Role.BILLER}
        canEditTimeDirectly={user.role !== Role.BILLER}
        currentUserId={user.id}
        initial={{
          assignedToId: searchParams.assignedToId,
          status: searchParams.status,
          practiceId: searchParams.practiceId,
          overdue: searchParams.overdue === "true",
        }}
      />
    </div>
  );
}
