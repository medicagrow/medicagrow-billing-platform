import { prisma } from "@/lib/prisma";

/**
 * Matching a claim's rendering provider against the practice's roster.
 *
 * The claim carries a name string from the EHR export; the roster carries
 * first and last names separately. Comparison is case-insensitive on trimmed,
 * whitespace-collapsed text, so an export writing "Dr.  Jane   Smith" still
 * finds "Jane Smith".
 *
 * Done in JS rather than SQL so the normalisation is one rule both sides go
 * through — a roster is a handful of rows per practice, so the scan is free.
 * Both the claim detail page and its API call this, so the two cannot disagree
 * about whether a provider is on file.
 */

export interface ProviderMatch {
  matched: boolean;
  npi?: string;
  licenseNumber?: string | null;
  taxonomy?: string | null;
  /** Set when the claim named nobody to match against. */
  reason?: "no_provider_on_claim";
}

/** Lowercased, trimmed, internal whitespace collapsed to one space. */
export function normaliseProviderName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function matchProvider(
  practiceId: string,
  renderingProvider: string | null | undefined,
): Promise<ProviderMatch> {
  const target = (renderingProvider ?? "").trim();

  if (target === "") return { matched: false, reason: "no_provider_on_claim" };

  const roster = await prisma.practiceProvider.findMany({
    where: { practiceId, isActive: true },
    select: {
      firstName: true,
      lastName: true,
      npi: true,
      licenseNumber: true,
      taxonomy: true,
    },
  });

  const wanted = normaliseProviderName(target);

  const provider = roster.find(
    (candidate) =>
      normaliseProviderName(`${candidate.firstName} ${candidate.lastName}`) ===
      wanted,
  );

  if (!provider) return { matched: false };

  return {
    matched: true,
    npi: provider.npi,
    licenseNumber: provider.licenseNumber,
    taxonomy: provider.taxonomy,
  };
}
