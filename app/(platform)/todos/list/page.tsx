import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { TodoListClient } from "@/components/todo/TodoListClient";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "All To Dos" };
export const dynamic = "force-dynamic";

export default async function TodoListPage({
  searchParams,
}: {
  searchParams: { assignedToId?: string };
}) {
  const user = await requireUser();

  const practiceIds = await accessiblePracticeIds(user);
  const canReassign = user.role !== Role.BILLER;

  const [practices, assignable] = await Promise.all([
    prisma.practice.findMany({
      where: {
        isActive: true,
        ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    canReassign
      ? prisma.user.findMany({
          where: {
            isActive: true,
            ...(user.role === Role.OWNER
              ? {}
              : {
                  practices: {
                    some: { practice: { users: { some: { userId: user.id } } } },
                  },
                }),
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="All To Dos"
        description="Every to do you can see, with filters and bulk actions."
      />
      <TodoListClient
        practices={practices}
        assignableUsers={assignable}
        canReassign={canReassign}
        currentUserId={user.id}
        initialAssignedToId={searchParams.assignedToId}
      />
    </div>
  );
}
