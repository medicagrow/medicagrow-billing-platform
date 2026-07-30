import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();

  // Feeds the global practice selector — scoped to what this user may see.
  const practiceIds = await accessiblePracticeIds(user);

  const practices = await prisma.practice.findMany({
    where: {
      isActive: true,
      ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <AppShell
      name={user.name ?? "User"}
      role={user.role}
      practices={practices}
    >
      {children}
    </AppShell>
  );
}
