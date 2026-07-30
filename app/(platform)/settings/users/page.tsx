import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { UsersManager } from "@/components/settings/UsersManager";
import { Role } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function SettingsUsersPage() {
  const user = await requireUser();

  if (user.role !== Role.OWNER) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Users"
        description="Team members, their roles, and which practices they can access."
      />
      <UsersManager currentUserId={user.id} />
    </div>
  );
}
