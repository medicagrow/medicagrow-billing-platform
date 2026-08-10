"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { FieldError, Input, Label } from "@/components/ui/Input";
import {
  AlphanumericInput,
  EINInput,
  NPIInput,
  StateInput,
  TaxonomyInput,
  ZipInput,
} from "@/components/ui/IdentifierInputs";
import { Modal } from "@/components/ui/Modal";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { EHR_SOURCE_LABELS } from "@/lib/ehr-labels";
import { EhrSource } from "@/lib/generated/prisma/enums";
import { PracticeRequirementsTab } from "@/components/settings/PracticeRequirementsTab";
import type { TaskTypeOption } from "@/components/task/TaskFormFields";

export interface PracticeDetail {
  id: string;
  name: string;
  ehrSource: EhrSource;
  isActive: boolean;
  taxId: string;
  npi: string;
  taxonomy: string;
  medicarePtan: string;
  medicaidProviderNumber: string;
  billingAddressLine1: string;
  billingAddressLine2: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  contactPersonName: string;
  contactPhone: string;
  contactFax: string;
  contactEmail: string;
  primaryPmId: string;
}

export interface PmOption {
  id: string;
  name: string;
}

export interface ProviderRow {
  id: string;
  firstName: string;
  lastName: string;
  npi: string;
  licenseNumber: string | null;
  licenseState: string | null;
  taxonomy: string | null;
  isActive: boolean;
}

type TabKey =
  | "general"
  | "billing"
  | "contact"
  | "providers"
  | "requirements";

const TABS: { key: TabKey; label: string }[] = [
  { key: "general", label: "General" },
  { key: "billing", label: "Billing Address" },
  { key: "contact", label: "Contact" },
  { key: "providers", label: "Provider Roster" },
  { key: "requirements", label: "Monthly Requirements" },
];

function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function PracticeDetailTabs({
  practice,
  providers: initialProviders,
  projectManagers,
  canEdit,
  canAssignPm = false,
  taskTypes,
}: {
  practice: PracticeDetail;
  providers: ProviderRow[];
  /** Every active task type — one requirement row each. */
  taskTypes: TaskTypeOption[];
  /** Only project managers may own a practice's escalations. */
  projectManagers: PmOption[];
  canEdit: boolean;
  /** Owners only: choosing who escalations route to. */
  canAssignPm?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState<TabKey>("general");
  const [form, setForm] = useState<PracticeDetail>(practice);
  const [saving, setSaving] = useState<TabKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderRow[]>(initialProviders);

  const set = <K extends keyof PracticeDetail>(
    key: K,
    value: PracticeDetail[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  /** Each tab patches only its own fields. */
  async function save(which: TabKey, payload: Record<string, unknown>) {
    setError(null);
    setSaving(which);

    try {
      const response = await fetch(`/api/settings/practices/${practice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          result?.error ??
            Object.values(result?.details?.fieldErrors ?? {})
              .flat()
              .join(" ") ??
            "Could not save.",
        );
        return;
      }

      toast("Practice saved");
      router.refresh();
    } catch {
      setError("Could not save. Check your connection.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-slate-200">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === entry.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {entry.label}
            {entry.key === "providers" && providers.length > 0 ? (
              <span className="ml-1.5 text-xs text-slate-400">
                {providers.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      {/* ------------------------------ General ------------------------------ */}
      {tab === "general" ? (
        <form
          className="max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save("general", {
              name: form.name,
              ehrSource: form.ehrSource,
              isActive: form.isActive,
              ...(canAssignPm ? { primaryPmId: form.primaryPmId } : {}),
              taxId: form.taxId,
              npi: form.npi,
              taxonomy: form.taxonomy,
              medicarePtan: form.medicarePtan,
              medicaidProviderNumber: form.medicaidProviderNumber,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Practice name" htmlFor="name">
              <Input
                id="name"
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="EHR source"
              htmlFor="ehrSource"
              hint="Reference only — imports use the standard CSV."
            >
              <Select
                id="ehrSource"
                value={form.ehrSource}
                onChange={(event) =>
                  set("ehrSource", event.target.value as EhrSource)
                }
                disabled={!canEdit}
              >
                {Object.values(EhrSource).map((source) => (
                  <option key={source} value={source}>
                    {EHR_SOURCE_LABELS[source]}
                  </option>
                ))}
              </Select>
            </Field>

            {/*
              Who owns the practice relationship decides where escalations
              land, so it stays an Owner's call — a PM sees it but reads it.
            */}
            <Field
              label="Primary Project Manager"
              htmlFor="primaryPmId"
              hint={
                canAssignPm
                  ? "This PM receives all escalated claims and EOB entries for this practice."
                  : "Set by an owner. This PM receives all escalated claims and EOB entries for this practice."
              }
            >
              {canAssignPm ? (
                <Select
                  id="primaryPmId"
                  value={form.primaryPmId}
                  onChange={(event) => set("primaryPmId", event.target.value)}
                  disabled={!canEdit}
                >
                  <option value="">Not assigned</option>
                  {projectManagers.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <p id="primaryPmId" className="py-2 text-sm text-slate-700">
                  {projectManagers.find((pm) => pm.id === form.primaryPmId)
                    ?.name ?? (
                    <span className="text-slate-400">Not assigned</span>
                  )}
                </p>
              )}
            </Field>

            <Field label="Tax ID (EIN)" htmlFor="taxId" hint="Format XX-XXXXXXX">
              <EINInput
                id="taxId"
                value={form.taxId}
                onChange={(value) => set("taxId", value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="NPI" htmlFor="npi" hint="Exactly 10 digits">
              <NPIInput
                id="npi"
                value={form.npi}
                onChange={(value) => set("npi", value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Taxonomy code" htmlFor="taxonomy">
              <TaxonomyInput
                id="taxonomy"
                value={form.taxonomy}
                onChange={(value) => set("taxonomy", value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Medicare PTAN" htmlFor="medicarePtan">
              <AlphanumericInput
                id="medicarePtan"
                maxLength={10}
                value={form.medicarePtan}
                onChange={(value) => set("medicarePtan", value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Medicaid provider #" htmlFor="medicaidProviderNumber">
              <AlphanumericInput
                id="medicaidProviderNumber"
                maxLength={15}
                value={form.medicaidProviderNumber}
                onChange={(value) => set("medicaidProviderNumber", value)}
                disabled={!canEdit}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => set("isActive", event.target.checked)}
              disabled={!canEdit}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
            />
            Active
          </label>

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving === "general"}>
                {saving === "general" ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {/* -------------------------- Billing Address -------------------------- */}
      {tab === "billing" ? (
        <form
          className="max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save("billing", {
              billingAddressLine1: form.billingAddressLine1,
              billingAddressLine2: form.billingAddressLine2,
              billingCity: form.billingCity,
              billingState: form.billingState,
              billingZip: form.billingZip,
            });
          }}
        >
          <Field label="Address line 1" htmlFor="billingAddressLine1">
            <Input
              id="billingAddressLine1"
              value={form.billingAddressLine1}
              onChange={(event) => set("billingAddressLine1", event.target.value)}
              disabled={!canEdit}
            />
          </Field>

          <Field label="Address line 2" htmlFor="billingAddressLine2">
            <Input
              id="billingAddressLine2"
              value={form.billingAddressLine2}
              onChange={(event) => set("billingAddressLine2", event.target.value)}
              disabled={!canEdit}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" htmlFor="billingCity">
              <Input
                id="billingCity"
                value={form.billingCity}
                onChange={(event) => set("billingCity", event.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="State" htmlFor="billingState">
              <StateInput
                id="billingState"
                value={form.billingState}
                onChange={(value) => set("billingState", value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="ZIP" htmlFor="billingZip">
              <ZipInput
                id="billingZip"
                value={form.billingZip}
                onChange={(value) => set("billingZip", value)}
                disabled={!canEdit}
              />
            </Field>
          </div>

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving === "billing"}>
                {saving === "billing" ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {/* ------------------------------ Contact ------------------------------ */}
      {tab === "contact" ? (
        <form
          className="max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-card"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save("contact", {
              contactPersonName: form.contactPersonName,
              contactPhone: form.contactPhone,
              contactFax: form.contactFax,
              contactEmail: form.contactEmail,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person" htmlFor="contactPersonName">
              <Input
                id="contactPersonName"
                value={form.contactPersonName}
                onChange={(event) => set("contactPersonName", event.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Email" htmlFor="contactEmail">
              <Input
                id="contactEmail"
                type="email"
                value={form.contactEmail}
                onChange={(event) => set("contactEmail", event.target.value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Phone" htmlFor="contactPhone">
              <PhoneInput
                id="contactPhone"
                value={form.contactPhone}
                onChange={(value) => set("contactPhone", value)}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Fax" htmlFor="contactFax">
              <PhoneInput
                id="contactFax"
                value={form.contactFax}
                onChange={(value) => set("contactFax", value)}
                disabled={!canEdit}
              />
            </Field>
          </div>

          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving === "contact"}>
                {saving === "contact" ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {/* -------------------------- Provider Roster -------------------------- */}
      {tab === "requirements" ? (
        <PracticeRequirementsTab
          practiceId={practice.id}
          taskTypes={taskTypes}
          canEdit={canEdit}
        />
      ) : null}

      {tab === "providers" ? (
        <ProviderRoster
          practiceId={practice.id}
          providers={providers}
          setProviders={setProviders}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ProviderRoster({
  practiceId,
  providers,
  setProviders,
  canEdit,
}: {
  practiceId: string;
  providers: ProviderRow[];
  setProviders: (rows: ProviderRow[]) => void;
  canEdit: boolean;
}) {
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderRow | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [npi, setNpi] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseState, setLicenseState] = useState("");
  const [taxonomy, setTaxonomy] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const response = await fetch(
      `/api/settings/practices/${practiceId}/providers`,
    );
    if (response.ok) {
      const payload = await response.json();
      setProviders(payload.data);
    }
  }

  function openCreate() {
    setEditing(null);
    setFirstName("");
    setLastName("");
    setNpi("");
    setLicenseNumber("");
    setLicenseState("");
    setTaxonomy("");
    setIsActive(true);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(provider: ProviderRow) {
    setEditing(provider);
    setFirstName(provider.firstName);
    setLastName(provider.lastName);
    setNpi(provider.npi);
    setLicenseNumber(provider.licenseNumber ?? "");
    setLicenseState(provider.licenseState ?? "");
    setTaxonomy(provider.taxonomy ?? "");
    setIsActive(provider.isActive);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!firstName.trim() || !lastName.trim()) {
      return setFormError("First and last name are required.");
    }
    if (npi.length !== 10) {
      return setFormError("NPI must be exactly 10 digits.");
    }

    setSaving(true);

    try {
      const response = await fetch(
        editing
          ? `/api/settings/practices/${practiceId}/providers/${editing.id}`
          : `/api/settings/practices/${practiceId}/providers`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            npi,
            licenseNumber,
            licenseState,
            taxonomy,
            isActive,
          }),
        },
      );

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setFormError(result?.error ?? "Could not save the provider.");
        return;
      }

      toast(editing ? "Provider updated" : "Provider added");
      setModalOpen(false);
      await reload();
    } catch {
      setFormError("Could not save the provider. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(provider: ProviderRow) {
    const response = await fetch(
      `/api/settings/practices/${practiceId}/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !provider.isActive }),
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      toast(payload?.error ?? "Could not update the provider.", "error");
      return;
    }

    toast(provider.isActive ? "Provider deactivated" : "Provider activated");
    await reload();
  }

  return (
    <div>
      {canEdit ? (
        <div className="mb-4 flex justify-end">
          <Button onClick={openCreate}>Add Provider</Button>
        </div>
      ) : null}

      {providers.length === 0 ? (
        <EmptyState
          title="No providers on this roster"
          description="Add the rendering providers who bill under this practice group."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">NPI</th>
                <th className="px-4 py-3">License #</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Taxonomy</th>
                <th className="px-4 py-3">Status</th>
                {canEdit ? <th className="px-4 py-3 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {providers.map((provider) => (
                <tr key={provider.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {provider.lastName}, {provider.firstName}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">
                    {provider.npi}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {provider.licenseNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {provider.licenseState ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {provider.taxonomy ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={provider.isActive ? "brand" : "neutral"}>
                      {provider.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  {canEdit ? (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(provider)}
                          className="text-xs font-medium text-brand-700 hover:text-brand-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(provider)}
                          className="text-xs font-medium text-slate-500 hover:text-slate-800"
                        >
                          {provider.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => (saving ? undefined : setModalOpen(false))}
        title={editing ? "Edit provider" : "Add provider"}
        wide
      >
        <form id="provider-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name" htmlFor="providerFirstName">
              <Input
                id="providerFirstName"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                disabled={saving}
                autoFocus
              />
            </Field>
            <Field label="Last name" htmlFor="providerLastName">
              <Input
                id="providerLastName"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                disabled={saving}
              />
            </Field>
            <Field label="NPI" htmlFor="providerNpi" hint="Exactly 10 digits">
              <NPIInput
                id="providerNpi"
                value={npi}
                onChange={setNpi}
                disabled={saving}
              />
            </Field>
            <Field label="Taxonomy" htmlFor="providerTaxonomy">
              <TaxonomyInput
                id="providerTaxonomy"
                value={taxonomy}
                onChange={setTaxonomy}
                disabled={saving}
              />
            </Field>
            <Field label="License #" htmlFor="providerLicense">
              <AlphanumericInput
                id="providerLicense"
                maxLength={30}
                value={licenseNumber}
                onChange={setLicenseNumber}
                disabled={saving}
              />
            </Field>
            <Field label="License state" htmlFor="providerLicenseState">
              <StateInput
                id="providerLicenseState"
                value={licenseState}
                onChange={setLicenseState}
                disabled={saving}
              />
            </Field>
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
          <Button type="submit" form="provider-form" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add provider"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
