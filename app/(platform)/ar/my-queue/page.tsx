import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyQueueClient } from "@/components/ar/MyQueueClient";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "My Queue" };
export const dynamic = "force-dynamic";

export default async function MyQueuePage() {
  const user = await requireUser();

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
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="My Queue"
        description="Every red claim assigned to you, oldest and most overdue first."
      />
      <MyQueueClient practices={practices} />
    </div>
  );
}
