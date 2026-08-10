import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResourceRequirementsClient } from "@/components/analytics/ResourceRequirementsClient";
import { analyticsFilterOptions } from "@/lib/analytics/options";
import { canManageBatches } from "@/lib/ar-access";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Resource Requirements" };
export const dynamic = "force-dynamic";

export default async function ResourceRequirementsPage() {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const { practices } = await analyticsFilterOptions(user);

  return <ResourceRequirementsClient practices={practices} />;
}
