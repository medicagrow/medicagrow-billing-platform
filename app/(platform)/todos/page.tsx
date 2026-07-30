import type { Metadata } from "next";
import { MyDayClient } from "@/components/todo/MyDayClient";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "My Day" };
export const dynamic = "force-dynamic";

export default async function MyDayPage() {
  const user = await requireUser();

  const practiceIds = await accessiblePracticeIds(user);
  const canAssignOthers = user.role !== Role.BILLER;

  const [practices, assignable] = await Promise.all([
    prisma.practice.findMany({
      where: {
        isActive: true,
        ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Managers may assign to anyone sharing one of their practices.
    canAssignOthers
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

  // The current user is always assignable, even without practice overlap.
  const assignableUsers = assignable.some((entry) => entry.id === user.id)
    ? assignable
    : [{ id: user.id, name: user.name ?? "Me" }, ...assignable];

  return (
    <div className="mx-auto max-w-7xl">
      <MyDayClient
        practices={practices}
        assignableUsers={assignableUsers}
        userId={user.id}
      />
    </div>
  );
}
