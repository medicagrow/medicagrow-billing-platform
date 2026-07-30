"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { NumericInput } from "@/components/ui/inputs/NumericInput";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";

interface TaskTypeRow {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

export function TaskTypesManager() {
  const { toast } = useToast();

  const [types, setTypes] = useState<TaskTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSortOrder, setNewSortOrder] = useState("");

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/task-types?pageSize=100");
      if (response.ok) {
        const payload = await response.json();
        setTypes(payload.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    setBusyId(id);

    try {
      const response = await fetch(`/api/task-types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not save the change.");
        return false;
      }

      await load();
      return true;
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Swapping the two rows' sortOrder is enough to reorder them, and it leaves
   * every other row untouched — no renumbering pass to go wrong.
   */
  async function move(index: number, direction: -1 | 1) {
    const current = types[index];
    const neighbour = types[index + direction];
    if (!current || !neighbour) return;

    setBusyId(current.id);

    try {
      await Promise.all([
        fetch(`/api/task-types/${current.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: neighbour.sortOrder }),
        }),
        fetch(`/api/task-types/${neighbour.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sortOrder: current.sortOrder }),
        }),
      ]);

      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function create() {
    setError(null);

    if (newName.trim() === "") {
      setError("A name is required.");
      return;
    }

    setBusyId("new");

    try {
      const response = await fetch("/api/task-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          // Default to the end of the list.
          sortOrder:
            newSortOrder === ""
              ? (types.at(-1)?.sortOrder ?? 0) + 10
              : Number(newSortOrder),
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error ?? "Could not add the task type.");
        return;
      }

      toast("Task type added", "success");
      setNewName("");
      setNewSortOrder("");
      setAdding(false);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function saveName(id: string) {
    if (editName.trim() === "") {
      setError("A name is required.");
      return;
    }

    const ok = await patch(id, { name: editName.trim() });
    if (ok) setEditingId(null);
  }

  return (
    <div>
      {error ? (
        <p className="mb-3">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      <div className="mb-3 flex justify-end">
        {adding ? null : (
          <Button onClick={() => setAdding(true)}>Add task type</Button>
        )}
      </div>

      {adding ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="new-task-type-name">Name</Label>
              <Input
                id="new-task-type-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                maxLength={60}
                placeholder="Credentialing"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-task-type-order">Sort order</Label>
              <NumericInput
                id="new-task-type-order"
                maxLength={4}
                value={newSortOrder}
                onChange={setNewSortOrder}
                placeholder="Last"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={create} disabled={busyId === "new"}>
                {busyId === "new" ? "Adding…" : "Add"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setAdding(false);
                  setNewName("");
                  setNewSortOrder("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton />
      ) : types.length === 0 ? (
        <EmptyState
          title="No task types yet"
          description="Add the categories your team uses to classify work."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Order</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {types.map((type, index) => (
                <tr key={type.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    {editingId === type.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          maxLength={60}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === "Enter") saveName(type.id);
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          className="max-w-xs"
                        />
                        <Button
                          className="px-2.5 py-1 text-xs"
                          onClick={() => saveName(type.id)}
                          disabled={busyId === type.id}
                        >
                          Save
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-2.5 py-1 text-xs"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(type.id);
                          setEditName(type.name);
                          setError(null);
                        }}
                        className="font-medium text-slate-900 hover:text-brand-700"
                      >
                        {type.name}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {type.isActive ? (
                      <Badge variant="brand">Active</Badge>
                    ) : (
                      <Badge variant="neutral">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="mr-1 tabular-nums text-slate-500">
                        {type.sortOrder}
                      </span>
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={index === 0 || busyId !== null}
                        aria-label={`Move ${type.name} up`}
                        className="rounded px-1.5 py-0.5 text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={
                          index === types.length - 1 || busyId !== null
                        }
                        aria-label={`Move ${type.name} down`}
                        className="rounded px-1.5 py-0.5 text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        patch(type.id, { isActive: !type.isActive })
                      }
                      disabled={busyId === type.id}
                      className="text-sm font-medium text-brand-700 hover:text-brand-800 disabled:opacity-50"
                    >
                      {type.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Deactivated types disappear from the task pickers, but tasks already
        classified with one keep showing its name.
      </p>
    </div>
  );
}
