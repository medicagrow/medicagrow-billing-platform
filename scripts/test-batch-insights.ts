/**
 * Smart alerts, per-item status approval and the batch pivot.
 *
 *   npx tsx scripts/test-batch-insights.ts
 *
 * - HIGH_BALANCE_IDLE finds an idle high balance, and never a 0–30 day claim
 *   however large — the rule every figure on the batch page follows.
 * - SYSTEMATIC_DENIAL fires at five claims with one payer and reason, not four,
 *   and reads the reason case-insensitively.
 * - Reviewing a request applies the approved claims only: rejected claims keep
 *   their status, undecided ones stay pending, and the request says so.
 * - The pivot groups by a primary and a sub dimension with counts and balances
 *   that add up, and leaves out the 0–30 bucket.
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches real
 * data. Pipe through `tail`, not `head` — a closed pipe kills the script
 * before its cleanup.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import {
  BatchStatus,
  EhrSource,
  OutcomeType,
  Role,
  StatusCategory,
} from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

const STAMP = Date.now();
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const { detectSmartAlerts, loadAlertContext, alertClaimWhere } = await import(
    "../lib/ar/smart-alerts"
  );
  const { createStatusRequest, reviewStatusRequest } = await import(
    "../lib/ar/status-requests"
  );
  const { runBatchAnalysis } = await import("../lib/ar/batch-analysis");
  const { ACTIONABLE_WHERE } = await import("../lib/ar-actionable");
  const { statusLabelToCategory } = await import("../lib/ar-status");

  // ---------------------------------------------------------------- fixtures

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("no owner user to hang the fixtures on");

  const [billerA, billerB] = await Promise.all(
    ["A", "B"].map((suffix) =>
      prisma.user.create({
        data: {
          name: `ZZ Insights Biller ${suffix}`,
          email: `zz-insights-${suffix.toLowerCase()}-${STAMP}@example.test`,
          hashedPassword: "not-a-real-hash",
          role: Role.BILLER,
        },
      }),
    ),
  );

  const practice = await prisma.practice.create({
    data: { name: `ZZ Insights Practice ${STAMP}`, ehrSource: EhrSource.OPEN_PM },
  });

  // The billers need practice access for the request flow's access check.
  await prisma.userPractice.createMany({
    data: [billerA!, billerB!].map((user) => ({
      userId: user.id,
      practiceId: practice.id,
    })),
  });

  const newBatch = () =>
    prisma.arBatch.create({
      data: {
        practiceId: practice.id,
        ehrSource: EhrSource.OPEN_PM,
        reportMonth: 3,
        reportYear: 2026,
        status: BatchStatus.OPEN,
        uploadedById: owner.id,
        totalClaims: 0,
        totalBalance: "0.00",
      },
    });

  type ClaimInput = {
    name: string;
    balance?: string;
    agingDays?: number;
    statusLabel?: string;
    insuranceName?: string;
    providerName?: string;
    assignedToId?: string | null;
  };

  const makeClaim = (batchId: string, input: ClaimInput) => {
    const statusLabel = input.statusLabel ?? "Need to Call";

    return prisma.arClaim.create({
      data: {
        batchId,
        patientName: `ZZ ${input.name}`,
        insuranceName: input.insuranceName ?? "ZZ Insurance",
        providerName: input.providerName ?? null,
        dateOfService: new Date("2026-01-05T00:00:00.000Z"),
        balance: input.balance ?? "100.00",
        agingDays: input.agingDays ?? 60,
        statusLabel,
        statusCategory: statusLabelToCategory(statusLabel),
        assignedToId: input.assignedToId ?? null,
      },
    });
  };

  const note = (
    claimId: string,
    workedAt: Date,
    extra: { outcomeType?: OutcomeType; denialReason?: string } = {},
  ) =>
    prisma.arWorkNote.create({
      data: {
        claimId,
        outcomeType: extra.outcomeType ?? OutcomeType.OTHER,
        structuredFields: extra.denialReason
          ? { denialReason: extra.denialReason }
          : {},
        generatedNote: "ZZ test note",
        statusChangedTo: extra.outcomeType === OutcomeType.DENIED ? "Denied" : "Need to Call",
        statusCategoryChangedTo: StatusCategory.RED,
        workedById: billerA!.id,
        workedAt,
      },
    });

  const alertsFor = async (batchId: string) => {
    const context = await loadAlertContext(batchId);
    if (!context) throw new Error("batch vanished");
    return { context, alerts: await detectSmartAlerts(context) };
  };

  try {
    // ======================================================= HIGH_BALANCE_IDLE
    console.log("=== HIGH_BALANCE_IDLE ===");
    {
      const batch = await newBatch();

      const [idle, , fresh] = await Promise.all([
        makeClaim(batch.id, { name: "idle high", balance: "900.00", agingDays: 75 }),
        makeClaim(batch.id, { name: "worked high", balance: "800.00", agingDays: 75 }).then(
          (claim) => note(claim.id, new Date(Date.now() - 2 * DAY)).then(() => claim),
        ),
        // Large and untouched, but aged 20 days: not actionable, never counted.
        makeClaim(batch.id, { name: "fresh high", balance: "5000.00", agingDays: 20 }),
        makeClaim(batch.id, { name: "idle small", balance: "499.00", agingDays: 75 }),
        // Exactly 30 is still inside the bucket.
        makeClaim(batch.id, { name: "thirty high", balance: "700.00", agingDays: 30 }),
      ]);

      // A note three weeks old does not make a claim active.
      await note(idle.id, new Date(Date.now() - 21 * DAY));

      const { context, alerts } = await alertsFor(batch.id);
      const alert = alerts.find((entry) => entry.type === "HIGH_BALANCE_IDLE");

      check("alert raised for the idle high balance", Boolean(alert));
      check(
        "counts only the idle actionable claim",
        alert?.affectedCount === 1,
        `count ${alert?.affectedCount}`,
      );
      check(
        "balance excludes the $5,000 claim aged 20 days",
        alert?.affectedBalance === "900.00" || alert?.affectedBalance === "900",
        `balance ${alert?.affectedBalance}`,
      );
      check("HIGH severity", alert?.severity === "HIGH");

      // "View affected claims" reads the same condition, so it lists the same set.
      const listed = await prisma.arClaim.findMany({
        where: await alertClaimWhere("HIGH_BALANCE_IDLE", null, context),
        select: { id: true },
      });
      check(
        "claim list behind the alert is exactly that claim",
        listed.length === 1 && listed[0]!.id === idle.id,
      );
      check(
        "the 0–30 day claim is not in the list",
        !listed.some((row) => row.id === fresh.id),
      );

      // Every other alert obeys the rule too: nothing counts the fresh claim.
      const all = await Promise.all(
        alerts
          .filter((entry) => entry.claimFilter.alert)
          .map(async (entry) =>
            prisma.arClaim.count({
              where: {
                AND: [
                  await alertClaimWhere(
                    entry.type,
                    entry.claimFilter.alertKey ?? null,
                    context,
                  ),
                  { agingDays: { lte: 30 } },
                ],
              },
            }),
          ),
      );
      check(
        "no alert in the batch includes a 0–30 day claim",
        all.every((count) => count === 0),
        all.join(","),
      );
    }

    // ======================================================= SYSTEMATIC_DENIAL
    console.log("\n=== SYSTEMATIC_DENIAL threshold ===");
    {
      const batch = await newBatch();
      const denied = (name: string, insuranceName: string, reason: string, agingDays = 60) =>
        makeClaim(batch.id, { name, insuranceName, agingDays }).then((claim) =>
          note(claim.id, new Date(), {
            outcomeType: OutcomeType.DENIED,
            denialReason: reason,
          }).then(() => claim),
        );

      // Four claims: one short of a pattern.
      await Promise.all(
        [1, 2, 3, 4].map((index) =>
          denied(`aetna ${index}`, "ZZ Aetna", "Precertification required"),
        ),
      );

      let { alerts } = await alertsFor(batch.id);
      check(
        "4 claims with one payer and reason raise nothing",
        !alerts.some((entry) => entry.type === "SYSTEMATIC_DENIAL"),
      );

      // A fifth in a 0–30 day claim does not complete the pattern.
      await denied("aetna fresh", "ZZ Aetna", "Precertification required", 15);
      ({ alerts } = await alertsFor(batch.id));
      check(
        "a 0–30 day fifth claim does not reach the threshold",
        !alerts.some((entry) => entry.type === "SYSTEMATIC_DENIAL"),
      );

      // Same reason, different payer: a different group.
      await denied("cigna 1", "ZZ Cigna", "Precertification required");
      ({ alerts } = await alertsFor(batch.id));
      check(
        "a different payer does not complete the pattern",
        !alerts.some((entry) => entry.type === "SYSTEMATIC_DENIAL"),
      );

      // A fifth actionable Aetna claim, written in different case and spacing.
      await denied("aetna 5", "ZZ Aetna", "  PRECERTIFICATION REQUIRED ");
      ({ alerts } = await alertsFor(batch.id));
      const pattern = alerts.filter((entry) => entry.type === "SYSTEMATIC_DENIAL");

      check("5 claims raise exactly one alert", pattern.length === 1, String(pattern.length));
      check(
        "counts the 5 actionable claims",
        pattern[0]?.affectedCount === 5,
        `count ${pattern[0]?.affectedCount}`,
      );
      check("MEDIUM severity", pattern[0]?.severity === "MEDIUM");
      check(
        "title names the payer",
        Boolean(pattern[0]?.title.includes("ZZ Aetna")),
        pattern[0]?.title,
      );
    }

    // ======================================================= selective approval
    console.log("\n=== per-item approval ===");
    {
      const batch = await newBatch();
      const claims = await Promise.all(
        [1, 2, 3, 4].map((index) =>
          makeClaim(batch.id, { name: `request ${index}`, assignedToId: billerA!.id }),
        ),
      );
      const [first, second, third, fourth] = claims as [
        (typeof claims)[0],
        (typeof claims)[0],
        (typeof claims)[0],
        (typeof claims)[0],
      ];

      const created = await createStatusRequest(
        { id: billerA!.id, role: Role.BILLER },
        {
          claimIds: [first.id, second.id, third.id],
          statusLabel: "Paid & Posted",
          note: "Payer portal shows these paid on the same check.",
        },
      );
      check("request covers 3 claims", created.requested === 3);

      let refused = false;
      try {
        await createStatusRequest(
          { id: billerB!.id, role: Role.BILLER },
          { claimIds: [fourth.id], statusLabel: "Paid & Posted", note: "Not my claim at all." },
        );
      } catch {
        refused = true;
      }
      check("a biller cannot request a change to someone else's claim", refused);

      const untouched = await prisma.arClaim.findUnique({ where: { id: first.id } });
      check(
        "a request changes no status by itself",
        untouched?.statusLabel === "Need to Call" &&
          untouched.pendingStatusRequestId === created.requestId,
      );

      const result = await reviewStatusRequest(
        { id: owner.id, role: owner.role, name: owner.name },
        created.requestId,
        [
          { claimId: first.id, decision: "APPROVED" },
          { claimId: second.id, decision: "REJECTED", rejectionNote: "Only a partial payment." },
        ],
      );

      check("1 approved, 1 rejected, 1 remaining", result.approved === 1 && result.rejected === 1 && result.remaining === 1,
        JSON.stringify(result));
      check("request is partially approved", result.status === "PARTIALLY_APPROVED");

      const after = await prisma.arClaim.findMany({
        where: { id: { in: [first.id, second.id, third.id] } },
        select: { id: true, statusLabel: true, statusCategory: true, pendingStatusRequestId: true },
      });
      const byId = new Map(after.map((claim) => [claim.id, claim]));

      check(
        "approved claim took the requested status",
        byId.get(first.id)?.statusLabel === "Paid & Posted" &&
          byId.get(first.id)?.statusCategory === StatusCategory.GREEN,
      );
      check(
        "rejected claim kept its status",
        byId.get(second.id)?.statusLabel === "Need to Call",
      );
      check(
        "undecided claim kept its status and is still pending",
        byId.get(third.id)?.statusLabel === "Need to Call" &&
          byId.get(third.id)?.pendingStatusRequestId === created.requestId,
      );
      check(
        "decided claims are released from the request",
        byId.get(first.id)?.pendingStatusRequestId === null &&
          byId.get(second.id)?.pendingStatusRequestId === null,
      );

      const notes = await prisma.arWorkNote.findMany({
        where: { claimId: { in: [first.id, second.id, third.id] } },
        select: { claimId: true, workedById: true },
      });
      check(
        "only the approved claim gained a work note, credited to the requester",
        notes.length === 1 &&
          notes[0]!.claimId === first.id &&
          notes[0]!.workedById === billerA!.id,
      );

      // Re-deciding an item already decided is ignored, not re-applied.
      const again = await reviewStatusRequest(
        { id: owner.id, role: owner.role, name: owner.name },
        created.requestId,
        [
          { claimId: second.id, decision: "APPROVED" },
          { claimId: third.id, decision: "APPROVED" },
        ],
      );
      const secondAfter = await prisma.arClaim.findUnique({ where: { id: second.id } });
      check(
        "a rejected item cannot be approved later",
        again.ignored === 1 && secondAfter?.statusLabel === "Need to Call",
        JSON.stringify(again),
      );
      check(
        "one approved and one rejected is still partially approved",
        again.status === "PARTIALLY_APPROVED",
      );

      // Mixed but fully decided: it must leave the review queue.
      const open = await prisma.arStatusRequest.count({
        where: {
          id: created.requestId,
          items: { some: { itemStatus: "PENDING" } },
        },
      });
      check("a fully decided request leaves the pending queue", open === 0);

      // All approved reads APPROVED.
      const fifth = await makeClaim(batch.id, {
        name: "request 5",
        assignedToId: billerA!.id,
      });
      const solo = await createStatusRequest(
        { id: billerA!.id, role: Role.BILLER },
        {
          claimIds: [fifth.id],
          statusLabel: "Denied",
          note: "Denied for missing authorization on file.",
        },
      );
      const soloItems = await prisma.arStatusRequestItem.findMany({
        where: { requestId: solo.requestId },
        select: { claimId: true },
      });
      const approvedAll = await reviewStatusRequest(
        { id: owner.id, role: owner.role, name: owner.name },
        solo.requestId,
        soloItems.map((item) => ({ claimId: item.claimId, decision: "APPROVED" as const })),
      );
      check("every item approved reads APPROVED", approvedAll.status === "APPROVED");
    }

    // ======================================================= pivot
    console.log("\n=== pivot: primary + sub grouping ===");
    {
      const batch = await newBatch();

      await Promise.all([
        makeClaim(batch.id, { name: "p1", insuranceName: "ZZ Aetna", statusLabel: "Need to Call", balance: "100.00", agingDays: 40 }),
        makeClaim(batch.id, { name: "p2", insuranceName: "ZZ Aetna", statusLabel: "Need to Call", balance: "200.00", agingDays: 80 }),
        makeClaim(batch.id, { name: "p3", insuranceName: "ZZ Aetna", statusLabel: "Paid & Posted", balance: "50.25", agingDays: 100 }),
        makeClaim(batch.id, { name: "p4", insuranceName: "ZZ Cigna", statusLabel: "Denied", balance: "1000.00", agingDays: 120 }),
        makeClaim(batch.id, { name: "p5", insuranceName: "ZZ Cigna", statusLabel: "Need to Call", balance: "10.00", agingDays: 31 }),
        // Excluded: inside the 0–30 bucket.
        makeClaim(batch.id, { name: "p6", insuranceName: "ZZ Aetna", statusLabel: "Need to Call", balance: "9999.00", agingDays: 10 }),
        makeClaim(batch.id, { name: "p7", insuranceName: "ZZ Humana", statusLabel: "Need to Call", balance: "5.00", agingDays: 30 }),
      ]);

      const result = await runBatchAnalysis({
        where: { AND: [{ batchId: batch.id }, ACTIONABLE_WHERE] },
        primary: "insurance",
        sub: "statusLabel",
      });

      const aetna = result.rows.find((row) => row.key === "ZZ Aetna");
      const cigna = result.rows.find((row) => row.key === "ZZ Cigna");

      check("two payers, the 0–30-only payer absent", result.rows.length === 2,
        result.rows.map((row) => row.label).join(","));
      check("ordered by balance, largest first", result.rows[0]?.key === "ZZ Cigna");
      check("Aetna: 3 claims, $350.25", aetna?.claims === 3 && aetna.balance === "350.25",
        `${aetna?.claims} ${aetna?.balance}`);
      check("Aetna avg aging is weighted by claim", aetna?.avgAgingDays === 73, String(aetna?.avgAgingDays));

      const aetnaCall = aetna?.children?.find((row) => row.key === "Need to Call");
      const aetnaPaid = aetna?.children?.find((row) => row.key === "Paid & Posted");
      check("Aetna → Need to Call: 2 claims, $300.00",
        aetnaCall?.claims === 2 && aetnaCall.balance === "300.00");
      check("Aetna → Paid & Posted: 1 claim, $50.25",
        aetnaPaid?.claims === 1 && aetnaPaid.balance === "50.25");
      check("Cigna has two sub-rows", cigna?.children?.length === 2);
      check(
        "sub-rows sum to their parent",
        result.rows.every(
          (row) =>
            (row.children ?? []).reduce((sum, child) => sum + child.claims, 0) === row.claims,
        ),
      );
      check("total: 5 claims, $1,360.25",
        result.total.claims === 5 && result.total.balance === "1360.25",
        `${result.total.claims} ${result.total.balance}`);

      const flat = await runBatchAnalysis({
        where: { AND: [{ batchId: batch.id }, ACTIONABLE_WHERE] },
        primary: "statusCategory",
        sub: null,
      });
      check(
        "no sub dimension means no children",
        flat.rows.every((row) => row.children === undefined),
      );
      check(
        "same total under a different grouping",
        flat.total.claims === 5 && flat.total.balance === "1360.25",
      );
    }
  } finally {
    await prisma.arStatusRequest.deleteMany({ where: { batch: { practiceId: practice.id } } });
    await prisma.practice.delete({ where: { id: practice.id } });
    await prisma.user.deleteMany({ where: { id: { in: [billerA!.id, billerB!.id] } } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
