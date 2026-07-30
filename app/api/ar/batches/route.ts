import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessPractice, practiceScopeFilter } from "@/lib/ar-access";
import {
  ArParseError,
  parseArFileWithReport,
  type FieldMapping,
} from "@/lib/ar-parsers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { createBatchSchema, listBatchesQuerySchema } from "@/lib/validations/ar";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** POST /api/ar/batches — upload a standard CSV and create the batch + claims. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return apiErrorResponse(
      "Expected a multipart form upload containing the AR report file.",
      400,
    );
  }

  const parsedInput = createBatchSchema.safeParse({
    practiceId: formData.get("practiceId"),
    reportMonth: formData.get("reportMonth"),
    reportYear: formData.get("reportYear"),
    targetCompletionDate: formData.get("targetCompletionDate") ?? undefined,
  });

  if (!parsedInput.success) {
    return zodErrorResponse(parsedInput.error);
  }

  const input = parsedInput.data;

  if (!(await canAccessPractice(session!.user, input.practiceId))) {
    return apiErrorResponse("You do not have access to this practice.", 403);
  }

  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return apiErrorResponse("An AR report file is required.", 400);
  }

  if (!file.name.toLowerCase().endsWith(".csv")) {
    return apiErrorResponse(
      "Only .csv files are accepted. Export from your EHR, standardise the file, then upload it here.",
      400,
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return apiErrorResponse(
      `File is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 25MB.`,
      413,
    );
  }

  const practice = await prisma.practice.findUnique({
    where: { id: input.practiceId },
    select: { id: true, name: true, isActive: true, ehrSource: true },
  });

  if (!practice) {
    return apiErrorResponse("Practice not found.", 404);
  }

  if (!practice.isActive) {
    return apiErrorResponse(
      "This practice is inactive. Reactivate it before uploading a batch.",
      409,
    );
  }

  // Business rule (spec §12.2): exactly one OPEN batch per practice.
  const openBatch = await prisma.arBatch.findFirst({
    where: { practiceId: input.practiceId, status: BatchStatus.OPEN },
    select: { id: true },
  });

  if (openBatch) {
    return NextResponse.json(
      {
        error:
          "This practice already has an open batch. Close the current batch before uploading a new one.",
        details: { openBatchId: openBatch.id },
      },
      { status: 409 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // The PM confirms the column mapping in the upload modal; when it is sent we
  // use it verbatim so the import matches exactly what they previewed.
  const rawMapping = formData.get("fieldMapping");
  let fieldMapping: FieldMapping | undefined;

  if (typeof rawMapping === "string" && rawMapping.trim() !== "") {
    try {
      fieldMapping = JSON.parse(rawMapping) as FieldMapping;
    } catch {
      return apiErrorResponse("Field mapping was not valid JSON.", 400);
    }
  }

  let parseResult;

  try {
    parseResult = parseArFileWithReport(buffer, { fieldMapping });
  } catch (cause) {
    if (cause instanceof ArParseError) {
      return apiErrorResponse(cause.message, 422);
    }
    throw cause;
  }

  if (parseResult.claims.length === 0) {
    return NextResponse.json(
      {
        error:
          "No valid claims could be read from this CSV. Every row failed validation.",
        details: { errors: parseResult.errors.slice(0, 100) },
      },
      { status: 422 },
    );
  }

  const batch = await prisma.arBatch.create({
    data: {
      practiceId: input.practiceId,
      // Reference only — inherited from the practice, not used for parsing.
      ehrSource: practice.ehrSource,
      reportMonth: input.reportMonth,
      reportYear: input.reportYear,
      status: BatchStatus.OPEN,
      uploadedById: session!.user.id,
      targetCompletionDate: input.targetCompletionDate
        ? new Date(`${input.targetCompletionDate}T00:00:00.000Z`)
        : null,
    },
  });

  await prisma.arClaim.createMany({
    data: parseResult.claims.map((claim) => ({
      batchId: batch.id,
      patientName: claim.patientName,
      patientId: claim.patientId ?? null,
      insuranceName: claim.insuranceName,
      subscriberId: claim.subscriberId ?? null,
      claimNumber: claim.claimNumber ?? null,
      dateOfService: claim.dateOfService,
      cptCode: claim.cptCode ?? null,
      billedAmount: claim.billedAmount ?? null,
      balance: claim.balance,
      agingDays: claim.agingDays,
      providerName: claim.providerName ?? null,
      statusLabel: claim.statusLabel ?? "Pending",
      statusCategory: claim.statusCategory ?? "RED",
    })),
  });

  // Let Postgres total the Decimal column — summing in JS would go via float.
  const totals = await prisma.arClaim.aggregate({
    where: { batchId: batch.id },
    _sum: { balance: true },
    _count: true,
  });

  const updated = await prisma.arBatch.update({
    where: { id: batch.id },
    data: {
      totalClaims: totals._count,
      totalBalance: totals._sum.balance ?? 0,
    },
    include: { practice: { select: { name: true } } },
  });

  const failedRows = new Set(parseResult.errors.map((error) => error.row)).size;

  return NextResponse.json(
    {
      batch: {
        id: updated.id,
        practiceId: updated.practiceId,
        practiceName: updated.practice.name,
        reportMonth: updated.reportMonth,
        reportYear: updated.reportYear,
        status: updated.status,
        totalClaims: updated.totalClaims,
        totalBalance: updated.totalBalance.toString(),
      },
      totalClaims: updated.totalClaims,
      totalBalance: updated.totalBalance.toString(),
      totalRows: parseResult.totalRows,
      failedRows,
      errors: parseResult.errors,
      warnings: parseResult.warnings,
    },
    { status: 201 },
  );
}

/** GET /api/ar/batches — list batches, scoped to the caller's practices. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const query = listBatchesQuerySchema.safeParse({
    practiceId: request.nextUrl.searchParams.get("practiceId") ?? undefined,
    status: request.nextUrl.searchParams.get("status") ?? undefined,
  });

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const pagination = parsePagination(request.nextUrl.searchParams);
  const scope = await practiceScopeFilter(session!.user);

  const where = {
    ...scope,
    ...(query.data.practiceId ? { practiceId: query.data.practiceId } : {}),
    ...(query.data.status ? { status: query.data.status as BatchStatus } : {}),
  };

  const [batches, total] = await Promise.all([
    prisma.arBatch.findMany({
      where,
      orderBy: [
        { reportYear: "desc" },
        { reportMonth: "desc" },
        { uploadedAt: "desc" },
      ],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        practice: { select: { id: true, name: true, ehrSource: true } },
        uploadedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.arBatch.count({ where }),
  ]);

  const greenCounts = await prisma.arClaim.groupBy({
    by: ["batchId", "statusCategory"],
    where: { batchId: { in: batches.map((batch) => batch.id) } },
    _count: { _all: true },
  });

  const countFor = (batchId: string, category: string) =>
    greenCounts.find(
      (row) => row.batchId === batchId && row.statusCategory === category,
    )?._count._all ?? 0;

  return paginatedResponse(
    batches.map((batch) => ({
      id: batch.id,
      practiceId: batch.practiceId,
      practiceName: batch.practice.name,
      ehrSource: batch.ehrSource,
      reportMonth: batch.reportMonth,
      reportYear: batch.reportYear,
      status: batch.status,
      totalClaims: batch.totalClaims,
      totalBalance: batch.totalBalance.toString(),
      uploadedAt: batch.uploadedAt.toISOString(),
      uploadedByName: batch.uploadedBy.name,
      closedAt: batch.closedAt?.toISOString() ?? null,
      closedByName: batch.closedBy?.name ?? null,
      targetCompletionDate: batch.targetCompletionDate?.toISOString() ?? null,
      greenCount: countFor(batch.id, "GREEN"),
      redCount: countFor(batch.id, "RED"),
      blueCount: countFor(batch.id, "BLUE"),
    })),
    total,
    pagination,
  );
}
