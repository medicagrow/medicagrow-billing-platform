"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePractice } from "@/lib/contexts/PracticeContext";

/**
 * Global practice filter.
 *
 * The selection lives in context (and localStorage) for client components, and
 * is mirrored into the `practiceId` query param so server-rendered pages can
 * filter their queries without a second round trip.
 */
export function PracticeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { practices, selectedPracticeId, selectedPracticeName, setSelectedPractice } =
    usePractice();

  if (practices.length === 0) return null;

  function handleChange(value: string) {
    const practiceId = value === "" ? null : value;
    setSelectedPractice(practiceId);

    const params = new URLSearchParams(searchParams.toString());

    if (practiceId) params.set("practiceId", practiceId);
    else params.delete("practiceId");

    // Paging is scoped to the old filter, so drop it on a filter change.
    params.delete("page");

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    router.refresh();
  }

  return (
    <label className="hidden sm:block" title={selectedPracticeName ?? "All Practices"}>
      <span className="sr-only">Filter by practice</span>
      <select
        value={selectedPracticeId ?? ""}
        onChange={(event) => handleChange(event.target.value)}
        className="w-[220px] truncate rounded-lg border-0 bg-slate-50 px-3 py-1.5 text-sm text-slate-800 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-brand-600"
      >
        <option value="">All Practices</option>
        {practices.map((practice) => (
          <option key={practice.id} value={practice.id}>
            {practice.name}
          </option>
        ))}
      </select>
    </label>
  );
}
