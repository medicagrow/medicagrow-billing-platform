/**
 * The AR claim list's filters, and the export that reuses them.
 *
 *   npx tsx scripts/test-claim-filters.ts
 *
 * The two status multi-selects are the interesting part. Both have a singular
 * cousin the batch tabs still use, and a filter written as a top-level key
 * would have the object spread silently drop one of the pair — the bug this
 * file exists to catch. Everything here goes through `claimListWhere`, which
 * is the same function the export calls, so a divergence between the table and
 * the file would fail here too.
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches real
 * data.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import {
  BatchStatus,
  EhrSource,
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

async function main() {
  const { parseClaimFilters, claimListWhere } = await import(
    "../lib/ar-claim-filters"
  );
  const { startOfTodayUtc } = await import("../lib/ar-stats");
  const { ALL_STATUSES, statusLabelToCategory } = await import(
    "../lib/ar-status"
  );

  console.log("=== the master list is complete and consistent ===");

  /**
   * Twenty, not twenty-one. The dropdown is built from `ALL_STATUSES` rather
   * than a hand-written list precisely so a miscount cannot reach the UI —
   * pinned here so adding a status is a deliberate change to this number.
   */
  check(
    "20 status labels in all",
    ALL_STATUSES.length === 20,
    String(ALL_STATUSES.length),
  );

  const byCategory = (category: StatusCategory) =>
    ALL_STATUSES.filter((label) => statusLabelToCategory(label) === category);

  check("7 red statuses", byCategory(StatusCategory.RED).length === 7);
  check("3 blue statuses", byCategory(StatusCategory.BLUE).length === 3);
  check("10 green statuses", byCategory(StatusCategory.GREEN).length === 10);
  check(
    "every label lands in exactly one category",
    byCategory(StatusCategory.RED).length +
      byCategory(StatusCategory.BLUE).length +
      byCategory(StatusCategory.GREEN).length ===
      ALL_STATUSES.length,
  );

  // ---------------------------------------------------------------- fixtures

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("no owner user to hang the fixtures on");

  const biller = await prisma.user.create({
    data: {
      name: "ZZ Filters Biller",
      email: `zz-filters-${STAMP}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
    },
  });

  const practice = await prisma.practice.create({
    data: { name: `ZZ Filters Practice ${STAMP}`, ehrSource: EhrSource.OPEN_PM },
  });

  const batch = await prisma.arBatch.create({
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

  const makeClaim = (
    name: string,
    statusLabel: string,
    assignedToId: string | null = null,
  ) =>
    prisma.arClaim.create({
      data: {
        batchId: batch.id,
        patientName: `ZZ ${name}`,
        insuranceName: "ZZ Insurance",
        dateOfService: new Date("2026-01-05T00:00:00.000Z"),
        balance: "100.00",
        agingDays: 60,
        statusLabel,
        statusCategory: statusLabelToCategory(statusLabel),
        assignedToId,
      },
    });

  await Promise.all([
    makeClaim("red call", "Need to Call", biller.id),
    makeClaim("red pending", "Pending"),
    makeClaim("blue office", "Check with Office"),
    makeClaim("green paid", "Paid & Posted", biller.id),
    makeClaim("green resub", "Resubmitted"),
  ]);

  /** Runs a query string through the shared parser and counts the matches. */
  const count = async (queryString: string, role: Role = Role.OWNER) => {
    const params = new URLSearchParams(queryString);
    params.set("batchId", batch.id);

    const parsed = parseClaimFilters(params);
    if (!parsed.success) throw new Error(`rejected: ${queryString}`);

    const where = await claimListWhere(
      parsed.data,
      { id: biller.id, role },
      startOfTodayUtc(),
    );

    return prisma.arClaim.count({ where });
  };

  console.log("\n=== status category multi-select ===");

  check("no filter returns every claim", (await count("")) === 5);
  check(
    "one category narrows to it",
    (await count("statusCategories=RED")) === 2,
    String(await count("statusCategories=RED")),
  );
  check(
    "two categories are an OR of the two",
    (await count("statusCategories=RED,GREEN")) === 4,
    String(await count("statusCategories=RED,GREEN")),
  );
  check(
    "all three is the same as no filter",
    (await count("statusCategories=RED,BLUE,GREEN")) === 5,
  );
  check(
    "an unrecognised category is dropped rather than rejected",
    (await count("statusCategories=RED,PURPLE")) === 2,
    "a renamed category must not 400 every bookmarked filter",
  );

  console.log("\n=== status label multi-select ===");

  check(
    "one label narrows to it",
    (await count("statusLabels=Need to Call")) === 1,
  );
  check(
    "two labels are an OR of the two",
    (await count("statusLabels=Need to Call,Resubmitted")) === 2,
  );
  check(
    "an unknown label is dropped",
    (await count("statusLabels=Need to Call,Not A Status")) === 1,
  );

  console.log("\n=== the two narrow each other, rather than replacing ===");

  check(
    "category RED and label 'Need to Call' is the intersection",
    (await count("statusCategories=RED&statusLabels=Need to Call")) === 1,
  );
  check(
    "a label outside the chosen category matches nothing",
    (await count("statusCategories=RED&statusLabels=Paid %26 Posted")) === 0,
    "the UI greys these out; the API still has to agree",
  );

  console.log("\n=== and neither replaces the tab's singular filter ===");

  check(
    "tab=blue plus category RED is a contradiction, not an override",
    (await count("statusCategory=BLUE&statusCategories=RED")) === 0,
    "if one had overwritten the other this would be 1 or 2",
  );
  check(
    "tab=blue alone still works",
    (await count("statusCategory=BLUE")) === 1,
  );

  console.log("\n=== filters still compose with the rest ===");

  check(
    "category plus assigned-to",
    (await count(`statusCategories=RED&assignedToIds=${biller.id}`)) === 1,
  );
  check(
    "a biller only ever sees their own, whatever they ask for",
    (await count("statusCategories=RED,BLUE,GREEN", Role.BILLER)) === 2,
    "2 of the 5 are theirs",
  );

  console.log("\n=== the export reads the same rows ===");

  const params = new URLSearchParams({
    batchId: batch.id,
    statusCategories: "RED",
  });

  const parsed = parseClaimFilters(params);
  if (!parsed.success) throw new Error("export filters rejected");

  const where = await claimListWhere(
    parsed.data,
    { id: owner.id, role: Role.OWNER },
    startOfTodayUtc(),
  );

  const exported = await prisma.arClaim.findMany({
    where,
    select: {
      patientName: true,
      workNotes: {
        orderBy: { workedAt: "desc" },
        take: 1,
        select: { generatedNote: true },
      },
    },
  });

  check(
    "the export's where is the list's where",
    exported.length === (await count("statusCategories=RED")),
    `${exported.length} rows`,
  );
  check(
    "and it carries the note join the CSV needs",
    exported.every((row) => Array.isArray(row.workNotes)),
    "no note yet on these fixtures, but the shape is there",
  );

  // Cleanup. Claims cascade from the batch, the batch from the practice.
  await prisma.practice.delete({ where: { id: practice.id } });
  await prisma.user.delete({ where: { id: biller.id } });

  const leftover = await prisma.arClaim.count({
    where: { patientName: { startsWith: "ZZ " }, batchId: batch.id },
  });
  check("test rows cleaned up", leftover === 0, String(leftover));
}

main()
  .catch((error) => {
    console.error(error);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n${"=".repeat(60)}`);
    console.log(
      fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`,
    );
    console.log("=".repeat(60));
    process.exit(fail === 0 ? 0 : 1);
  });
