import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { TaskTypesManager } from "@/components/settings/TaskTypesManager";
import { Role } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Task Types" };
export const dynamic = "force-dynamic";

export default async function TaskTypesPage() {
  const user = await requireUser();

  // The list is global, so only the owner may change it.
  if (user.role !== Role.OWNER) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Task Types"
        description="The classification list offered when creating or editing a task."
      />
      <TaskTypesManager />
    </div>
  );
}
