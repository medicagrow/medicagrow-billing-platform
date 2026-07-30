import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  TrackerEntryForm,
  type TrackerFormValues,
} from "@/components/tracker/TrackerEntryForm";
import { canAccessPractice, canManageBatches } from "@/lib/ar-access";
import { formatDate } from "@/lib/format";
import { LockStatus, Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { getTrackerConfig } from "@/lib/tracker/config";
import { monthYearToDate } from "@/lib/validations/tracker";

export const metadata: Metadata = { title: "Tracker Entry" };
export const dynamic = "force-dynamic";

/** Decimal to a plain string; percentages are shown 0–100. */
const text = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

const percentText = (value: unknown) =>
  value === null || value === undefined
    ? ""
    : String(Math.round(Number(value) * 1000) / 10);

export default async function TrackerEntryPage({
  params,
}: {
  params: { practiceId: string; monthYear: string };
}) {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();
  if (!/^\d{4}-\d{2}$/.test(params.monthYear)) notFound();
  if (!(await canAccessPractice(user, params.practiceId))) notFound();

  const practice = await prisma.practice.findUnique({
    where: { id: params.practiceId },
    select: { id: true, name: true },
  });

  if (!practice) notFound();

  const entry = await prisma.trackerEntry.findUnique({
    where: {
      practiceId_monthYear: {
        practiceId: params.practiceId,
        monthYear: monthYearToDate(params.monthYear),
      },
    },
    include: { lockedBy: { select: { name: true } } },
  });

  const initialValues: TrackerFormValues = {
    totalAppointments: text(entry?.totalAppointments),
    totalVisits: text(entry?.totalVisits),
    totalClaims: text(entry?.totalClaims),
    totalCharges: text(entry?.totalCharges),
    totalPayments: text(entry?.totalPayments),
    totalAdjustments: text(entry?.totalAdjustments),
    pendingClaimsToBill: text(entry?.pendingClaimsToBill),
    pendingEraToPost: text(entry?.pendingEraToPost),
    pendingPatientPaymentsToPost: text(entry?.pendingPatientPaymentsToPost),
    rejectionsReceived: text(entry?.rejectionsReceived),
    outstandingRejections: text(entry?.outstandingRejections),
    eobDenialsReceived: text(entry?.eobDenialsReceived),
    outstandingEobDenials: text(entry?.outstandingEobDenials),
    arCount0to30: text(entry?.arCount0to30),
    arAmount0to30: text(entry?.arAmount0to30),
    arCount31to60: text(entry?.arCount31to60),
    arAmount31to60: text(entry?.arAmount31to60),
    arCount61to90: text(entry?.arCount61to90),
    arAmount61to90: text(entry?.arAmount61to90),
    arCount90plus: text(entry?.arCount90plus),
    arAmount90plus: text(entry?.arAmount90plus),
    followUpCompliance: percentText(entry?.followUpCompliance),
    totalAppointmentsForElig: text(entry?.totalAppointmentsForElig),
    eligibilityCompleted: text(entry?.eligibilityCompleted),
    eftEnrollment: percentText(entry?.eftEnrollment),
    eraEnrollment: percentText(entry?.eraEnrollment),
    portalAccess: percentText(entry?.portalAccess),
    feeSchedule: percentText(entry?.feeSchedule),
    sopCompliance: percentText(entry?.sopCompliance),
    resourcesAssigned: text(entry?.resourcesAssigned),
    monthlyReviewMeeting:
      entry?.monthlyReviewMeeting === null ||
      entry?.monthlyReviewMeeting === undefined
        ? ""
        : String(entry.monthlyReviewMeeting),
    directClientCommunication: entry?.directClientCommunication ?? "",
    netCollectionRateManual: percentText(entry?.netCollectionRateManual),
    paymentEfficiencyManual: percentText(entry?.paymentEfficiencyManual),
  };

  // The preview must score with the same weights and bands the API saves with.
  const config = await getTrackerConfig();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={practice.name}
        description={`Health scoring for ${params.monthYear}`}
        action={
          <Link
            href={`/tracker?monthYear=${params.monthYear}`}
            className="text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            ← All practices
          </Link>
        }
      />

      <TrackerEntryForm
        practiceId={practice.id}
        practiceName={practice.name}
        monthYear={params.monthYear}
        initialValues={initialValues}
        entryId={entry?.id ?? null}
        locked={entry?.lockStatus === LockStatus.LOCKED}
        lockedAt={entry?.lockedAt ? formatDate(entry.lockedAt) : null}
        lockedByName={entry?.lockedBy?.name ?? null}
        canLock={user.role === Role.OWNER}
        canEdit={canManageBatches(user)}
        canOverride={user.role === Role.OWNER}
        config={config}
      />
    </div>
  );
}
