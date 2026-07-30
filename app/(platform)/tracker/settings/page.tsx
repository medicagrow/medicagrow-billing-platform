import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrackerSettingsClient } from "@/components/tracker/TrackerSettingsClient";
import { Role } from "@/lib/generated/prisma/enums";
import { requireUser } from "@/lib/session";
import { getTrackerConfig } from "@/lib/tracker/config";

export const metadata: Metadata = { title: "Tracker Settings" };
export const dynamic = "force-dynamic";

export default async function TrackerSettingsPage() {
  const user = await requireUser();

  // Retuning the model changes every practice's score, so it is owner-only.
  if (user.role !== Role.OWNER) notFound();

  const config = await getTrackerConfig();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Tracker Settings"
        description="Weights and score bands for the practice health model."
      />
      <TrackerSettingsClient initialConfig={config} />
    </div>
  );
}
