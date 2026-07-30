"use client";

import { useMemo } from "react";
import {
  FIELD_LABELS,
  MERGE_SENTINEL,
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
  missingRequiredFields,
  type FieldMapping,
  type OptionalField,
  type RequiredField,
} from "@/lib/ar-parsers/detect";
import {
  describeDateCorrections,
  detectDateFormat,
  normalizeDate,
} from "@/lib/ar-parsers/dates";
import { cleanString, toDecimalString } from "@/lib/ar-parsers/utils";

const PREVIEW_ROWS = 5;
const AMOUNT_FIELDS = new Set<string>(["billed_amount", "balance"]);

type AnyField = RequiredField | OptionalField;

const ALL_FIELDS: AnyField[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

function Dropdown({
  value,
  onChange,
  headers,
  extraOption,
  invalid,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  headers: string[];
  extraOption?: { value: string; label: string };
  invalid?: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
      className={`block w-full rounded-lg border-0 px-2.5 py-1.5 text-sm shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-inset focus:ring-brand-600 ${
        invalid
          ? "bg-amber-50 text-amber-900 ring-amber-300"
          : "bg-white text-slate-900 ring-slate-300"
      }`}
    >
      <option value="">— Not mapped —</option>
      {extraOption ? (
        <option value={extraOption.value}>{extraOption.label}</option>
      ) : null}
      {headers.map((header, index) => (
        <option key={`${header}-${index}`} value={header}>
          {header}
        </option>
      ))}
    </select>
  );
}

export function CsvMappingStep({
  csv,
  mapping,
  onChange,
}: {
  csv: ParsedCsv;
  mapping: FieldMapping;
  onChange: (mapping: FieldMapping) => void;
}) {
  const { headers, rows } = csv;

  const set = <K extends keyof FieldMapping>(
    key: K,
    value: FieldMapping[K],
  ) => onChange({ ...mapping, [key]: value });

  const missing = missingRequiredFields(mapping);
  const missingSet = new Set<string>(missing);

  const columnIndex = (header: string | null) =>
    header ? headers.indexOf(header) : -1;

  // The date order is decided from the whole mapped column, exactly as the
  // server parser does, so the preview shows the real interpretation.
  const dateReport = useMemo(() => {
    const index = columnIndex(mapping.date_of_service);
    if (index === -1) return null;

    const samples = rows
      .map((row) => row[index]?.trim())
      .filter((value): value is string => Boolean(value));

    return detectDateFormat(samples);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping.date_of_service, rows, headers]);

  const dateNotes = dateReport ? describeDateCorrections(dateReport) : [];

  const sample = rows.slice(0, PREVIEW_ROWS);

  /** Raw value for a field on one row, honouring the first+last merge. */
  const rawValue = (row: string[], field: AnyField): string => {
    if (field === "patient_name" && mapping.patient_name === MERGE_SENTINEL) {
      const first = cleanString(row[columnIndex(mapping.first_name_col)]) ?? "";
      const last = cleanString(row[columnIndex(mapping.last_name_col)]) ?? "";
      return `${first} ${last}`.trim();
    }

    const index = columnIndex(mapping[field] as string | null);
    return index === -1 ? "" : (cleanString(row[index]) ?? "");
  };

  /** How the importer would read that value. */
  const normalizedValue = (field: AnyField, raw: string): string | null => {
    if (raw === "") return null;

    if (field === "date_of_service") {
      const normalized = normalizeDate(raw, dateReport?.order ?? "MDY");
      return normalized ? normalized.canonical : null;
    }

    if (AMOUNT_FIELDS.has(field)) {
      return toDecimalString(raw) ?? null;
    }

    return raw;
  };

  const isMapped = (field: AnyField) =>
    field === "patient_name"
      ? mapping.patient_name === MERGE_SENTINEL
        ? Boolean(mapping.first_name_col && mapping.last_name_col)
        : Boolean(mapping.patient_name)
      : Boolean(mapping[field]);

  /** A sample row counts as valid when every required field would parse. */
  const validSampleRows = sample.filter((row) =>
    REQUIRED_FIELDS.every((field) => {
      if (!isMapped(field)) return false;
      const raw = rawValue(row, field);
      if (raw === "") return false;
      return normalizedValue(field, raw) !== null;
    }),
  ).length;

  const mergeAvailable = headers.length > 0;

  return (
    <div className="space-y-5">
      {/* ------------------------- field mapping ------------------------- */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Field mapping
        </p>

        {missing.length > 0 ? (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
            {missing.length} required field
            {missing.length === 1 ? "" : "s"} not mapped:{" "}
            {missing.map((field) => FIELD_LABELS[field]).join(", ")}. Pick a
            column for {missing.length === 1 ? "it" : "each"} before importing.
          </p>
        ) : null}

        <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">CSV column</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ALL_FIELDS.map((field) => {
                const required = (REQUIRED_FIELDS as readonly string[]).includes(
                  field,
                );
                const unmappedRequired = missingSet.has(field);
                const merged =
                  field === "patient_name" &&
                  mapping.patient_name === MERGE_SENTINEL;

                return (
                  <tr
                    key={field}
                    className={unmappedRequired ? "bg-amber-50/60" : undefined}
                  >
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-800">
                        {FIELD_LABELS[field]}
                      </span>
                      {required ? (
                        <span className="ml-1 text-red-500">*</span>
                      ) : null}
                      <span className="block font-mono text-[11px] text-slate-400">
                        {field}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Dropdown
                        value={mapping[field] as string | null}
                        onChange={(value) =>
                          set(field as keyof FieldMapping, value)
                        }
                        headers={headers}
                        invalid={unmappedRequired}
                        extraOption={
                          field === "patient_name" && mergeAvailable
                            ? {
                                value: MERGE_SENTINEL,
                                label: "Merge: First + Last",
                              }
                            : undefined
                        }
                      />

                      {merged ? (
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          <Dropdown
                            value={mapping.first_name_col}
                            onChange={(value) => set("first_name_col", value)}
                            headers={headers}
                            invalid={!mapping.first_name_col}
                          />
                          <Dropdown
                            value={mapping.last_name_col}
                            onChange={(value) => set("last_name_col", value)}
                            headers={headers}
                            invalid={!mapping.last_name_col}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {isMapped(field) ? (
                        <span className="text-emerald-600">✓ Mapped</span>
                      ) : required ? (
                        <span className="text-amber-700">⚠ Not mapped</span>
                      ) : (
                        <span className="text-slate-400">Not mapped</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {dateReport ? (
          <p className="mt-2 text-xs text-slate-500">
            Date format detected:{" "}
            <span className="font-medium text-slate-700">
              {dateReport.description}
            </span>
          </p>
        ) : null}

        {dateNotes.length > 0 ? (
          <ul className="mt-1.5 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
            {dateNotes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* -------------------------- data preview -------------------------- */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Data preview
          <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
            first {Math.min(PREVIEW_ROWS, sample.length)} row
            {sample.length === 1 ? "" : "s"}, as the importer would read them
          </span>
        </p>

        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-slate-50 text-left font-medium uppercase tracking-wide text-slate-500">
              <tr>
                {ALL_FIELDS.map((field) => {
                  const required = (
                    REQUIRED_FIELDS as readonly string[]
                  ).includes(field);
                  const unmapped = !isMapped(field);

                  return (
                    <th
                      key={field}
                      className={`whitespace-nowrap px-3 py-2 ${
                        unmapped && required
                          ? "bg-red-50 text-red-700"
                          : unmapped
                            ? "text-slate-300"
                            : ""
                      }`}
                    >
                      {FIELD_LABELS[field]}
                      {unmapped ? (
                        <span className="ml-1 font-normal normal-case">
                          (unmapped)
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sample.length === 0 ? (
                <tr>
                  <td
                    colSpan={ALL_FIELDS.length}
                    className="px-3 py-4 text-center text-slate-400"
                  >
                    No data rows in this file.
                  </td>
                </tr>
              ) : (
                sample.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {ALL_FIELDS.map((field) => {
                      const required = (
                        REQUIRED_FIELDS as readonly string[]
                      ).includes(field);
                      const unmapped = !isMapped(field);
                      const raw = unmapped ? "" : rawValue(row, field);
                      const normalized = unmapped
                        ? null
                        : normalizedValue(field, raw);
                      const changed = normalized !== null && normalized !== raw;
                      const invalid = !unmapped && raw !== "" && normalized === null;

                      return (
                        <td
                          key={field}
                          className={`whitespace-nowrap px-3 py-2 ${
                            unmapped
                              ? required
                                ? "bg-red-50 text-red-400"
                                : "bg-slate-50 text-slate-300"
                              : invalid
                                ? "bg-red-50 text-red-700"
                                : "text-slate-700"
                          }`}
                        >
                          {unmapped ? (
                            "—"
                          ) : raw === "" ? (
                            <span
                              className={
                                required ? "text-red-600" : "text-slate-300"
                              }
                            >
                              {required ? "missing" : "—"}
                            </span>
                          ) : changed ? (
                            <>
                              <span className="text-slate-400">{raw}</span>
                              <span className="mx-1 text-slate-300">→</span>
                              <span className="font-medium">{normalized}</span>
                            </>
                          ) : invalid ? (
                            <>
                              <span>{raw}</span>
                              <span className="ml-1 font-medium">
                                (unreadable)
                              </span>
                            </>
                          ) : (
                            raw
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">
            {validSampleRows} of {sample.length}
          </span>{" "}
          sampled row{sample.length === 1 ? "" : "s"} are valid and will be
          imported.
          {validSampleRows < sample.length ? (
            <span className="text-slate-500">
              {" "}
              Rows that fail validation are skipped and reported after import.
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
