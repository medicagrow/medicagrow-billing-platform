import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { PracticesManager } from "@/components/settings/PracticesManager";
import { canManageBatches } from "@/lib/ar-access";
import { Role } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Practices" };
export const dynamic = "force-dynamic";

export default async function SettingsPracticesPage() {
  const user = await requireUser();

  // Owner and PM can view; only Owner can create or edit.
  if (!canManageBatches(user)) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Practices"
        description="Every practice on the platform. AR batches belong to a practice."
      />
      <PracticesManager canEdit={user.role === Role.OWNER} />
    </div>
  );
}
