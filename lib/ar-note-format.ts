import { OutcomeType } from "@/lib/generated/prisma/enums";
import { formatUSD } from "@/lib/format";

/**
 * Builds the generated note text for each outcome (build spec §9.1–9.7).
 *
 * Used by both the live preview in the note form and the API on submission —
 * the same function on both sides, so what the biller previews is exactly what
 * is persisted. The API regenerates rather than trusting the client's copy.
 */

export interface NoteFields {
  // Common to every outcome
  claimNumber?: string;
  claimReceivedDate?: string;
  spokeWith?: string;
  refNumber?: string;
  phone?: string;
  howChecked?: string;

  // Paid
  amountPaid?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  allowedAmount?: string;
  paymentDate?: string;
  copayAmount?: string;
  deductibleAmount?: string;
  paymentType?: string;
  paymentNumber?: string;
  paymentScope?: string;
  bulkTotalAmount?: string;

  // Denied
  denialDate?: string;
  denialCode?: string;
  denialReason?: string;
  denialDetail?: string;
  actionTaken?: string;
  actionDetail?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  appealDeadline?: string;

  // No claim on file / In process
  checkedDate?: string;
  expectedResolution?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  expectedPaymentDate?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  timelyFilingDeadline?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  resubmissionDate?: string;

  // Patient responsibility
  coinsuranceAmount?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  patientBalance?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  statementSentDate?: string;

  // Check with office
  whatIsNeeded?: string;
  urgency?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  neededByDate?: string;

  // Write off
  writeOffAmount?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  writeOffType?: string;
  /** @deprecated no longer collected; present in older saved notes. */
  approvedBy?: string;
  reason?: string;
}

export interface NoteContext {
  /** The claim's stored number, used when the biller leaves the field blank. */
  claimNumber?: string | null;
}

const blank = "____";

const value = (input?: string) => {
  const text = (input ?? "").trim();
  return text === "" ? undefined : text;
};

const money = (input?: string) => {
  const text = value(input);
  return text === undefined ? undefined : formatUSD(text);
};

/**
 * Dates reach a note as MM/DD/YYYY, never ISO.
 *
 * Date inputs hand back YYYY-MM-DD, which is unreadable in a note a biller
 * pastes into a payer portal. Anything already in MM/DD/YYYY, or in a shape
 * this does not recognise, is passed through untouched.
 */
export function noteDate(input?: string): string | undefined {
  const text = value(input);
  if (text === undefined) return undefined;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  return text;
}

/**
 * "Sw John Ref#123 Ph#800-456-2583."
 *
 * Parts left empty are omitted, which is also how the How Checked gating
 * surfaces: Portal clears all three, IVR clears Spoke With.
 */
function contactSentence(fields: NoteFields): string {
  const parts: string[] = [];

  if (value(fields.spokeWith)) parts.push(`Sw ${value(fields.spokeWith)}`);
  if (value(fields.refNumber)) parts.push(`Ref#${value(fields.refNumber)}`);
  if (value(fields.phone)) parts.push(`Ph#${value(fields.phone)}`);

  return parts.length > 0 ? `${parts.join(" ")}.` : "";
}

/**
 * How the claim was checked — "Checked via Portal."
 *
 * "via", not "on": "Checked on" is reserved for the checked *date*, and having
 * both produced two sentences that read like duplicate dates.
 */
function howCheckedSentence(fields: NoteFields): string {
  const how = value(fields.howChecked);
  return how ? `Checked via ${how}.` : "";
}

/** The biller's entry wins; otherwise fall back to the claim's stored number. */
function claimPrefix(fields: NoteFields, context: NoteContext): string {
  const claimNumber =
    value(fields.claimNumber) ?? value(context.claimNumber ?? undefined);
  return claimNumber ? `Claim#${claimNumber}, ` : "";
}

/** The one place the claim-received date is stated. */
function receivedByInsurance(fields: NoteFields): string {
  const date = noteDate(fields.claimReceivedDate);
  return date ? `Claim received by ins. on ${date}.` : "";
}

/** Joins sentence fragments, dropping empties and collapsing whitespace. */
function join(...parts: (string | undefined)[]): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

export function generateNote(
  outcomeType: OutcomeType,
  fields: NoteFields,
  context: NoteContext = {},
): string {
  const contact = contactSentence(fields);
  const howChecked = howCheckedSentence(fields);
  const prefix = claimPrefix(fields, context);
  const received = receivedByInsurance(fields);

  switch (outcomeType) {
    case OutcomeType.PAID: {
      const amount = money(fields.amountPaid) ?? blank;
      const paidOn = noteDate(fields.paymentDate) ?? blank;
      const copay = money(fields.copayAmount);
      const deductible = money(fields.deductibleAmount);
      const paymentType = value(fields.paymentType) ?? blank;
      const paymentNumber = value(fields.paymentNumber) ?? blank;
      const scope = value(fields.paymentScope) ?? "Single";
      const bulkTotal = money(fields.bulkTotalAmount);

      const copayClause = copay ? ` with ${copay} Copay` : "";
      const deductibleClause = deductible ? ` and ${deductible} Deductible` : "";
      const bulkClause = scope === "Bulk" && bulkTotal ? ` of ${bulkTotal}` : "";

      return join(
        `${prefix}${received}`,
        `Paid/Finalized on ${paidOn} for ${amount}${copayClause}${deductibleClause} via ${paymentType}# ${paymentNumber} as ${scope} payment${bulkClause}.`,
        contact,
        howChecked,
      );
    }

    case OutcomeType.DENIED: {
      const denialDate = noteDate(fields.denialDate) ?? blank;
      const denialCode = value(fields.denialCode);
      const denialReason = value(fields.denialReason) ?? blank;
      const denialDetail = value(fields.denialDetail);
      const action = value(fields.actionTaken);
      const actionDetail = value(fields.actionDetail);

      const actionText =
        action === "Other" && actionDetail ? actionDetail : action;

      return join(
        `${prefix}${received}`,
        `Denied on ${denialDate} for ${denialReason}.`,
        denialCode ? `Denial code ${denialCode}.` : undefined,
        denialDetail ? `${denialDetail}.` : undefined,
        actionText ? `${actionText}.` : undefined,
        contact,
        howChecked,
      );
    }

    case OutcomeType.NO_CLAIM_ON_FILE: {
      const checkedOn = noteDate(fields.checkedDate);
      const action = value(fields.actionTaken);

      return join(
        `${prefix}No claim on file.`,
        checkedOn ? `Checked on ${checkedOn}.` : undefined,
        action ? `${action}.` : undefined,
        contact,
        howChecked,
      );
    }

    case OutcomeType.PATIENT_RESPONSIBILITY: {
      const finalizedOn = noteDate(fields.paymentDate) ?? blank;
      const deductible = money(fields.deductibleAmount);
      const copay = money(fields.copayAmount);
      const coinsurance = money(fields.coinsuranceAmount);

      const responsibility = [
        deductible ? `${deductible} Deductible` : undefined,
        copay ? `${copay} Copay` : undefined,
        coinsurance ? `${coinsurance} Coinsurance` : undefined,
      ].filter(Boolean);

      const responsibilityClause =
        responsibility.length > 0 ? ` with ${responsibility.join(" / ")}` : "";

      return join(
        `${prefix}${received}`,
        `Paid/Finalized on ${finalizedOn} as patient responsibility${responsibilityClause}.`,
        contact,
        howChecked,
      );
    }

    case OutcomeType.IN_PROCESS: {
      const checkedOn = noteDate(fields.checkedDate) ?? blank;
      const expected = value(fields.expectedResolution);

      return join(
        `${prefix}${received}`,
        `Checked on ${checkedOn} — In Process.`,
        expected ? `TAT: ${expected}.` : undefined,
        contact,
        howChecked,
      );
    }

    case OutcomeType.CHECK_WITH_OFFICE: {
      const needed = value(fields.whatIsNeeded) ?? blank;
      const urgent = value(fields.urgency) === "Urgent";

      return join(
        `${prefix}Check with office — ${needed}.`,
        urgent ? "URGENT." : undefined,
      );
    }

    case OutcomeType.WRITE_OFF: {
      const amount = money(fields.writeOffAmount) ?? blank;
      const reason = value(fields.reason) ?? blank;

      return join(
        `${prefix}Write off ${amount} — ${reason}.`,
        contact,
        howChecked,
      );
    }

    case OutcomeType.OTHER:
    default: {
      const checkedOn = noteDate(fields.checkedDate);

      return (
        join(
          `${prefix}${received}`.trim(),
          checkedOn ? `Checked on ${checkedOn}.` : undefined,
          contact,
          howChecked,
        ) || "Claim reviewed."
      );
    }
  }
}
