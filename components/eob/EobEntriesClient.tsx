"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { isPageSize, Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import type { EobEntryDto } from "@/lib/eob-serialize";
import { useLocalSetting } from "@/lib/hooks/useLocalSetting";
import { formatDate, formatUSD } from "@/lib/format";
import { EobEntryType, StatusCategory } from "@/lib/generated/prisma/enums";
import { usePracticeDefault } from "@/lib/hooks/usePracticeDefault";

type SortKey =
  | "batchDate"
  | "deniedAmount"
  | "patientName"
  | "payerName"
  | "status";


const TYPE_VARIANT: Record<EobEntryType, "red" | "amber"> = {
  DENIAL: "red",
  REJECTION: "amber",
};

const CATEGORY_LABELS: Record<StatusCategory, string> = {
  RED: "Needs work",
  BLUE: "With office",
  GREEN: "Resolved",
};

export function EobEntriesClient({
  practices,
  assignableUsers,
  initialEntryType = "",
  initialStatusCategory = "",
}: {
  practices: { id: string; name: string }[];
  assignableUsers: { id: string; name: string }[];
  /** Seeded from the URL so a summary card lands on what it counted. */
  initialEntryType?: string;
  initialStatusCategory?: string;
}) {
  const router = useRouter();

  // The top bar owns practice selection; the local dropdown only appears
  // under "All Practices".
  const { practiceId: contextPracticeId, isLocked } = usePracticeDefault();

  const [entries, setEntries] = useState<EobEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalSetting(
    "eob.entries.pageSize",
    50,
    isPageSize,
  );
  const [loading, setLoading] = useState(true);

  const [entryType, setEntryType] = useState(initialEntryType);
  const [statusCategory, setStatusCategory] = useState(initialStatusCategory);
  const [practiceId, setPracticeId] = useState("");
  const [payerName, setPayerName] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("batchDate");
  const [ascending, setAscending] = useState(false);

  const effectivePracticeId = contextPracticeId ?? practiceId;

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      direction: ascending ? "asc" : "desc",
    });

    if (entryType) params.set("entryType", entryType);
    if (statusCategory) params.set("statusCategory", statusCategory);
    if (effectivePracticeId) params.set("practiceId", effectivePracticeId);
    if (payerName) params.set("payerName", payerName);
    if (assignedToId) params.set("assignedToId", assignedToId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    return params.toString();
  }, [
    page,
    pageSize,
    sortKey,
    ascending,
    entryType,
    statusCategory,
    effectivePracticeId,
    payerName,
    assignedToId,
    from,
    to,
  ]);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(`/api/eob/entries?${query}`);
      if (response.ok) {
        const payload = await response.json();
        setEntries(payload.data);
        setTotal(payload.pagination?.total ?? payload.data.length);
      }
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  // Changing a filter invalidates the current page number.
  useEffect(() => {
    setPage(1);
  }, [
    entryType,
    statusCategory,
    effectivePracticeId,
    payerName,
    assignedToId,
    from,
    to,
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // A bigger page can leave the cursor past the end of the list.
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const SortHeader = ({
    label,
    sortAs,
    align,
  }: {
    label: string;
    sortAs: SortKey;
    align?: "right";
  }) => (
    <button
      type="button"
      onClick={() => {
        if (sortKey === sortAs) setAscending((current) => !current);
        else {
          setSortKey(sortAs);
          // Dates read newest-first; names and amounts read ascending.
          setAscending(sortAs !== "batchDate");
        }
        setPage(1);
      }}
      className={`inline-flex items-center gap-1 hover:text-slate-800 ${
        align === "right" ? "justify-end" : ""
      }`}
    >
      {label}
      {sortKey === sortAs ? <span>{ascending ? "▲" : "▼"}</span> : null}
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Select
          value={entryType}
          onChange={(event) => setEntryType(event.target.value)}
          className="w-auto min-w-[130px]"
          aria-label="Type"
        >
          <option value="">All types</option>
          <option value={EobEntryType.DENIAL}>Denial</option>
          <option value={EobEntryType.REJECTION}>Rejection</option>
        </Select>

        <Select
          value={statusCategory}
          onChange={(event) => setStatusCategory(event.target.value)}
          className="w-auto min-w-[150px]"
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {Object.values(StatusCategory).map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </Select>

        {isLocked ? null : (
          <Select
            value={practiceId}
            onChange={(event) => setPracticeId(event.target.value)}
            className="w-auto min-w-[160px]"
            aria-label="Practice"
          >
            <option value="">All practices</option>
            {practices.map((practice) => (
              <option key={practice.id} value={practice.id}>
                {practice.name}
              </option>
            ))}
          </Select>
        )}

        <Input
          value={payerName}
          onChange={(event) => setPayerName(event.target.value)}
          placeholder="Search payer"
          className="w-auto min-w-[160px]"
          aria-label="Payer name"
        />

        <Select
          value={assignedToId}
          onChange={(event) => setAssignedToId(event.target.value)}
          className="w-auto min-w-[160px]"
          aria-label="Assigned to"
        >
          <option value="">Anyone</option>
          {assignableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>

        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-auto"
            aria-label="Received from"
          />
          <span className="text-slate-400">→</span>
          <Input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-auto"
            aria-label="Received to"
          />
        </div>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No denials or rejections match these filters"
          description="Clear a filter, or use “Log New EOB/ERA” to record a remittance."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3">
                    <SortHeader label="Patient" sortAs="patientName" />
                  </th>
                  <th className="px-3 py-3">Claim#</th>
                  <th className="px-3 py-3">DOS</th>
                  <th className="px-3 py-3">CPT</th>
                  <th className="px-3 py-3">
                    <SortHeader label="Payer" sortAs="payerName" />
                  </th>
                  <th className="px-3 py-3">ERA# / Ref</th>
                  <th className="px-3 py-3">
                    <SortHeader label="Received" sortAs="batchDate" />
                  </th>
                  <th className="px-3 py-3 text-right">
                    <SortHeader
                      label="Denied"
                      sortAs="deniedAmount"
                      align="right"
                    />
                  </th>
                  <th className="px-3 py-3">Reason</th>
                  <th className="px-3 py-3">
                    <SortHeader label="Status" sortAs="status" />
                  </th>
                  <th className="px-3 py-3">Assigned to</th>
                  <th className="px-3 py-3">Practice</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => router.push(`/eob/entries/${entry.id}`)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-3 py-3">
                      <Badge variant={TYPE_VARIANT[entry.entryType]}>
                        {entry.entryType === EobEntryType.DENIAL
                          ? "Denial"
                          : "Rejection"}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-900">
                      {entry.patientName}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {entry.claimNumber ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                      {formatDate(entry.dateOfService)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-600">
                      {entry.cptCode ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-700">
                      {entry.payerName ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {entry.batchReference ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                      {entry.batchDate ? formatDate(entry.batchDate) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-900">
                      {entry.deniedAmount === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        formatUSD(entry.deniedAmount)
                      )}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-3 text-slate-600">
                      {entry.rejectionReason ?? entry.denialReason}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        label={entry.statusLabel}
                        category={entry.statusCategory}
                      />
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {entry.assignedToName ?? (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {entry.practiceName ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`/eob/entries/${entry.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="text-sm font-medium text-brand-700 hover:text-brand-800"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            currentPage={page}
            totalPages={pageCount}
            totalItems={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            noun="entries"
            filtered={Boolean(entryType || statusCategory || payerName || assignedToId || from || to)}
          />
        </div>
      )}
    </div>
  );
}
