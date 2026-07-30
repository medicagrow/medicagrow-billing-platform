/**
 * Regression test for the biller work queue scoping rules.
 *
 * Requires the dev server on http://localhost:3000:
 *   npm run dev
 *   npx tsx scripts/test-my-queue.ts
 *
 * Everything it creates is prefixed "ZZ Queue" and removed at the end, so it is
 * safe to run against a database holding real data.
 */

import path from "node:path";
import { config as loadEnv } from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import {
  BatchStatus,
  EhrSource,
  Role,
  StatusCategory,
} from "../lib/generated/prisma/enums";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const BASE = "http://localhost:3000";
const PREFIX = "ZZ Queue";
const BILLER_EMAIL = "zzqueue.biller@medicagrow.com";
const PASSWORD = "Queue@12345";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

class Session {
  private cookies = new Map<string, string>();

  private header() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  async fetch(url: string, init: RequestInit = {}) {
    const response = await fetch(`${BASE}${url}`, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: this.header() },
      redirect: "manual",
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const index = pair!.indexOf("=");
      this.cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
    }

    return response;
  }

  async login(email: string, password: string) {
    const { csrfToken } = await (await this.fetch("/api/auth/csrf")).json();
    await this.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
    });
    return (await (await this.fetch("/api/auth/session")).json())?.user ?? null;
  }
}

async function cleanup() {
  const scope = { practice: { name: { startsWith: PREFIX } } };
  await prisma.arWorkNote.deleteMany({ where: { claim: { batch: scope } } });
  await prisma.arClaim.deleteMany({ where: { batch: scope } });
  await prisma.arBatch.deleteMany({ where: scope });
  await prisma.userPractice.deleteMany({ where: scope });
  await prisma.practice.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: BILLER_EMAIL } });
}

async function makeClaim(
  batchId: string,
  patientName: string,
  options: { assignedToId?: string; statusCategory?: StatusCategory; statusLabel?: string } = {},
) {
  return prisma.arClaim.create({
    data: {
      batchId,
      patientName,
      insuranceName: "Aetna",
      providerName: "Dr. Test",
      dateOfService: new Date("2026-03-14T00:00:00.000Z"),
      balance: "100.00",
      agingDays: 30,
      assignedToId: options.assignedToId ?? null,
      statusCategory: options.statusCategory ?? StatusCategory.RED,
      statusLabel: options.statusLabel ?? "Pending",
    },
    select: { id: true, patientName: true },
  });
}

async function main() {
  await cleanup();

  console.log("=== setup ===");

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    select: { id: true },
  });

  if (!owner) throw new Error("No active owner to attribute uploads to.");

  const biller = await prisma.user.create({
    data: {
      name: "ZZ Queue Biller",
      email: BILLER_EMAIL,
      hashedPassword: await bcrypt.hash(PASSWORD, 12),
      role: Role.BILLER,
      isActive: true,
    },
    select: { id: true },
  });

  const [practiceA, practiceB] = await Promise.all([
    prisma.practice.create({
      data: { name: `${PREFIX} Practice A`, ehrSource: EhrSource.OPEN_PM },
      select: { id: true },
    }),
    prisma.practice.create({
      data: { name: `${PREFIX} Practice B`, ehrSource: EhrSource.OPEN_PM },
      select: { id: true },
    }),
  ]);

  // The biller is assigned to practice A only.
  await prisma.userPractice.create({
    data: { userId: biller.id, practiceId: practiceA.id, assignedById: owner.id },
  });

  const batchFor = (practiceId: string, status: BatchStatus = BatchStatus.OPEN) =>
    prisma.arBatch.create({
      data: {
        practiceId,
        ehrSource: EhrSource.OPEN_PM,
        reportMonth: 7,
        reportYear: 2026,
        status,
        uploadedById: owner.id,
      },
      select: { id: true },
    });

  const [batchA, batchB, closedBatchA] = await Promise.all([
    batchFor(practiceA.id),
    batchFor(practiceB.id),
    batchFor(practiceA.id, BatchStatus.CLOSED),
  ]);

  // The one claim that should appear.
  const expected = await makeClaim(batchA.id, "Alvarez Maria", {
    assignedToId: biller.id,
  });

  // Every one of these must be excluded, each for a different reason.
  await makeClaim(batchA.id, "Unassigned Patient");
  await makeClaim(batchA.id, "Other Biller Patient", { assignedToId: owner.id });
  await makeClaim(batchA.id, "Green Patient", {
    assignedToId: biller.id,
    statusCategory: StatusCategory.GREEN,
    statusLabel: "Paid & Posted",
  });
  await makeClaim(batchA.id, "Blue Patient", {
    assignedToId: biller.id,
    statusCategory: StatusCategory.BLUE,
    statusLabel: "Check with Office",
  });
  await makeClaim(closedBatchA.id, "Closed Batch Patient", {
    assignedToId: biller.id,
  });
  const wrongPractice = await makeClaim(batchB.id, "Wrong Practice Patient", {
    assignedToId: biller.id,
  });

  console.log(
    `practice A ${practiceA.id}, practice B ${practiceB.id}, biller ${biller.id}`,
  );

  console.log("\n=== biller queue ===");

  const session = new Session();
  const user = await session.login(BILLER_EMAIL, PASSWORD);
  check("biller logs in", user?.role === "BILLER", user?.role ?? "no session");

  const response = await session.fetch("/api/ar/claims/my-queue?pageSize=100");
  const payload = await response.json();

  check("queue returns 200", response.ok, `${response.status}`);

  const names: string[] = (payload.data ?? []).map(
    (claim: { patientName: string }) => claim.patientName,
  );

  check("exactly 1 claim returned", payload.data?.length === 1, `got ${payload.data?.length}: ${names.join(", ")}`);
  check("it is the practice A claim", names[0] === expected.patientName, names.join(", "));
  check("wrong-practice claim absent", !names.includes(wrongPractice.patientName), names.join(", "));
  check("unassigned claim absent", !names.includes("Unassigned Patient"), names.join(", "));
  check("another biller's claim absent", !names.includes("Other Biller Patient"), names.join(", "));
  check("green claim absent", !names.includes("Green Patient"), names.join(", "));
  check("blue claim absent", !names.includes("Blue Patient"), names.join(", "));
  check("closed-batch claim absent", !names.includes("Closed Batch Patient"), names.join(", "));

  // Counts drive the summary bar and pagination, so they must agree with the rows.
  check("summary count matches rows", payload.summary?.totalClaims === 1, `${payload.summary?.totalClaims}`);
  check("pagination total matches rows", payload.pagination?.total === 1, `${payload.pagination?.total}`);
  check("summary balance is the one claim", payload.summary?.totalBalance === "100", payload.summary?.totalBalance);

  console.log("\n=== practice scoping survives reassignment ===");

  // Remove the biller from practice A; the claim stays assigned to them but
  // must drop out of the queue.
  await prisma.userPractice.deleteMany({
    where: { userId: biller.id, practiceId: practiceA.id },
  });

  const afterRemoval = await (
    await session.fetch("/api/ar/claims/my-queue?pageSize=100")
  ).json();

  check(
    "queue empties when the practice assignment is removed",
    afterRemoval.data?.length === 0,
    `got ${afterRemoval.data?.length}`,
  );

  await prisma.userPractice.create({
    data: { userId: biller.id, practiceId: practiceA.id, assignedById: owner.id },
  });

  console.log("\n=== batch claim list is scoped for billers ===");

  const batchList = await (
    await session.fetch(`/api/ar/claims?batchId=${batchA.id}&pageSize=100`)
  ).json();

  const batchNames: string[] = (batchList.data ?? []).map(
    (claim: { patientName: string }) => claim.patientName,
  );

  check(
    "biller sees only their own claims in a batch",
    batchNames.every((name) =>
      ["Alvarez Maria", "Green Patient", "Blue Patient"].includes(name),
    ),
    batchNames.join(", "),
  );
  check(
    "batch list hides another biller's claim",
    !batchNames.includes("Other Biller Patient"),
    batchNames.join(", "),
  );
  check(
    "batch list hides unassigned claims",
    !batchNames.includes("Unassigned Patient"),
    batchNames.join(", "),
  );

  const foreignBatch = await session.fetch(
    `/api/ar/claims?batchId=${batchB.id}&pageSize=100`,
  );
  check(
    "batch in an unassigned practice is 404",
    foreignBatch.status === 404,
    `${foreignBatch.status}`,
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
  console.log("=".repeat(60));
}

main()
  .catch((error) => {
    console.error("TEST FAILED:", error);
    fail += 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail === 0 ? 0 : 1);
  });
