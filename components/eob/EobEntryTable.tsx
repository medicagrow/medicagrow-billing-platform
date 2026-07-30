"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import type { EobEntryDto } from "@/lib/eob-serialize";
import { formatDate, formatUSD } from "@/lib/format";
import { EobEntryType, StatusCategory } from "@/lib/generated/prisma/enums";

type TabKey = "all" | "unresolved" | "denials" | "rejections" | "blue";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All Entries" },
  { key: "unresolved", label: "Unresolved" },
  { key: "denials", label: "Denials" },
  { key: "rejections", label: "Rejections" },
  { key: "blue", label: "Blue" },
];

export function EobEntryTable({
  entries,
  canAssign,
  assignees,
}: {
  entries: EobEntryDto[];
  canAssign: boolean;
  assignees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);

  const visible = useMemo(() => {
    switch (tab) {
      case "unresolved":
        return entries.filter(
          (entry) => entry.statusCategory !== StatusCategory.GREEN,
        );
      case "denials":
        return entries.filter((entry) => entry.entryType === EobEntryType.DENIAL);
      case "rejections":
        return entries.filter(
          (entry) => entry.entryType === EobEntryType.REJECTION,
        );
      case "blue":
        return entries.filter(
          (entry) => entry.statusCategory === StatusCategory.BLUE,
        );
      default:
        return entries;
    }
  }, [entries, tab]);

  const allSelected =
    visible.length > 0 && visible.every((entry) => selected.has(entry.id));

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) visible.forEach((entry) => next.delete(entry.id));
      else visible.forEach((entry) => next.add(entry.id));
      return next;
    });
  }

  async function handleBulkAssign() {
    if (selected.size === 0 || !assignTo) return;

    setAssigning(true);

    try {
      const response = await fetch("/api/eob/entries/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryIds: Array.from(selected),
          assignedToId: assignTo === "__unassign__" ? null : assignTo,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Assignment failed.", "error");
        return;
      }

      toast(`${payload.updated} entr${payload.updated === 1 ? "y" : "ies"} assigned`);
      setSelected(new Set());
      setAssignTo("");
      router.refresh();
    } catch {
      toast("Assignment failed. Check your connection.", "error");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setTab(entry.key);
              setSelected(new Set());
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === entry.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {canAssign ? (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-slate-500">{selected.size} selected</span>
          <Select
            value={assignTo}
            onChange={(event) => setAssignTo(event.target.value)}
            disabled={selected.size === 0 || assigning}
            className="w-auto min-w-[200px]"
          >
            <option value="">Assign selected to…</option>
            {assignees.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
            <option value="__unassign__">— Unassign —</option>
          </Select>
          <Button
            className="px-3 py-2 text-xs"
            onClick={handleBulkAssign}
            disabled={selected.size === 0 || !assignTo || assigning}
          >
            {assigning ? "Assigning…" : "Apply"}
          </Button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState title="Nothing in this view" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                {canAssign ? (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                    />
                  </th>
                ) : null}
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Claim#</th>
                <th className="px-4 py-3">DOS</th>
                <th className="px-4 py-3">CPT</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Denied</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned to</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  {canAssign ? (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(entry.id)) next.delete(entry.id);
                            else next.add(entry.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${entry.patientName}`}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-3">
                    <Link
                      href={`/eob/entries/${entry.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {entry.patientName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {entry.claimNumber ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {formatDate(entry.dateOfService)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {entry.cptCode ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        entry.entryType === EobEntryType.DENIAL
                          ? "violet"
                          : "amber"
                      }
                    >
                      {entry.entryType === EobEntryType.DENIAL
                        ? "Denial"
                        : "Rejection"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {entry.deniedAmount ? formatUSD(entry.deniedAmount) : "—"}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-slate-600">
                    {entry.denialReason}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={entry.statusLabel}
                      category={entry.statusCategory}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {entry.assignedToName ?? (
                      <Badge variant="amber">Unassigned</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/eob/entries/${entry.id}`}
                      className="text-xs font-medium text-brand-700 hover:text-brand-800"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
