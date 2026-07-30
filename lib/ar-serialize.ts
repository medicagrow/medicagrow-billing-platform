import type { StatusCategory } from "@/lib/generated/prisma/enums";

/**
 * Claims cross the API boundary with money as strings (Prisma Decimal ->
 * string, never a float) and dates as ISO strings.
 */
export interface ClaimDto {
  id: string;
  batchId: string;
  patientName: string;
  patientId: string | null;
  insuranceName: string;
  subscriberId: string | null;
  claimNumber: string | null;
  dateOfService: string;
  cptCode: string | null;
  billedAmount: string | null;
  insurancePaid: string | null;
  patientPaid: string | null;
  balance: string;
  agingDays: number;
  providerName: string | null;
  billingProvider: string | null;
  renderingProvider: string | null;
  location: string | null;
  statusCategory: StatusCategory;
  statusLabel: string;
  assignedToId: string | null;
  assignedToName: string | null;
  followUpDate: string | null;
  ehrClaimStatus: string | null;
  ehrTags: string | null;
  lastWorkedAt: string | null;
  lastWorkedByName: string | null;
}

type ClaimRow = {
  id: string;
  batchId: string;
  patientName: string;
  patientId: string | null;
  insuranceName: string;
  subscriberId: string | null;
  claimNumber: string | null;
  dateOfService: Date;
  cptCode: string | null;
  billedAmount: unknown;
  insurancePaid: unknown;
  patientPaid: unknown;
  balance: unknown;
  agingDays: number;
  providerName: string | null;
  billingProvider: string | null;
  renderingProvider: string | null;
  location: string | null;
  statusCategory: StatusCategory;
  statusLabel: string;
  assignedToId: string | null;
  followUpDate: Date | null;
  ehrClaimStatus: string | null;
  ehrTags: string | null;
  lastWorkedAt: Date | null;
  assignedTo?: { name: string } | null;
  lastWorkedBy?: { name: string } | null;
};

const decimal = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

export function toClaimDto(claim: ClaimRow): ClaimDto {
  return {
    id: claim.id,
    batchId: claim.batchId,
    patientName: claim.patientName,
    patientId: claim.patientId,
    insuranceName: claim.insuranceName,
    subscriberId: claim.subscriberId,
    claimNumber: claim.claimNumber,
    dateOfService: claim.dateOfService.toISOString(),
    cptCode: claim.cptCode,
    billedAmount: decimal(claim.billedAmount),
    insurancePaid: decimal(claim.insurancePaid),
    patientPaid: decimal(claim.patientPaid),
    balance: decimal(claim.balance) ?? "0.00",
    agingDays: claim.agingDays,
    providerName: claim.providerName,
    billingProvider: claim.billingProvider,
    renderingProvider: claim.renderingProvider,
    location: claim.location,
    statusCategory: claim.statusCategory,
    statusLabel: claim.statusLabel,
    assignedToId: claim.assignedToId,
    assignedToName: claim.assignedTo?.name ?? null,
    followUpDate: claim.followUpDate?.toISOString() ?? null,
    ehrClaimStatus: claim.ehrClaimStatus,
    ehrTags: claim.ehrTags,
    lastWorkedAt: claim.lastWorkedAt?.toISOString() ?? null,
    lastWorkedByName: claim.lastWorkedBy?.name ?? null,
  };
}

export const CLAIM_INCLUDE = {
  assignedTo: { select: { name: true } },
  lastWorkedBy: { select: { name: true } },
} as const;
