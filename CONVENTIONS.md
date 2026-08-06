# MedicaGrow Billing Platform — Coding Conventions

These rules apply to all code in this repository. Read this file before writing
any feature code. If a rule needs to be broken, say so explicitly and explain
why — do not break one silently.

---

## 1. API error responses

All API routes return errors through the helpers in [lib/api-helpers.ts](lib/api-helpers.ts).
Never hand-roll a `NextResponse.json({ error: ... })`.

- `apiErrorResponse(message, status)` — every non-validation error.
- `zodErrorResponse(error)` — every Zod validation failure (returns 400 with
  `{ error: "Validation failed", details: <flattened> }`).

```ts
const parsed = createClaimSchema.safeParse(await request.json());
if (!parsed.success) return zodErrorResponse(parsed.error);
```

## 2. Auth and role guards

Guards live in [lib/api-helpers.ts](lib/api-helpers.ts) and return a
`NextResponse` when the request must be rejected, or `null` when it may proceed.

```ts
const session = await getSession();

const denied = requireRole(session, ["OWNER", "PROJECT_MANAGER"]);
if (denied) return denied;
```

Use `requireAuth(session)` when any signed-in role is acceptable.

## 3. Money is always Decimal — never Float

- Prisma columns holding money use `Decimal @db.Decimal(12, 2)`. **Never `Float`.**
- Money crosses application boundaries as a **string**, not a number. Parsing to
  a JS float loses cents at scale.
- Validate with `decimalSchema` / `nonNegativeDecimalSchema` from
  [lib/validations/common.ts](lib/validations/common.ts).
- Collect input with [components/ui/DecimalInput.tsx](components/ui/DecimalInput.tsx).

## 4. Amounts displayed to users are USD with 2 decimal places

Always render through `formatUSD()` from [lib/format.ts](lib/format.ts) —
`$1,234.50`. Never interpolate a raw amount into JSX.

## 5. Passwords and secrets block spaces

- No space character may enter a password or secret, on input or in validation.
- Input: [components/ui/SensitiveInput.tsx](components/ui/SensitiveInput.tsx)
  (blocks typed spaces, strips pasted ones, eye-toggle to reveal).
- Validation: `passwordSchema` from [lib/validations/common.ts](lib/validations/common.ts).
- Any non-secret field that must not contain spaces uses
  [components/ui/NoSpaceInput.tsx](components/ui/NoSpaceInput.tsx) and
  `noSpaceStringSchema`.

## 6. Sensitive fields use SensitiveInput

Passwords, API keys, EHR portal credentials and any secret value use
`SensitiveInput` — never a bare `<input type="password">`.

## 7. Dates validate real calendar dates

Date input must reject impossible dates: Feb 30, April 31, Feb 29 in a non-leap
year. Use `dateSchema` (returns a UTC `Date`) or `dateStringSchema` (keeps the
`YYYY-MM-DD` string) from [lib/validations/common.ts](lib/validations/common.ts).
`new Date("2026-02-30")` silently rolls over to March 2 — never rely on it.

## 8. Phone numbers use PhoneInput

All phone entry uses [components/ui/PhoneInput.tsx](components/ui/PhoneInput.tsx),
validated with `phoneSchema`. Stored normalised as 10 digits; displayed as
`800-456-2583`.

## 8a. Constrained fields use the typed inputs in /components/ui/inputs/

Never collect a constrained value with a bare `<Input />` and validate it later
— the field itself refuses what it cannot accept.

| Field | Use |
| --- | --- |
| Whole numbers (counts, quantities) | `<NumericInput />` — digits only, no decimal point or sign |
| Money | `<DecimalInput />` — two decimals, string end to end; pass `prefix={null}` for a non-money decimal such as 1.5 resources |
| Percentages | `<PercentInput />` — 0–100 with a `%` suffix; stored 0–1 via `percentToDecimal` / `decimalToPercent` |
| CPT codes | `<CptInput />` — exactly 5 alphanumerics, auto-uppercased, validated on blur so partial typing does not flag |
| Letters and numbers only | `<AlphanumericInput />` — props `maxLength`, `uppercase` |
| Person names | `<PersonNameInput />` — keeps letters, spaces, hyphens and apostrophes, so O'Brien and Smith-Jones survive |
| Codes and references | `<NoSpaceInput />` — claim numbers, denial codes, ERA/check references |

A blank field means **"no data", not zero** — `PercentInput` and the tracker
form both preserve that distinction, and scoring relies on it.

## 9. Add-only tables never get PUT or DELETE endpoints

Audit logs, work notes, follow-up history and any other append-only record are
**immutable once written**. For these resources:

- Create `route.ts` with `GET` and `POST` only.
- Never add `PUT`, `PATCH` or `DELETE` — not even "temporarily".
- Never add an `update` or `delete` Prisma call against these models.
- Put this comment at the top of every add-only route file:

```ts
// ADD-ONLY: this resource is append-only. Do not add PUT, PATCH or DELETE.
```

Corrections are made by appending a new record that supersedes the old one, not
by editing history.

## 10. All list endpoints are paginated

No endpoint may return an unbounded result set. Use `parsePagination()` and
`paginatedResponse()` from [lib/api-helpers.ts](lib/api-helpers.ts).

```ts
const pagination = parsePagination(request.nextUrl.searchParams);

const [rows, total] = await Promise.all([
  prisma.claim.findMany({ skip: pagination.skip, take: pagination.take }),
  prisma.claim.count(),
]);

return paginatedResponse(rows, total, pagination);
```

Default page size 25, hard maximum **500**. `parsePagination()` reads either
`pageSize` or `limit` and clamps rather than rejecting — a page size is a
display preference, and failing a whole request over one is a worse answer than
showing a sensible number of rows.

List views render [components/ui/Pagination.tsx](components/ui/Pagination.tsx),
which offers 50 / 100 / 200 / 500 and remembers the choice per browser through
`useLocalSetting()`. Do not hand-roll Previous/Next again.

## 11. All Prisma access goes through lib/prisma.ts

Import the shared instance — `import { prisma } from "@/lib/prisma"`. Never call
`new PrismaClient()` in a route, component or script. A second client instance
opens a second pool against the Supabase pooler and will exhaust connections.

The one exception is [prisma/seed.ts](prisma/seed.ts), which runs standalone
outside the Next.js runtime and constructs its own client deliberately.

## 12. Validation schemas live in /lib/validations/

- Shared field rules: [lib/validations/common.ts](lib/validations/common.ts).
- Feature schemas: `lib/validations/<feature>.ts`, composed from the common ones.
- Reuse, never duplicate. If a rule needs to change, it changes in one place.
- The same schema validates the API route and the form — do not write a second
  client-side copy.

---

## Reference: what already exists

| Concern | Use |
| --- | --- |
| API errors | `apiErrorResponse`, `zodErrorResponse` |
| Auth / roles | `requireAuth`, `requireRole` |
| Pagination | `parsePagination`, `paginatedResponse` |
| Money display | `formatUSD` |
| Date display | `formatDate` |
| Phone entry | `<PhoneInput />` |
| Secret entry | `<SensitiveInput />` |
| No-space text | `<NoSpaceInput />` |
| Money entry | `<DecimalInput />` |
| Whole-number entry | `<NumericInput />` |
| Percentage entry | `<PercentInput />` |
| CPT entry | `<CptInput />` |
| Alphanumeric entry | `<AlphanumericInput />` |
| Person name entry | `<PersonNameInput />` |
| Practice picker | `<PracticeField />` + `usePracticeDefault()` |
| Standard field | `<Input />`, `<Label />`, `<FieldError />` |
