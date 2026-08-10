import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkloadClient } from "@/components/analytics/WorkloadClient";
import { analyticsFilterOptions } from "@/lib/analytics/options";
import { canManageBatches } from "@/lib/ar-access";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Workload Planner" };
export const dynamic = "force-dynamic";

export default async function WorkloadPage() {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const options = await analyticsFilterOptions(user);

  return <WorkloadClient options={options} />;
}
