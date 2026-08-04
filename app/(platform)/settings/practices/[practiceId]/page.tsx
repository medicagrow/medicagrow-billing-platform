import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  PracticeDetailTabs,
  type PracticeDetail,
} from "@/components/settings/PracticeDetailTabs";
import { Badge } from "@/components/ui/Badge";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { Role } from "@/lib/generated/prisma/enums";
import { formatPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { displayEin, displayZip } from "@/lib/validations/identifiers";

export const metadata: Metadata = { title: "Practice Detail" };
export const dynamic = "force-dynamic";

export default async function PracticeDetailPage({
  params,
}: {
  params: { practiceId: string };
}) {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const practice = await prisma.practice.findUnique({
    where: { id: params.practiceId },
    include: {
      providers: {
        orderBy: [{ isActive: "desc" }, { lastName: "asc" }],
      },
    },
  });

  if (!practice) notFound();

  // A PM reaching a practice they do not manage — by URL, since it is not in
  // their list — is told it does not exist rather than shown its details.
  const accessible = await accessiblePracticeIds(user);

  if (accessible !== null && !accessible.includes(practice.id)) notFound();

  // Stored normalised; formatted for display on the way in.
  const projectManagers = await prisma.user.findMany({
    where: { role: Role.PROJECT_MANAGER, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const detail: PracticeDetail = {
    id: practice.id,
    name: practice.name,
    ehrSource: practice.ehrSource,
    isActive: practice.isActive,
    taxId: displayEin(practice.taxId),
    npi: practice.npi ?? "",
    taxonomy: practice.taxonomy ?? "",
    medicarePtan: practice.medicarePtan ?? "",
    medicaidProviderNumber: practice.medicaidProviderNumber ?? "",
    billingAddressLine1: practice.billingAddressLine1 ?? "",
    billingAddressLine2: practice.billingAddressLine2 ?? "",
    billingCity: practice.billingCity ?? "",
    billingState: practice.billingState ?? "",
    billingZip: displayZip(practice.billingZip),
    contactPersonName: practice.contactPersonName ?? "",
    contactPhone: formatPhone(practice.contactPhone ?? ""),
    contactFax: formatPhone(practice.contactFax ?? ""),
    contactEmail: practice.contactEmail ?? "",
    primaryPmId: practice.primaryPmId ?? "",
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={practice.name}
        description="Practice profile, billing address, contacts and provider roster."
        action={
          <div className="flex items-center gap-3">
            <Badge variant={practice.isActive ? "brand" : "neutral"}>
              {practice.isActive ? "Active" : "Inactive"}
            </Badge>
            <Link
              href="/settings/practices"
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              ← All practices
            </Link>
          </div>
        }
      />

      <PracticeDetailTabs
        practice={detail}
        projectManagers={projectManagers}
        providers={practice.providers.map((provider) => ({
          id: provider.id,
          firstName: provider.firstName,
          lastName: provider.lastName,
          npi: provider.npi,
          licenseNumber: provider.licenseNumber,
          licenseState: provider.licenseState,
          taxonomy: provider.taxonomy,
          isActive: provider.isActive,
        }))}
        // A PM maintains their own practices' details; only an owner decides
        // who escalations route to.
        canEdit={canManageBatches(user)}
        canAssignPm={user.role === Role.OWNER}
      />
    </div>
  );
}
