"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";

export interface TeamMemberStats {
  id: string;
  name: string;
  role: keyof typeof roleLabels;
  open: number;
  inProcess: number;
  hold: number;
  overdue: number;
  closed: number;
}

/**
 * The team workload table.
 *
 * Name search filters the rows already on screen — the list is one row per
 * person, so there is nothing to paginate and a round trip would only add
 * latency. The practice filter goes through the URL instead, because it
 * changes which tasks are *counted*, which only the server can do.
 */
export function TeamTasksClient({
  members,
  practices,
  selectedPracticeIds,
}: {
  members: TeamMemberStats[];
  practices: { id: string; name: string }[];
  selectedPracticeIds: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return members;

    return members.filter((member) =>
      member.name.toLowerCase().includes(needle),
    );
  }, [members, search]);

  function applyPractices(next: string[]) {
    const params = new URLSearchParams(searchParams.toString());

    // Everything selected is the same view as nothing selected, so the param
    // is dropped rather than listing every practice.
    if (next.length === 0 || next.length === practices.length) {
      params.delete("practiceIds");
    } else {
      params.set("practiceIds", next.join(","));
    }

    router.push(`/tasks/team?${params.toString()}`);
  }

  /** Links land on the full list, pre-filtered to that person. */
  const listHref = (
    memberId: string,
    extra: Record<string, string> = {},
  ) => {
    const params = new URLSearchParams({ assignedToId: memberId, ...extra });

    if (selectedPracticeIds.length === 1) {
      params.set("practiceId", selectedPracticeIds[0]!);
    }

    return `/tasks/list?${params.toString()}`;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name…"
          className="w-auto min-w-[200px]"
          aria-label="Search by name"
        />

        <MultiSelectDropdown
          options={practices.map((practice) => ({
            label: practice.name,
            value: practice.id,
          }))}
          selected={selectedPracticeIds}
          onChange={applyPractices}
          placeholder="All practices"
          allLabel="All Practices"
          noun="practices"
          aria-label="Practice"
          className="w-auto min-w-[200px]"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={
            members.length === 0
              ? "No team members to show"
              : "Nobody matches that name"
          }
          description={
            members.length === 0
              ? "People appear here once they are assigned to a practice."
              : "Clear the search to see the whole team."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Open</th>
                <th className="px-4 py-3 text-right">In process</th>
                <th className="px-4 py-3 text-right">On hold</th>
                <th className="px-4 py-3 text-right">Overdue</th>
                <th className="px-4 py-3 text-right">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((member) => (
                <tr key={member.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={listHref(member.id)}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {member.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={roleBadgeVariants[member.role]}>
                      {roleLabels[member.role]}
                    </Badge>
                  </td>

                  {(
                    [
                      [member.open, TaskStatus.OPEN, "text-slate-700"],
                      [
                        member.inProcess,
                        TaskStatus.IN_PROCESS,
                        "text-slate-700",
                      ],
                      [member.hold, TaskStatus.HOLD, "text-amber-700"],
                    ] as const
                  ).map(([count, status, tone]) => (
                    <td key={status} className="px-4 py-3 text-right tabular-nums">
                      <Link
                        href={listHref(member.id, { status })}
                        className={`hover:underline ${tone}`}
                      >
                        {count}
                      </Link>
                    </td>
                  ))}

                  <td className="px-4 py-3 text-right tabular-nums">
                    {/* Overdue is a filter, not a status, so it links through
                        overdue=true rather than a status value. */}
                    <Link
                      href={listHref(member.id, { overdue: "true" })}
                      className={`hover:underline ${
                        member.overdue > 0
                          ? "font-medium text-red-700"
                          : "text-slate-500"
                      }`}
                    >
                      {member.overdue}
                    </Link>
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums">
                    <Link
                      href={listHref(member.id, { status: TaskStatus.CLOSED })}
                      className="text-slate-700 hover:underline"
                    >
                      {member.closed}
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
