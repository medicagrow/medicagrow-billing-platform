"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { displayEin } from "@/lib/validations/identifiers";

export interface ClaimPracticeDetails {
  id: string;
  name: string;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  npi: string | null;
  taxId: string | null;
  medicarePtan: string | null;
}

export interface ClaimProviderMatch {
  matched: boolean;
  npi?: string;
  licenseNumber?: string | null;
  taxonomy?: string | null;
  reason?: "no_provider_on_claim";
}

/** "Line1, Line2, City, ST 12345" — empty parts drop out entirely. */
function formatBillingAddress(practice: ClaimPracticeDetails): string | null {
  const cityStateZip = [
    practice.billingCity,
    [practice.billingState, formatZip(practice.billingZip)]
      .filter(Boolean)
      .join(" "),
  ]
    .map((part) => part?.trim())
    .filter((part) => part);

  const parts = [
    practice.billingAddressLine1,
    practice.billingAddressLine2,
    ...cityStateZip,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : null;
}

/** 123456789 -> 12345-6789; a 5-digit ZIP is left alone. */
function formatZip(zip: string | null): string | null {
  if (!zip) return null;
  const digits = zip.replace(/\D/g, "");
  return digits.length === 9 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : zip;
}

/**
 * A section that remembers whether it was open, per claim.
 *
 * A biller who works claims for one practice all day expands this once and
 * wants it to stay expanded; someone who never needs it should not have to
 * collapse it every visit.
 */
function CollapsibleSection({
  title,
  storageKey,
  children,
}: {
  title: string;
  storageKey: string;
  children: ReactNode;
}) {
  // Starts collapsed on the server and on first paint, then reads the stored
  // preference — localStorage does not exist during SSR, and guessing would
  // mean the panel visibly jumps.
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(storageKey) === "open");
    } catch {
      // Private browsing and blocked storage both land here; the default
      // collapsed state is fine.
    }
    setHydrated(true);
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);

    try {
      window.localStorage.setItem(storageKey, next ? "open" : "closed");
    } catch {
      // Not being able to remember is not worth failing the click over.
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span
          aria-hidden
          className={`text-slate-400 transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          ›
        </span>
      </button>

      {hydrated && open ? (
        <div className="border-t border-slate-100 px-4 py-3">{children}</div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="text-sm text-slate-800">{children}</span>
    </div>
  );
}

export function ClaimContextPanels({
  claimId,
  practice,
  renderingProvider,
  providerMatch,
}: {
  claimId: string;
  practice: ClaimPracticeDetails;
  renderingProvider: string | null;
  providerMatch: ClaimProviderMatch;
}) {
  const address = formatBillingAddress(practice);
  const providerName = (renderingProvider ?? "").trim();

  return (
    <>
      <CollapsibleSection
        title="Practice Details"
        storageKey={`claim:${claimId}:practice`}
      >
        <p className="text-base font-semibold text-slate-900">
          {practice.name}
        </p>

        {address ? (
          <p className="mt-1 text-sm text-slate-600">{address}</p>
        ) : (
          <p className="mt-1 text-sm text-slate-400">
            Billing address not configured
          </p>
        )}

        <dl className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          <Row label="Group NPI">
            {practice.npi ?? <span className="text-slate-400">Not on file</span>}
          </Row>
          <Row label="Tax ID">
            {practice.taxId ? (
              displayEin(practice.taxId)
            ) : (
              <span className="text-slate-400">Not on file</span>
            )}
          </Row>
          <Row label="Medicare PTAN">
            {practice.medicarePtan ?? (
              <span className="text-slate-400">Not on file</span>
            )}
          </Row>
        </dl>
      </CollapsibleSection>

      <CollapsibleSection
        title="Provider Details"
        storageKey={`claim:${claimId}:provider`}
      >
        <dl className="divide-y divide-slate-100">
          <Row label="Rendering provider">
            {providerName === "" ? (
              <span className="text-slate-400">Not specified on claim</span>
            ) : (
              providerName
            )}
          </Row>

          <Row label="Provider NPI">
            {providerMatch.matched ? (
              <span className="inline-flex items-center gap-2">
                <span className="tabular-nums">{providerMatch.npi}</span>
                <Badge variant="brand">✓ From roster</Badge>
              </span>
            ) : providerName === "" ? (
              <span className="text-slate-400">
                No rendering provider on claim
              </span>
            ) : (
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-amber-700">Not in provider roster</span>
                <Link
                  href={`/settings/practices/${practice.id}?tab=providers`}
                  className="text-xs font-medium text-brand-700 hover:text-brand-800"
                >
                  Add to roster →
                </Link>
              </span>
            )}
          </Row>

          {/* Only meaningful when the roster supplied them. */}
          {providerMatch.matched && providerMatch.licenseNumber ? (
            <Row label="License#">{providerMatch.licenseNumber}</Row>
          ) : null}

          {providerMatch.matched && providerMatch.taxonomy ? (
            <Row label="Taxonomy">{providerMatch.taxonomy}</Row>
          ) : null}
        </dl>
      </CollapsibleSection>
    </>
  );
}
