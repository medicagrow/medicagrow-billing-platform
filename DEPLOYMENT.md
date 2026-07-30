# Deployment — MedicaGrow Billing Platform

Production target: **Vercel** (Next.js 14 App Router, serverless functions) with
**Supabase Postgres**.

---

## 1. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. Unless a
row says otherwise, add it to **Production**, **Preview** and **Development**.

### Required

| Variable | Where to get it | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Supabase → Project Settings → Database → **Connection string → Transaction pooler** (port **6543**) | What the running app uses. Append `?pgbouncer=true&connection_limit=1` only if Supabase's copy button does not already include it. **Must be the 6543 URL** — see §4. |
| `DIRECT_URL` | Supabase → Project Settings → Database → **Connection string → Session pooler** (port **5432**) | Migrations, introspection and seeding only. Never used by application code. |
| `NEXTAUTH_SECRET` | Generate one: `openssl rand -base64 32` | Signs the session JWT. Use a **different value** from local. Rotating it logs everyone out. |
| `NEXTAUTH_URL` | Your production domain, e.g. `https://billing.medicagrow.com` | Must be the real origin, with `https://` and **no trailing slash**. Never `localhost` in production — see §5. |

Both database URLs contain the database password. Copy them from Supabase
directly; if the password contains `@`, `:`, `/` or `?`, it must be
percent-encoded inside the URL.

### Required only when seeding

Used by `npm run db:seed`, which is run manually from a terminal — not during
the Vercel build. Set them locally when creating the first account rather than
storing them in Vercel.

| Variable | Purpose |
| --- | --- |
| `SEED_OWNER_PASSWORD` | Initial owner password. **Required** — the seed refuses to run without it. Minimum 12 characters, no spaces. Change it in the app after first sign-in. |
| `SEED_OWNER_EMAIL` | Optional. Defaults to `admin@medicagrow.com`. |
| `SEED_OWNER_NAME` | Optional. Defaults to `Owner`. |

The seed **never resets an existing owner's password.** Re-running it against
production only corrects the role and active flag.

### Not needed

`.env.local` currently also carries `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. **No code
reads any of them** — the app talks to Postgres through Prisma, not the
Supabase JS client. Do not copy them to Vercel. `SUPABASE_SERVICE_ROLE_KEY` in
particular bypasses row-level security, so it should not be anywhere it is not
needed.

`NODE_ENV` is set by Vercel. Do not add it yourself.

---

## 2. First deployment

1. **Import the repository** in Vercel. It picks up `vercel.json`:
   ```json
   {
     "framework": "nextjs",
     "buildCommand": "prisma generate && next build",
     "installCommand": "npm install"
   }
   ```
   `prisma generate` must run first: the client is generated into
   `lib/generated/prisma/`, which is gitignored, so a clean checkout has no
   client until it runs.

2. **Add the environment variables** from §1 before the first build. A build
   without `DATABASE_URL` fails at import time with a clear error.

3. **Run migrations from your machine**, not from the build. Point `DIRECT_URL`
   at production and run:
   ```bash
   npx prisma migrate deploy
   ```
   Use `migrate deploy`, never `migrate dev` — `dev` can propose destructive
   changes and will prompt.

4. **Create the owner account**, once:
   ```bash
   SEED_OWNER_PASSWORD='<a strong password>' npm run db:seed
   ```
   This also seeds the nine default task types. It is safe to re-run: task
   types upsert by name, and an existing owner's password is left alone.

5. **Sign in** and change the owner password from Settings.

### Subsequent deployments

Push to `master` — Vercel builds and deploys automatically. When a release
includes a migration, run `npx prisma migrate deploy` **before** the deploy
goes live, so the schema is never behind the code.

---

## 3. Secrets audit

- No connection strings, API keys, JWTs or passwords are hardcoded in
  application code. Every secret is read from `process.env`.
- `.gitignore` excludes `.env*.local`, so `.env.local` is never committed.
  There is no `.env` file in the repository.
- `lib/auth.ts` reads `NEXTAUTH_SECRET` from the environment and contains no
  URLs of any kind.
- `scripts/` contains dev-only test harnesses. `scripts/test-my-queue.ts`
  hardcodes `http://localhost:3000` and a throwaway password for a user it
  creates and deletes itself. Those files are never bundled — they run only via
  `npx tsx` against a local dev server — but do not run them against
  production.

---

## 4. Database connections

The two URLs are not interchangeable, and the reason matters in production:

- **`DATABASE_URL` (transaction pooler, 6543)** — used by `lib/prisma.ts`, i.e.
  everything the app does. The transaction pooler returns a connection after
  each statement instead of holding it for the session. That is what serverless
  needs: a Vercel function can be frozen mid-request, and a session-scoped
  connection would stay checked out behind it.
- **`DIRECT_URL` (session pooler, 5432)** — used only by the Prisma CLI, via
  `prisma.config.ts`. DDL cannot run over the transaction pooler, so migrations
  need a real session.

Pointing the app at `DIRECT_URL` looks fine in development and exhausts the
database's connection slots under production load.

`lib/prisma.ts` caps each instance's pool at **5** connections with a 10-second
idle timeout. Every serverless instance keeps its own pool and Vercel may run
many at once, so the number that matters is per-instance × instances. Raise the
cap only alongside Supabase's pooler limit.

---

## 5. NextAuth in production

- `NEXTAUTH_URL` **must** be the deployed origin (`https://…`, no trailing
  slash). With `localhost` or an unset value, sign-in redirects land on the
  wrong host and the session cookie is rejected.
- Preview deployments get a different URL per commit. Either set
  `NEXTAUTH_URL` per environment, or accept that sign-in works reliably only on
  the production domain — the credentials provider redirects to the configured
  origin, not the request's.
- `NEXTAUTH_SECRET` must be identical across every instance of one deployment.
  It is read in two places — `lib/auth.ts` and `middleware.ts` — and a mismatch
  means tokens issued by one are rejected by the other.
- After pointing a custom domain at the project, update `NEXTAUTH_URL` to that
  domain and redeploy. The variable is read at runtime, but a redeploy is the
  reliable way to pick it up everywhere.

---

## 6. Pre-deployment checklist

```bash
npm run build     # must compile with no errors
npm run lint      # must report no warnings or errors
npx tsc --noEmit  # must be silent
```

Behavioural checks, all of which hit the database and clean up after
themselves:

```bash
npx tsx scripts/test-parsers.ts          # CSV import
npx tsx scripts/test-notes.ts            # AR generated note text
npx tsx scripts/test-tracker-scoring.ts  # practice health scoring
npx tsx scripts/test-tasks.ts            # hold-release automation
npx tsx scripts/test-recurrence.ts       # recurring tasks, task types
```

Confirm before going live:

- [ ] All four required environment variables set in Vercel Production
- [ ] `NEXTAUTH_URL` matches the production domain exactly
- [ ] `npx prisma migrate deploy` run against production
- [ ] Owner account created and its password changed from the seed value
- [ ] Supabase database has a backup schedule enabled
