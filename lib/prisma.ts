// All database access goes through this file. Never import PrismaClient
// directly elsewhere.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Two Supabase connection URLs, and they are not interchangeable.
 *
 *   DATABASE_URL — transaction pooler, port 6543. Used here, by the running
 *     app. The pooler hands a connection back after each statement rather than
 *     holding it for the session, which is what serverless needs: a Vercel
 *     function can be frozen mid-request, and a session-scoped connection
 *     would stay checked out behind it.
 *
 *   DIRECT_URL — session pooler, port 5432. Used only by the Prisma CLI
 *     (see prisma.config.ts) for migrations, introspection and seeding. DDL
 *     cannot run over the transaction pooler, so migrations need a real
 *     session. Application code never touches it.
 *
 * Pointing the app at DIRECT_URL would look fine in development and exhaust
 * the database's connection slots under production load.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Locally, check .env.local; on Vercel, check the project's environment variables.",
  );
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      /**
       * Every serverless instance keeps its own pool and Vercel may run many
       * at once, so the ceiling that matters is per instance × instances. The
       * transaction pooler recycles fast enough that a large local pool buys
       * nothing but a way to exhaust the shared limit.
       */
      max: 5,
      // Don't hold an idle connection open behind a frozen invocation.
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Module scope already survives warm invocations on Vercel, so production gets
// one client per instance either way. The global is for development, where hot
// reload re-evaluates this module and would otherwise leak a pool per edit.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
