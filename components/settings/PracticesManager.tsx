"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";
import { EHR_SOURCE_LABELS } from "@/lib/ehr-labels";
import { EhrSource } from "@/lib/generated/prisma/enums";
import { formatDate } from "@/lib/format";

interface PracticeRow {
  id: string;
  name: string;
  ehrSource: EhrSource;
  isActive: boolean;
  createdAt: string;
  batchCount: number;
  userCount: number;
  primaryPmName: string | null;
}

export function PracticesManager({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();

  const [practices, setPractices] = useState<PracticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [ehrSource, setEhrSource] = useState<EhrSource>(EhrSource.OPEN_PM);
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/settings/practices");
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setLoadError(payload?.error ?? "Could not load practices.");
        return;
      }

      setPractices(payload.data);
    } catch {
      setLoadError("Could not load practices. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setName("");
    setEhrSource(EhrSource.OPEN_PM);
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (name.trim().length < 2) {
      setFormError("Practice name is required.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        "/api/settings/practices",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), ehrSource, isActive }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setFormError(payload?.error ?? "Could not save the practice.");
        setSaving(false);
        return;
      }

      toast("Practice created");
      setModalOpen(false);
      await load();
      router.refresh();
    } catch {
      setFormError("Could not save the practice. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(practice: PracticeRow) {
    try {
      const response = await fetch(`/api/settings/practices/${practice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !practice.isActive }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Could not update the practice.", "error");
        return;
      }

      toast(practice.isActive ? "Practice deactivated" : "Practice activated");
      await load();
      router.refresh();
    } catch {
      toast("Could not update the practice.", "error");
    }
  }

  return (
    <>
      {canEdit ? (
        <div className="mb-4 flex justify-end">
          <Button onClick={openCreate}>Add Practice</Button>
        </div>
      ) : null}

      {loading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : loadError ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-100">
          {loadError}
          <button type="button" onClick={load} className="ml-2 font-medium underline">
            Retry
          </button>
        </div>
      ) : practices.length === 0 ? (
        <EmptyState
          title="No practices yet"
          description="Add your first practice to start uploading AR batches."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Practice</th>
                <th className="px-4 py-3">EHR source</th>
                <th className="px-4 py-3">Primary PM</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Batches</th>
                <th className="px-4 py-3 text-right">Users</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {practices.map((practice) => (
                <tr key={practice.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {practice.name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {EHR_SOURCE_LABELS[practice.ehrSource]}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {practice.primaryPmName ?? (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={practice.isActive ? "brand" : "neutral"}>
                      {practice.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {practice.batchCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {practice.userCount}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(practice.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/settings/practices/${practice.id}`}
                          className="text-xs font-medium text-brand-700 hover:text-brand-800"
                        >
                          View
                        </Link>
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => toggleActive(practice)}
                            className="text-xs font-medium text-slate-500 hover:text-slate-800"
                          >
                            {practice.isActive ? "Deactivate" : "Activate"}
                          </button>
                        ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => (saving ? undefined : setModalOpen(false))}
        title="Add practice"
        description="Practices are the top-level unit — AR batches belong to one. Full details are edited on the practice page."
      >
        <form id="practice-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="practice-name">Practice name</Label>
            <Input
              id="practice-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Riverside Family Medicine"
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="practice-ehr">EHR source</Label>
            <Select
              id="practice-ehr"
              value={ehrSource}
              onChange={(event) =>
                setEhrSource(event.target.value as EhrSource)
              }
              disabled={saving}
            >
              {Object.values(EhrSource).map((source) => (
                <option key={source} value={source}>
                  {EHR_SOURCE_LABELS[source]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-500">
              Reference only — AR imports use the standard CSV format
              regardless of EHR.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            Active
          </label>

          {formError ? <FieldError>{formError}</FieldError> : null}
        </form>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setModalOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" form="practice-form" disabled={saving}>
            {saving ? "Saving…" : "Create practice"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
