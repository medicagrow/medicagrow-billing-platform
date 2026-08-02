"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { NoSpaceInput } from "@/components/ui/NoSpaceInput";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Select, Textarea } from "@/components/ui/Select";
import { SpinnerIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { generateNote, type NoteFields } from "@/lib/ar-note-format";
import {
  DENIAL_ACTIONS,
  HOW_CHECKED_OPTIONS,
  NO_CLAIM_ACTIONS,
  OUTCOME_LABELS,
  OUTCOME_ORDER,
  PAYMENT_SCOPES,
  PAYMENT_TYPES,
  STATUSES_BY_OUTCOME,
  URGENCY_OPTIONS,
  WRITE_OFF_TYPES,
} from "@/lib/ar-outcomes";
import { statusLabelToCategory } from "@/lib/ar-status";
import { OutcomeType } from "@/lib/generated/prisma/enums";

/** Contact fields the How Checked selection can switch off. */
const CONTACT_FIELDS = ["spokeWith", "refNumber", "phone"] as const;

function disabledContactFields(howChecked?: string): Set<string> {
  if (howChecked === "Portal") return new Set(CONTACT_FIELDS);
  // IVR is automated: there is a reference number but nobody to speak to.
  if (howChecked === "IVR") return new Set(["spokeWith"]);
  return new Set();
}

function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
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

export function WorkNoteForm({
  claimId,
  claimNumber,
  projectManagerName,
  disabled,
  disabledReason,
}: {
  claimId: string;
  claimNumber: string | null;
  projectManagerName: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const outcomeRef = useRef<HTMLSelectElement>(null);

  const [outcomeType, setOutcomeType] = useState<OutcomeType>(OutcomeType.PAID);
  const [fields, setFields] = useState<NoteFields>({
    claimNumber: claimNumber ?? "",
  });
  const [statusLabel, setStatusLabel] = useState<string>(
    STATUSES_BY_OUTCOME[OutcomeType.PAID][0]!,
  );
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [denialSuggestions, setDenialSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const availableStatuses = STATUSES_BY_OUTCOME[outcomeType];

  // Reset the status whenever the outcome changes so it can never be invalid.
  useEffect(() => {
    setStatusLabel(STATUSES_BY_OUTCOME[outcomeType][0]!);
  }, [outcomeType]);

  useEffect(() => {
    if (outcomeType !== OutcomeType.DENIED) return;

    let cancelled = false;

    fetch("/api/ar/denial-reasons?pageSize=100")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload?.data) {
          setDenialSuggestions(
            payload.data.map((entry: { reason: string }) => entry.reason),
          );
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [outcomeType]);

  const set = <K extends keyof NoteFields>(key: K, value: NoteFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  const contactDisabled = disabledContactFields(fields.howChecked);

  /**
   * How Checked gates the contact fields: a portal lookup has no reference
   * number or person, and IVR has no person. Values are cleared as well as
   * disabled so a stale entry cannot survive into the saved note.
   */
  useEffect(() => {
    const blocked = disabledContactFields(fields.howChecked);
    if (blocked.size === 0) return;

    setFields((current) => {
      const next = { ...current };
      let changed = false;

      for (const field of CONTACT_FIELDS) {
        if (blocked.has(field) && (current[field] ?? "") !== "") {
          next[field] = "";
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [fields.howChecked]);

  // Same generator the API uses, so the preview is exactly what gets saved.
  const preview = useMemo(
    () => generateNote(outcomeType, fields, { claimNumber }),
    [outcomeType, fields, claimNumber],
  );

  const goesBlue = statusLabelToCategory(statusLabel) === "BLUE";

  function resetForm() {
    setFields({ claimNumber: claimNumber ?? "" });
    setAdditionalNotes("");
    setFollowUpDate("");
    setError(null);
    outcomeRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Per-outcome required fields.
    const missing: string[] = [];
    if (outcomeType === OutcomeType.PAID) {
      if (!fields.amountPaid) missing.push("Amount Paid");
      if (!fields.paymentDate) missing.push("Payment / Finalized Date");
    }
    if (outcomeType === OutcomeType.OTHER && !additionalNotes.trim()) {
      missing.push("Additional Notes");
    }
    if (outcomeType === OutcomeType.DENIED && !fields.denialReason) {
      missing.push("Denial Reason");
    }
    if (outcomeType === OutcomeType.CHECK_WITH_OFFICE && !fields.whatIsNeeded) {
      missing.push("What is needed");
    }
    if (outcomeType === OutcomeType.WRITE_OFF) {
      if (!fields.writeOffAmount) missing.push("Write-off Amount");
      if (!fields.reason) missing.push("Reason");
    }

    if (missing.length > 0) {
      setError(`Required: ${missing.join(", ")}.`);
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/ar/work-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimId,
          outcomeType,
          structuredFields: fields,
          additionalNotes: additionalNotes.trim() || undefined,
          statusChangedTo: statusLabel,
          followUpDateSet: followUpDate || undefined,
          denialReason:
            outcomeType === OutcomeType.DENIED ? fields.denialReason : undefined,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          payload?.error ??
            "Could not save the note. Check the form and try again.",
        );
        setSubmitting(false);
        return;
      }

      toast("Note saved");

      if (payload.reassignedTo) {
        toast(`Claim reassigned to ${payload.reassignedTo}`, "info");
      }

      resetForm();
      router.refresh();
    } catch {
      setError("Could not save the note. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  if (disabled) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
        <p className="text-sm font-medium text-slate-600">
          Notes cannot be added
        </p>
        <p className="mt-1 text-xs text-slate-500">{disabledReason}</p>
      </div>
    );
  }

  const paymentLabel =
    fields.paymentType === "EFT"
      ? "EFT#"
      : fields.paymentType === "VCC"
        ? "VCC#"
        : "Check#";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Outcome type" htmlFor="outcomeType">
        <Select
          id="outcomeType"
          ref={outcomeRef}
          value={outcomeType}
          onChange={(event) =>
            setOutcomeType(event.target.value as OutcomeType)
          }
          disabled={submitting}
        >
          {OUTCOME_ORDER.map((type) => (
            <option key={type} value={type}>
              {OUTCOME_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      {/* The claim number and the date insurance received it open every
          outcome — they are what a rep asks for first. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Claim#"
          htmlFor="claimNumber"
          hint="Pre-filled from the claim; override if it was submitted under a different number."
        >
          <NoSpaceInput
            id="claimNumber"
            value={fields.claimNumber ?? ""}
            onChange={(value) => set("claimNumber", value)}
          />
        </Field>
        {/* No claim on file, a write-off and an office question have no
            received date to state. */}
        {outcomeType === OutcomeType.NO_CLAIM_ON_FILE ||
        outcomeType === OutcomeType.CHECK_WITH_OFFICE ||
        outcomeType === OutcomeType.WRITE_OFF ? null : (
          <Field
            label="Claim received date"
            htmlFor="claimReceivedDate"
            hint="When the insurance received the claim."
          >
            <Input
              id="claimReceivedDate"
              type="date"
              value={fields.claimReceivedDate ?? ""}
              onChange={(event) => set("claimReceivedDate", event.target.value)}
            />
          </Field>
        )}
      </div>

      {/* ---------------------------- PAID ---------------------------- */}
      {outcomeType === OutcomeType.PAID ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Payment / finalized date" htmlFor="paymentDate">
            <Input
              id="paymentDate"
              type="date"
              value={fields.paymentDate ?? ""}
              onChange={(event) => set("paymentDate", event.target.value)}
            />
          </Field>
          <Field label="Amount paid" htmlFor="amountPaid">
            <DecimalInput
              id="amountPaid"
              value={fields.amountPaid ?? ""}
              onChange={(value) => set("amountPaid", value)}
            />
          </Field>
          <Field label="Copay amount (optional)" htmlFor="copayAmount">
            <DecimalInput
              id="copayAmount"
              value={fields.copayAmount ?? ""}
              onChange={(value) => set("copayAmount", value)}
            />
          </Field>
          <Field label="Deductible amount (optional)" htmlFor="deductibleAmount">
            <DecimalInput
              id="deductibleAmount"
              value={fields.deductibleAmount ?? ""}
              onChange={(value) => set("deductibleAmount", value)}
            />
          </Field>
          <Field label="Payment type" htmlFor="paymentType">
            <Select
              id="paymentType"
              value={fields.paymentType ?? ""}
              onChange={(event) => set("paymentType", event.target.value)}
            >
              <option value="">Select…</option>
              {PAYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={paymentLabel} htmlFor="paymentNumber">
            <NoSpaceInput
              id="paymentNumber"
              value={fields.paymentNumber ?? ""}
              onChange={(value) => set("paymentNumber", value)}
            />
          </Field>
          <Field label="Payment scope" htmlFor="paymentScope">
            <Select
              id="paymentScope"
              value={fields.paymentScope ?? "Single"}
              onChange={(event) => set("paymentScope", event.target.value)}
            >
              {PAYMENT_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope} payment
                </option>
              ))}
            </Select>
          </Field>
          {fields.paymentScope === "Bulk" ? (
            <Field label="Bulk total amount" htmlFor="bulkTotalAmount">
              <DecimalInput
                id="bulkTotalAmount"
                value={fields.bulkTotalAmount ?? ""}
                onChange={(value) => set("bulkTotalAmount", value)}
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      {/* --------------------------- DENIED --------------------------- */}
      {outcomeType === OutcomeType.DENIED ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Denial date" htmlFor="denialDate">
              <Input
                id="denialDate"
                type="date"
                value={fields.denialDate ?? ""}
                onChange={(event) => set("denialDate", event.target.value)}
              />
            </Field>
            <Field
              label="Denial code (CARC/RARC)"
              htmlFor="denialCode"
              hint="The code on the EOB, e.g. CO-197. Drives denial trending."
            >
              <NoSpaceInput
                id="denialCode"
                value={fields.denialCode ?? ""}
                onChange={(value) => set("denialCode", value)}
                placeholder="CO-197"
              />
            </Field>
            <Field
              label="Denial reason"
              htmlFor="denialReason"
              hint="Pick an existing reason or type a new one — new reasons are added automatically."
            >
              <Input
                id="denialReason"
                list="denial-reasons"
                value={fields.denialReason ?? ""}
                onChange={(event) => set("denialReason", event.target.value)}
              />
              <datalist id="denial-reasons">
                {denialSuggestions.map((reason) => (
                  <option key={reason} value={reason} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="Denial detail" htmlFor="denialDetail">
            <Textarea
              id="denialDetail"
              value={fields.denialDetail ?? ""}
              onChange={(event) => set("denialDetail", event.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Action taken" htmlFor="actionTaken">
              <Select
                id="actionTaken"
                value={fields.actionTaken ?? ""}
                onChange={(event) => set("actionTaken", event.target.value)}
              >
                <option value="">Select…</option>
                {DENIAL_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </Select>
            </Field>
            {fields.actionTaken === "Other" ? (
              <Field label="Action detail" htmlFor="actionDetail">
                <Input
                  id="actionDetail"
                  value={fields.actionDetail ?? ""}
                  onChange={(event) => set("actionDetail", event.target.value)}
                />
              </Field>
            ) : null}
            <Field
              label="Appeal deadline (optional)"
              htmlFor="appealDeadline"
              hint="Appeal windows are short and missing one forfeits the claim."
            >
              <Input
                id="appealDeadline"
                type="date"
                value={fields.appealDeadline ?? ""}
                onChange={(event) => set("appealDeadline", event.target.value)}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {/* --------------------- NO CLAIM ON FILE ----------------------- */}
      {outcomeType === OutcomeType.NO_CLAIM_ON_FILE ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Checked date" htmlFor="checkedDate">
            <Input
              id="checkedDate"
              type="date"
              value={fields.checkedDate ?? ""}
              onChange={(event) => set("checkedDate", event.target.value)}
            />
          </Field>
          <Field
            label="Timely Filing Deadline"
            htmlFor="timelyFilingDeadline"
            hint="Past this date the claim is unbillable — track it before it lapses."
          >
            <Input
              id="timelyFilingDeadline"
              type="date"
              value={fields.timelyFilingDeadline ?? ""}
              onChange={(event) =>
                set("timelyFilingDeadline", event.target.value)
              }
            />
          </Field>
          <Field label="Resubmission Date" htmlFor="resubmissionDate">
            <Input
              id="resubmissionDate"
              type="date"
              value={fields.resubmissionDate ?? ""}
              onChange={(event) => set("resubmissionDate", event.target.value)}
            />
          </Field>
          <Field label="Action taken" htmlFor="actionTaken">
            <Select
              id="actionTaken"
              value={fields.actionTaken ?? ""}
              onChange={(event) => set("actionTaken", event.target.value)}
            >
              <option value="">Select…</option>
              {NO_CLAIM_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      {/* ------------------ PATIENT RESPONSIBILITY -------------------- */}
      {outcomeType === OutcomeType.PATIENT_RESPONSIBILITY ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Finalized date" htmlFor="paymentDate">
            <Input
              id="paymentDate"
              type="date"
              value={fields.paymentDate ?? ""}
              onChange={(event) => set("paymentDate", event.target.value)}
            />
          </Field>
          <Field label="Deductible amount (optional)" htmlFor="deductibleAmount">
            <DecimalInput
              id="deductibleAmount"
              value={fields.deductibleAmount ?? ""}
              onChange={(value) => set("deductibleAmount", value)}
            />
          </Field>
          <Field label="Copay amount" htmlFor="copayAmount">
            <DecimalInput
              id="copayAmount"
              value={fields.copayAmount ?? ""}
              onChange={(value) => set("copayAmount", value)}
            />
          </Field>
          <Field label="Coinsurance amount" htmlFor="coinsuranceAmount">
            <DecimalInput
              id="coinsuranceAmount"
              value={fields.coinsuranceAmount ?? ""}
              onChange={(value) => set("coinsuranceAmount", value)}
            />
          </Field>
          <Field
            label="Total patient balance (optional)"
            htmlFor="patientBalance"
          >
            <DecimalInput
              id="patientBalance"
              value={fields.patientBalance ?? ""}
              onChange={(value) => set("patientBalance", value)}
            />
          </Field>
          <Field
            label="Statement sent date (optional)"
            htmlFor="statementSentDate"
            hint="Proves the patient was billed before the balance ages further."
          >
            <Input
              id="statementSentDate"
              type="date"
              value={fields.statementSentDate ?? ""}
              onChange={(event) => set("statementSentDate", event.target.value)}
            />
          </Field>
        </div>
      ) : null}

      {/* ------------------------- IN PROCESS ------------------------- */}
      {outcomeType === OutcomeType.IN_PROCESS ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Checked date" htmlFor="checkedDate">
            <Input
              id="checkedDate"
              type="date"
              value={fields.checkedDate ?? ""}
              onChange={(event) => set("checkedDate", event.target.value)}
            />
          </Field>
          <Field
            label="TAT / expected resolution (optional)"
            htmlFor="expectedResolution"
            hint="Processing time/TAT mentioned by insurance."
          >
            <Input
              id="expectedResolution"
              value={fields.expectedResolution ?? ""}
              onChange={(event) =>
                set("expectedResolution", event.target.value)
              }
              placeholder="e.g. 14 business days"
            />
          </Field>
        </div>
      ) : null}

      {/* --------------------- CHECK WITH OFFICE ---------------------- */}
      {outcomeType === OutcomeType.CHECK_WITH_OFFICE ? (
        <div className="space-y-3">
          <Field label="What is needed" htmlFor="whatIsNeeded">
            <Textarea
              id="whatIsNeeded"
              value={fields.whatIsNeeded ?? ""}
              onChange={(event) => set("whatIsNeeded", event.target.value)}
              placeholder="What must the practice provide before this can move forward?"
            />
          </Field>
          <Field
            label="Needed by (optional)"
            htmlFor="neededByDate"
            hint="Gives the PM a date to chase the practice against."
          >
            <Input
              id="neededByDate"
              type="date"
              value={fields.neededByDate ?? ""}
              onChange={(event) => set("neededByDate", event.target.value)}
            />
          </Field>
          <Field label="Urgency" htmlFor="urgency">
            <Select
              id="urgency"
              value={fields.urgency ?? "Normal"}
              onChange={(event) => set("urgency", event.target.value)}
            >
              {URGENCY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      {/* -------------------------- WRITE OFF ------------------------- */}
      {outcomeType === OutcomeType.WRITE_OFF ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Write-off amount" htmlFor="writeOffAmount">
            <DecimalInput
              id="writeOffAmount"
              value={fields.writeOffAmount ?? ""}
              onChange={(value) => set("writeOffAmount", value)}
            />
          </Field>
          <Field label="Reason" htmlFor="reason">
            <Input
              id="reason"
              value={fields.reason ?? ""}
              onChange={(event) => set("reason", event.target.value)}
            />
          </Field>
          <Field
            label="Write-off type"
            htmlFor="writeOffType"
            hint="Separates preventable loss (timely filing) from contractual adjustments."
          >
            <Select
              id="writeOffType"
              value={fields.writeOffType ?? ""}
              onChange={(event) => set("writeOffType", event.target.value)}
            >
              <option value="">Select…</option>
              {WRITE_OFF_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Approved by (optional)"
            htmlFor="approvedBy"
            hint="Write-offs discard revenue — record who authorised it."
          >
            <Input
              id="approvedBy"
              value={fields.approvedBy ?? ""}
              onChange={(event) => set("approvedBy", event.target.value)}
            />
          </Field>
        </div>
      ) : null}

      {/* ------------------------ COMMON FIELDS ----------------------- */}
      <div className="space-y-3 border-t border-slate-100 pt-4">
        {/* Sits above the contact fields because it controls them. */}
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">
            How checked
          </legend>
          <div className="mt-1.5 flex gap-4">
            {HOW_CHECKED_OPTIONS.map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="radio"
                  name="howChecked"
                  value={option}
                  checked={fields.howChecked === option}
                  onChange={() => set("howChecked", option)}
                  className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-600"
                />
                {option}
              </label>
            ))}
          </div>
          {contactDisabled.size > 0 ? (
            <p className="mt-1.5 text-xs text-slate-500">
              {fields.howChecked === "Portal"
                ? "Portal lookups have no representative or reference number, so those fields are off."
                : "IVR is automated — there is no representative to record."}
            </p>
          ) : null}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Spoke with" htmlFor="spokeWith">
            <Input
              id="spokeWith"
              value={fields.spokeWith ?? ""}
              onChange={(event) => set("spokeWith", event.target.value)}
              disabled={contactDisabled.has("spokeWith")}
            />
          </Field>
          <Field label="Ref#" htmlFor="refNumber">
            <Input
              id="refNumber"
              value={fields.refNumber ?? ""}
              onChange={(event) => set("refNumber", event.target.value)}
              disabled={contactDisabled.has("refNumber")}
            />
          </Field>
          <Field label="Phone#" htmlFor="phone">
            <PhoneInput
              id="phone"
              value={fields.phone ?? ""}
              onChange={(value) => set("phone", value)}
              disabled={contactDisabled.has("phone")}
            />
          </Field>
        </div>

        <Field label="Additional notes (optional)" htmlFor="additionalNotes">
          <Textarea
            id="additionalNotes"
            value={additionalNotes}
            onChange={(event) => setAdditionalNotes(event.target.value)}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Follow-up date (optional)" htmlFor="followUpDate">
            <Input
              id="followUpDate"
              type="date"
              value={followUpDate}
              onChange={(event) => setFollowUpDate(event.target.value)}
            />
          </Field>
          <Field label="New status" htmlFor="statusLabel">
            <Select
              id="statusLabel"
              value={statusLabel}
              onChange={(event) => setStatusLabel(event.target.value)}
            >
              {availableStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {goesBlue ? (
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-inset ring-sky-200">
            This claim will be reassigned to {projectManagerName} for
            coordination after saving.
          </p>
        ) : null}
      </div>

      {/* ------------------------ NOTE PREVIEW ------------------------ */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Note Preview
        </p>
        <pre className="mt-1.5 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2.5 font-mono text-xs leading-relaxed text-slate-700 ring-1 ring-inset ring-slate-200">
          {preview}
          {additionalNotes.trim() ? `\n\n${additionalNotes.trim()}` : ""}
        </pre>
      </div>

      {error ? <FieldError>{error}</FieldError> : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={resetForm} disabled={submitting}>
          Clear
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save note"
          )}
        </Button>
      </div>
    </form>
  );
}
