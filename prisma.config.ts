import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Next.js reads .env.local automatically; the Prisma CLI does not, so load it here.
loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  // Migrate/introspect go over the session pooler (port 5432). The app runtime
  // uses DATABASE_URL (transaction pooler, port 6543) via the driver adapter.
  datasource: {
    url: env("DIRECT_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
