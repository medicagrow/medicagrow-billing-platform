"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { CptInput } from "@/components/ui/inputs/CptInput";
import { PersonNameInput } from "@/components/ui/inputs/PersonNameInput";
import { NoSpaceInput } from "@/components/ui/NoSpaceInput";
import { PracticeField } from "@/components/ui/PracticeField";
import { usePracticeDefault } from "@/lib/hooks/usePracticeDefault";
import { Modal } from "@/components/ui/Modal";
import { Select, Textarea } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { EobEntryType } from "@/lib/generated/prisma/enums";

interface EntryDraft {
  entryType: EobEntryType;
  patientName: string;
  claimNumber: string;
  dateOfService: string;
  cptCode: string;
  billedAmount: string;
  deniedAmount: string;
  denialCode: string;
  denialReason: string;
  actionRequired: string;
  assignedToId: string;
}

const emptyEntry = (): EntryDraft => ({
  entryType: EobEntryType.DENIAL,
  patientName: "",
  claimNumber: "",
  dateOfService: "",
  cptCode: "",
  billedAmount: "",
  deniedAmount: "",
  denialCode: "",
  denialReason: "",
  actionRequired: "",
  assignedToId: "",
});

export function LogEobModal({
  practices,
  payerSuggestions,
  membersByPractice,
  currentUser,
  canAssignOthers,
}: {
  practices: { id: string; name: string }[];
  payerSuggestions: string[];
  /** Who may be assigned an entry, keyed by practice. */
  membersByPractice: Record<string, { id: string; name: string }[]>;
  currentUser: { id: string; name: string };
  /** Billers may only take entries themselves. */
  canAssignOthers: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  // The top-bar practice seeds the form; "All Practices" leaves it blank.
  const { practiceId: contextPracticeId } = usePracticeDefault();

  const [open, setOpen] = useState(false);
  const [practiceId, setPracticeId] = useState(contextPracticeId ?? "");
  const [batchDate, setBatchDate] = useState("");
  const [payerName, setPayerName] = useState("");
  const [batchReference, setBatchReference] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<EntryDraft[]>([
    { ...emptyEntry(), assignedToId: currentUser.id },
  ]);
  const [reasonSuggestions, setReasonSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Denial reasons are shared with the AR module's self-populating list.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetch("/api/ar/denial-reasons?pageSize=100")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload?.data) {
          setReasonSuggestions(
            payload.data.map((entry: { reason: string }) => entry.reason),
          );
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setPracticeId(contextPracticeId ?? "");
    setBatchDate("");
    setPayerName("");
    setBatchReference("");
    setTotalAmount("");
    setNotes("");
    setEntries([{ ...emptyEntry(), assignedToId: currentUser.id }]);
    setError(null);
    setSaving(false);
  }

  function close() {
    if (saving) return;
    reset();
    setOpen(false);
  }

  const effectivePracticeId = contextPracticeId ?? practiceId;

  /**
   * A biller may only take entries themselves, so their list is just them.
   * Before a practice is chosen there is no roster to offer either.
   */
  const assigneeOptions = !canAssignOthers
    ? [currentUser]
    : effectivePracticeId
      ? (membersByPractice[effectivePracticeId] ?? [currentUser])
      : [currentUser];

  // Changing practice can strip an assignee of their access, so anyone no
  // longer eligible falls back to the poster rather than silently persisting.
  // The roster is recomputed here rather than closed over, so the dependency
  // list is the real one.
  useEffect(() => {
    const allowed = new Set(
      (!canAssignOthers
        ? [currentUser]
        : effectivePracticeId
          ? (membersByPractice[effectivePracticeId] ?? [currentUser])
          : [currentUser]
      ).map((option) => option.id),
    );

    setEntries((current) =>
      current.map((entry) =>
        allowed.has(entry.assignedToId)
          ? entry
          : { ...entry, assignedToId: currentUser.id },
      ),
    );
  }, [effectivePracticeId, canAssignOthers, currentUser, membersByPractice]);

  const updateEntry = (index: number, patch: Partial<EntryDraft>) =>
    setEntries((current) =>
      current.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!practiceId) return setError("Select a practice.");
    if (!batchDate) return setError("Enter the date the ERA/EOB was received.");
    if (!payerName.trim()) return setError("Enter the payer name.");
    if (!totalAmount) return setError("Enter the total amount.");

    const incomplete = entries.findIndex(
      (entry) =>
        !entry.patientName.trim() ||
        !entry.dateOfService ||
        !entry.denialReason.trim() ||
        !entry.assignedToId,
    );

    if (incomplete !== -1) {
      return setError(
        `Row ${incomplete + 1} needs a patient name, date of service, reason and assignee.`,
      );
    }

    setSaving(true);

    try {
      const response = await fetch("/api/eob/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practiceId: contextPracticeId ?? practiceId,
          batchDate,
          payerName: payerName.trim(),
          batchReference: batchReference.trim() || undefined,
          totalAmount,
          notes: notes.trim() || undefined,
          entries: entries.map((entry) => ({
            entryType: entry.entryType,
            patientName: entry.patientName.trim(),
            claimNumber: entry.claimNumber.trim() || undefined,
            dateOfService: entry.dateOfService,
            cptCode: entry.cptCode.trim() || undefined,
            billedAmount: entry.billedAmount || undefined,
            deniedAmount: entry.deniedAmount || undefined,
            denialCode: entry.denialCode.trim() || undefined,
            denialReason: entry.denialReason.trim(),
            actionRequired: entry.actionRequired.trim() || undefined,
            assignedToId: entry.assignedToId,
          })),
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not save the EOB batch.");
        return;
      }

      toast(
        `Logged ${payload.entryCount} entr${payload.entryCount === 1 ? "y" : "ies"}`,
      );
      reset();
      setOpen(false);
      router.refresh();
      // The batch has no page of its own — its entries land on the flat list.
      router.push("/eob");
    } catch {
      setError("Could not save the EOB batch. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Log New EOB/ERA</Button>

      <Modal
        open={open}
        onClose={close}
        title="Log EOB/ERA"
        description="Record a remittance and the denials or rejections on it."
        wide
      >
        <form id="eob-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <PracticeField
              id="eobPractice"
              value={practiceId}
              onChange={setPracticeId}
              practices={practices}
              disabled={saving}
            />

            <div className="space-y-1.5">
              <Label htmlFor="eobDate">Date received</Label>
              <Input
                id="eobDate"
                type="date"
                value={batchDate}
                onChange={(event) => setBatchDate(event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="eobPayer">Payer</Label>
              <Input
                id="eobPayer"
                list="eob-payers"
                value={payerName}
                onChange={(event) => setPayerName(event.target.value)}
                disabled={saving}
              />
              <datalist id="eob-payers">
                {payerSuggestions.map((payer) => (
                  <option key={payer} value={payer} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="eobReference">Reference (ERA# / check#)</Label>
              <NoSpaceInput
                id="eobReference"
                value={batchReference}
                onChange={setBatchReference}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="eobTotal">Total amount</Label>
              <DecimalInput
                id="eobTotal"
                value={totalAmount}
                onChange={setTotalAmount}
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="eobNotes">Notes (optional)</Label>
            <Textarea
              id="eobNotes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={saving}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Denials & rejections ({entries.length})
              </p>
              <Button
                variant="secondary"
                className="px-2.5 py-1 text-xs"
                onClick={() =>
                  setEntries((current) => [
                    ...current,
                    { ...emptyEntry(), assignedToId: currentUser.id },
                  ])
                }
                disabled={saving}
              >
                Add Row
              </Button>
            </div>

            <div className="space-y-3">
              {entries.map((entry, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">
                      Row {index + 1}
                    </span>
                    {entries.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEntries((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                        disabled={saving}
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <Select
                      value={entry.entryType}
                      onChange={(event) =>
                        updateEntry(index, {
                          entryType: event.target.value as EobEntryType,
                        })
                      }
                      disabled={saving}
                      aria-label="Entry type"
                    >
                      <option value={EobEntryType.DENIAL}>Denial</option>
                      <option value={EobEntryType.REJECTION}>Rejection</option>
                    </Select>
                    <PersonNameInput
                      value={entry.patientName}
                      onChange={(patientName) =>
                        updateEntry(index, { patientName })
                      }
                      placeholder="Patient name"
                      disabled={saving}
                      aria-label="Patient name"
                    />
                    <Input
                      type="date"
                      value={entry.dateOfService}
                      onChange={(event) =>
                        updateEntry(index, { dateOfService: event.target.value })
                      }
                      disabled={saving}
                      aria-label="Date of service"
                    />
                    <NoSpaceInput
                      value={entry.claimNumber}
                      onChange={(claimNumber) =>
                        updateEntry(index, { claimNumber })
                      }
                      placeholder="Claim#"
                      disabled={saving}
                      aria-label="Claim number"
                    />
                    <CptInput
                      value={entry.cptCode}
                      onChange={(cptCode) => updateEntry(index, { cptCode })}
                      placeholder="CPT"
                      disabled={saving}
                      aria-label="CPT code"
                    />
                    <NoSpaceInput
                      value={entry.denialCode}
                      onChange={(denialCode) =>
                        updateEntry(index, { denialCode })
                      }
                      placeholder="Code (CO-197)"
                      disabled={saving}
                    />
                    <DecimalInput
                      value={entry.billedAmount}
                      onChange={(value) =>
                        updateEntry(index, { billedAmount: value })
                      }
                      placeholder="Billed"
                      disabled={saving}
                    />
                    <DecimalInput
                      value={entry.deniedAmount}
                      onChange={(value) =>
                        updateEntry(index, { deniedAmount: value })
                      }
                      placeholder="Denied"
                      disabled={saving}
                    />
                    <Input
                      value={entry.actionRequired}
                      onChange={(event) =>
                        updateEntry(index, { actionRequired: event.target.value })
                      }
                      placeholder="Action required"
                      disabled={saving}
                    />
                    {/* Every entry is owned from the moment it is logged —
                        an unassigned one sits in the flat list unworked. */}
                    <Select
                      value={entry.assignedToId}
                      onChange={(event) =>
                        updateEntry(index, { assignedToId: event.target.value })
                      }
                      disabled={saving || !canAssignOthers}
                      aria-label="Assigned to"
                    >
                      {assigneeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                    <div className="sm:col-span-3">
                      <Input
                        list="eob-reasons"
                        value={entry.denialReason}
                        onChange={(event) =>
                          updateEntry(index, { denialReason: event.target.value })
                        }
                        placeholder="Denial / rejection reason"
                        disabled={saving}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <datalist id="eob-reasons">
              {reasonSuggestions.map((reason) => (
                <option key={reason} value={reason} />
              ))}
            </datalist>
          </div>

          {error ? <FieldError>{error}</FieldError> : null}
        </form>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="eob-form" disabled={saving}>
            {saving ? "Saving…" : `Log ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
          </Button>
        </div>
      </Modal>
    </>
  );
}
