import path from "node:path";
import { config as loadEnv } from "dotenv";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { Role } from "../lib/generated/prisma/enums";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL / DATABASE_URL is not set. Check .env.local.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * The owner account.
 *
 * The password is never hardcoded: against a real database the seed refuses to
 * invent one, because a default that ships in the repository is a published
 * credential. Set SEED_OWNER_PASSWORD to create the first account, then change
 * it in the app.
 *
 * Re-seeding does **not** reset an existing owner's password — running the
 * seed against production must never hand the account back to whoever knows
 * the seed value.
 */
async function seedOwner() {
  const email = (
    process.env.SEED_OWNER_EMAIL ?? "admin@medicagrow.com"
  ).toLowerCase();
  const name = process.env.SEED_OWNER_NAME ?? "Owner";

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true },
  });

  if (existing) {
    // Keep the role and active flag correct, but leave the password alone.
    await prisma.user.update({
      where: { email },
      data: { role: Role.OWNER, isActive: true },
    });

    console.log(
      `Owner already exists: ${existing.name} <${existing.email}> — password left unchanged`,
    );
    return;
  }

  const password = process.env.SEED_OWNER_PASSWORD;

  if (!password) {
    throw new Error(
      "SEED_OWNER_PASSWORD is not set. Set it to the initial owner password before seeding.",
    );
  }

  if (password.length < 12 || /\s/.test(password)) {
    throw new Error(
      "SEED_OWNER_PASSWORD must be at least 12 characters and contain no spaces.",
    );
  }

  const owner = await prisma.user.create({
    data: {
      name,
      email,
      hashedPassword: await bcrypt.hash(password, 12),
      role: Role.OWNER,
      isActive: true,
    },
  });

  console.log(`Seeded owner: ${owner.name} <${owner.email}> (${owner.role})`);
}

async function main() {
  await seedOwner();

  // Task types ship with the product; owners edit them at
  // /settings/task-types. Upsert by name so re-seeding never duplicates a
  // type or resets an owner's sortOrder edits back to the defaults.
  const defaultTaskTypes = [
    "Charge Posting",
    "Payment Posting",
    "Denial/Rejection Work",
    "Claim Follow-up",
    "Authorization",
    "Eligibility Check",
    "Report",
    "Patient Inquiry",
    "Clinic Inquiry",
  ];

  for (const [index, name] of defaultTaskTypes.entries()) {
    await prisma.taskType.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: (index + 1) * 10 },
    });
  }

  console.log(`Seeded ${defaultTaskTypes.length} task types`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
