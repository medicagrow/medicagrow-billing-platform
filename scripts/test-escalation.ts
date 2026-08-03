/**
 * Escalation routing: practice primary PM → batch owner → platform owner.
 *
 *   npx tsx scripts/test-escalation.ts
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches
 * real data.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { EhrSource, Role } from "../lib/generated/prisma/enums";
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

async function main() {
  // lib/escalation imports lib/prisma, which reads DATABASE_URL as it loads.
  const { resolveEscalationTarget } = await import("../lib/escalation");

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("no owner user — the chain has no last resort");

  const pm = await prisma.user.create({
    data: {
      name: "ZZ Escalation PM",
      email: `zz-escalation-pm-${Date.now()}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.PROJECT_MANAGER,
    },
  });

  const uploader = await prisma.user.create({
    data: {
      name: "ZZ Escalation Uploader",
      email: `zz-escalation-uploader-${Date.now()}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
    },
  });

  const withPm = await prisma.practice.create({
    data: {
      name: "ZZ Escalation Practice With PM",
      ehrSource: EhrSource.OPEN_PM,
      primaryPmId: pm.id,
    },
  });

  const withoutPm = await prisma.practice.create({
    data: { name: "ZZ Escalation Practice No PM", ehrSource: EhrSource.OPEN_PM },
  });

  console.log("=== the chain, in order ===");

  const first = await resolveEscalationTarget({
    practiceId: withPm.id,
    batchOwnerId: uploader.id,
  });
  check("the practice's primary PM wins", first.userId === pm.id, first.reason);

  const second = await resolveEscalationTarget({
    practiceId: withoutPm.id,
    batchOwnerId: uploader.id,
  });
  check(
    "with no primary PM it falls to whoever owns the batch",
    second.userId === uploader.id && second.reason === "batch_owner",
    second.reason,
  );

  const third = await resolveEscalationTarget({
    practiceId: withoutPm.id,
    batchOwnerId: null,
  });
  check(
    "with no batch owner either it falls to the platform owner",
    third.userId === owner.id && third.reason === "platform_owner",
    third.reason,
  );

  const noPractice = await resolveEscalationTarget({
    practiceId: null,
    batchOwnerId: uploader.id,
  });
  check(
    "no practice at all still reaches the batch owner",
    noPractice.userId === uploader.id,
    noPractice.reason,
  );

  console.log("\n=== a deactivated PM is skipped ===");

  await prisma.user.update({ where: { id: pm.id }, data: { isActive: false } });

  const deactivated = await resolveEscalationTarget({
    practiceId: withPm.id,
    batchOwnerId: uploader.id,
  });
  check(
    "an inactive primary PM is not a destination",
    deactivated.userId === uploader.id && deactivated.reason === "batch_owner",
    deactivated.reason,
  );

  // Cleanup.
  await prisma.practice.deleteMany({
    where: { id: { in: [withPm.id, withoutPm.id] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [pm.id, uploader.id] } } });

  const leftover = await prisma.practice.count({
    where: { name: { startsWith: "ZZ Escalation" } },
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
    console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
    console.log("=".repeat(60));
    process.exit(fail === 0 ? 0 : 1);
  });
