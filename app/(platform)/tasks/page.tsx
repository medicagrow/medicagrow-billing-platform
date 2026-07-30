import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyTasksClient } from "@/components/task/MyTasksClient";
import {
  activeTaskTypes,
  assignableUsersFor,
  taskPracticeOptions,
} from "@/lib/task-options";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "My Tasks" };
export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const user = await requireUser();

  const [practices, assignableUsers, taskTypes] = await Promise.all([
    taskPracticeOptions(user),
    assignableUsersFor(user),
    activeTaskTypes(),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="My Tasks"
        description="Everything assigned to you, newest holds released automatically."
      />
      <MyTasksClient
        practices={practices}
        assignableUsers={assignableUsers}
        taskTypes={taskTypes}
        currentUserId={user.id}
      />
    </div>
  );
}
