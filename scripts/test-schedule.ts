/**
 * Schedule grid geometry, midnight-crossing blocks, and provider matching.
 *
 *   npx tsx scripts/test-schedule.ts
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches
 * real data.
 */

import { PrismaClient, TimeBlockType } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import {
  DAY_MINUTES,
  HOUR_PX,
  MINUTE_PX,
  segmentsFor,
  toMinutes,
} from "../components/todo/DayScheduleGrid";

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

const block = (startTime: string, endTime: string) => ({
  id: "b1",
  startTime,
  endTime,
  label: "Work",
  blockType: TimeBlockType.TODO_WORK,
});

console.log("=== the grid covers a full day ===");
{
  check("a day is 1440 minutes", DAY_MINUTES === 1440);
  check("one minute is one pixel", MINUTE_PX === 1);
  check("an hour row is 60px", HOUR_PX === 60);
  check("the grid is 1440px tall", DAY_MINUTES * MINUTE_PX === 1440);

  check("midnight is minute 0", toMinutes("00:00") === 0);
  check("23:59 is the last minute", toMinutes("23:59") === 1439);
  check("07:00 scrolls to 420px", 7 * HOUR_PX === 420);
}

console.log("\n=== ordinary blocks ===");
{
  const [segment, ...rest] = segmentsFor(block("09:00", "12:00"));

  check("one segment", rest.length === 0);
  check("starts at 540px", segment!.top === 540, String(segment!.top));
  check("is 180px tall", segment!.height === 180, String(segment!.height));
  check("does not continue", !segment!.continuesAfter && !segment!.continuedFrom);

  // Before the rewrite the grid started at 06:00, so these were off-grid.
  const earlyMorning = segmentsFor(block("00:30", "02:00"))[0]!;
  check("a 00:30 block is on the grid", earlyMorning.top === 30, String(earlyMorning.top));

  const lateNight = segmentsFor(block("22:00", "23:30"))[0]!;
  check("a 22:00 block is on the grid", lateNight.top === 1320, String(lateNight.top));

  const tiny = segmentsFor(block("09:00", "09:05"))[0]!;
  check("a 5-minute block stays legible", tiny.height >= 16, String(tiny.height));
}

console.log("\n=== blocks crossing midnight ===");
{
  // The night shift that prompted this: 23:00 to 00:30.
  const segments = segmentsFor(block("23:00", "00:30"));

  check("splits into two segments", segments.length === 2, String(segments.length));

  const tail = segments[0]!;
  const head = segments[1]!;

  check("the tail starts at 23:00", tail.top === 1380, String(tail.top));
  check(
    "the tail runs to the end of the day",
    tail.top + tail.height === DAY_MINUTES,
    String(tail.top + tail.height),
  );
  check("the tail is marked as continuing", tail.continuesAfter);

  check("the head starts at midnight", head.top === 0, String(head.top));
  check("the head is 30 minutes", head.height === 30, String(head.height));
  check("the head is marked as continued", head.continuedFrom);

  check(
    "the two segments carry the same block",
    tail.block.id === head.block.id && tail.key !== head.key,
  );

  // A zero-length block would otherwise render as an invisible sliver.
  const zero = segmentsFor(block("10:00", "10:00"));
  check("a zero-length block still renders", zero.length === 2);
}

async function main() {
  const { matchProvider, normaliseProviderName } = await import(
    "../lib/ar-provider-match"
  );

  console.log("\n=== provider name normalisation ===");
  check("collapses inner whitespace", normaliseProviderName("Jane   Smith") === "jane smith");
  check("trims and lowercases", normaliseProviderName("  JANE SMITH  ") === "jane smith");

  console.log("\n=== provider roster matching ===");

  const practice = await prisma.practice.findFirst({ select: { id: true } });
  if (!practice) throw new Error("no practice to attach a test provider to");

  const provider = await prisma.practiceProvider.create({
    data: {
      practiceId: practice.id,
      firstName: "ZZTest",
      lastName: "Provider",
      npi: "1234567893",
      licenseNumber: "LIC-999",
      taxonomy: "207Q00000X",
    },
  });

  const exact = await matchProvider(practice.id, "ZZTest Provider");
  check("an exact name matches", exact.matched, JSON.stringify(exact));
  check("it returns the NPI", exact.npi === "1234567893", exact.npi ?? "none");
  check("it returns the licence", exact.licenseNumber === "LIC-999");
  check("it returns the taxonomy", exact.taxonomy === "207Q00000X");

  const messy = await matchProvider(practice.id, "  zztest   PROVIDER ");
  check("case and spacing do not matter", messy.matched);

  const missing = await matchProvider(practice.id, "Someone Not On The Roster");
  check("an unknown name does not match", !missing.matched);
  check("and gives no reason code", missing.reason === undefined);

  const blank = await matchProvider(practice.id, "");
  check("an empty name reports why", blank.reason === "no_provider_on_claim");
  const nullish = await matchProvider(practice.id, null);
  check("a null name reports why", nullish.reason === "no_provider_on_claim");

  // A deactivated provider is off the roster.
  await prisma.practiceProvider.update({
    where: { id: provider.id },
    data: { isActive: false },
  });
  const inactive = await matchProvider(practice.id, "ZZTest Provider");
  check("a deactivated provider does not match", !inactive.matched);

  await prisma.practiceProvider.delete({ where: { id: provider.id } });

  const leftover = await prisma.practiceProvider.count({
    where: { firstName: { startsWith: "ZZTest" } },
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
