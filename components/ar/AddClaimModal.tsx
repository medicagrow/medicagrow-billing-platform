"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { NoSpaceInput } from "@/components/ui/NoSpaceInput";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";

interface Assignee {
  id: string;
  name: string;
}

const EMPTY = {
  patientName: "",
  dateOfService: "",
  insuranceName: "",
  providerName: "",
  claimNumber: "",
  cptCode: "",
  subscriberId: "",
  billedAmount: "",
  balance: "",
  visitId: "",
  visitStatus: "",
  assignedToId: "",
};

export function AddClaimModal({
  batchId,
  assignees,
}: {
  batchId: string;
  assignees: Assignee[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof EMPTY, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  function close() {
    if (saving) return;
    setForm(EMPTY);
    setError(null);
    setOpen(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const missing: string[] = [];
    if (!form.patientName.trim()) missing.push("Patient Name");
    if (!form.dateOfService) missing.push("Date of Service");
    if (!form.insuranceName.trim()) missing.push("Insurance Name");
    if (!form.providerName.trim()) missing.push("Provider Name");
    if (!form.balance) missing.push("Balance");

    if (missing.length > 0) {
      setError(`Required: ${missing.join(", ")}.`);
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/ar/claims/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          patientName: form.patientName.trim(),
          dateOfService: form.dateOfService,
          insuranceName: form.insuranceName.trim(),
          providerName: form.providerName.trim(),
          balance: form.balance,
          billedAmount: form.billedAmount || undefined,
          claimNumber: form.claimNumber.trim() || undefined,
          cptCode: form.cptCode.trim() || undefined,
          subscriberId: form.subscriberId.trim() || undefined,
          visitId: form.visitId.trim() || undefined,
          visitStatus: form.visitStatus.trim() || undefined,
          assignedToId: form.assignedToId || undefined,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          payload?.error ??
            Object.values(payload?.details?.fieldErrors ?? {})
              .flat()
              .join(" ") ??
            "Could not add the claim.",
        );
        return;
      }

      toast("Claim added successfully");
      setForm(EMPTY);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not add the claim. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add Claim Manually
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Add claim manually"
        description="Adds one claim to this batch and updates the batch totals."
        wide
      >
        <form id="add-claim-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="patientName">Patient name</Label>
              <Input
                id="patientName"
                value={form.patientName}
                onChange={(event) => set("patientName", event.target.value)}
                disabled={saving}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dateOfService">Date of service</Label>
              <Input
                id="dateOfService"
                type="date"
                value={form.dateOfService}
                onChange={(event) => set("dateOfService", event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="insuranceName">Insurance name</Label>
              <Input
                id="insuranceName"
                value={form.insuranceName}
                onChange={(event) => set("insuranceName", event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="providerName">Provider name</Label>
              <Input
                id="providerName"
                value={form.providerName}
                onChange={(event) => set("providerName", event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="claimNumber">Claim # (optional)</Label>
              <Input
                id="claimNumber"
                value={form.claimNumber}
                onChange={(event) => set("claimNumber", event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cptCode">CPT code (optional)</Label>
              <Input
                id="cptCode"
                value={form.cptCode}
                onChange={(event) => set("cptCode", event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="subscriberId">Subscriber ID (optional)</Label>
              <Input
                id="subscriberId"
                value={form.subscriberId}
                onChange={(event) => set("subscriberId", event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="billedAmount">Billed amount (optional)</Label>
              <DecimalInput
                id="billedAmount"
                value={form.billedAmount}
                onChange={(value) => set("billedAmount", value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="balance">Balance</Label>
              <DecimalInput
                id="balance"
                value={form.balance}
                onChange={(value) => set("balance", value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="visitId">Visit ID (optional)</Label>
              <NoSpaceInput
                id="visitId"
                value={form.visitId}
                onChange={(value) => set("visitId", value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="visitStatus">Visit status (optional)</Label>
              <Input
                id="visitStatus"
                value={form.visitStatus}
                onChange={(event) => set("visitStatus", event.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assignedToId">Assign to (optional)</Label>
              <Select
                id="assignedToId"
                value={form.assignedToId}
                onChange={(event) => set("assignedToId", event.target.value)}
                disabled={saving}
              >
                <option value="">Leave unassigned</option>
                {assignees.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {error ? <FieldError>{error}</FieldError> : null}
        </form>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="add-claim-form" disabled={saving}>
            {saving ? "Adding…" : "Add claim"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
