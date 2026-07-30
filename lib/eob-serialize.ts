import type {
  EobEntryType,
  StatusCategory,
} from "@/lib/generated/prisma/enums";

export interface EobEntryDto {
  id: string;
  eobBatchId: string;
  entryType: EobEntryType;
  patientName: string;
  claimNumber: string | null;
  dateOfService: string;
  cptCode: string | null;
  billedAmount: string | null;
  deniedAmount: string | null;
  denialCode: string | null;
  denialReason: string;
  rejectionReason: string | null;
  actionRequired: string | null;
  statusCategory: StatusCategory;
  statusLabel: string;
  assignedToId: string | null;
  assignedToName: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  arClaimId: string | null;
  practiceId?: string;
  practiceName?: string;
  payerName?: string;
  batchReference?: string | null;
  batchDate?: string;
}

type EntryRow = {
  id: string;
  eobBatchId: string;
  entryType: EobEntryType;
  patientName: string;
  claimNumber: string | null;
  dateOfService: Date;
  cptCode: string | null;
  billedAmount: unknown;
  deniedAmount: unknown;
  denialCode: string | null;
  denialReason: string;
  rejectionReason: string | null;
  actionRequired: string | null;
  statusCategory: StatusCategory;
  statusLabel: string;
  assignedToId: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  arClaimId: string | null;
  assignedTo?: { name: string } | null;
  resolvedBy?: { name: string } | null;
  batch?: {
    payerName: string;
    batchReference?: string | null;
    batchDate?: Date;
    practiceId?: string;
    practice?: { name: string } | null;
  } | null;
};

const decimal = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

export function toEobEntryDto(entry: EntryRow): EobEntryDto {
  return {
    id: entry.id,
    eobBatchId: entry.eobBatchId,
    entryType: entry.entryType,
    patientName: entry.patientName,
    claimNumber: entry.claimNumber,
    dateOfService: entry.dateOfService.toISOString(),
    cptCode: entry.cptCode,
    billedAmount: decimal(entry.billedAmount),
    deniedAmount: decimal(entry.deniedAmount),
    denialCode: entry.denialCode,
    denialReason: entry.denialReason,
    rejectionReason: entry.rejectionReason,
    actionRequired: entry.actionRequired,
    statusCategory: entry.statusCategory,
    statusLabel: entry.statusLabel,
    assignedToId: entry.assignedToId,
    assignedToName: entry.assignedTo?.name ?? null,
    resolvedAt: entry.resolvedAt?.toISOString() ?? null,
    resolvedByName: entry.resolvedBy?.name ?? null,
    resolutionNote: entry.resolutionNote,
    arClaimId: entry.arClaimId,
    practiceId: entry.batch?.practiceId,
    practiceName: entry.batch?.practice?.name,
    payerName: entry.batch?.payerName,
    batchReference: entry.batch?.batchReference ?? null,
    batchDate: entry.batch?.batchDate?.toISOString(),
  };
}

export const EOB_ENTRY_INCLUDE = {
  assignedTo: { select: { name: true } },
  resolvedBy: { select: { name: true } },
} as const;

/** Batch columns the flat list renders alongside each entry. */
export const EOB_BATCH_SELECT = {
  select: {
    id: true,
    payerName: true,
    batchReference: true,
    batchDate: true,
    practiceId: true,
    practice: { select: { name: true } },
  },
} as const;
