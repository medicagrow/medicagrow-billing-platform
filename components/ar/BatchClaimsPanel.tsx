"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgingBadge } from "@/components/ar/AgingBadge";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import {
  isPageSize,
  Pagination,
  PAGE_SIZE_OPTIONS,
} from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { SettingsIcon } from "@/components/ui/icons";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/toast";
import {
  NOT_ACTIONABLE_BUCKET,
  NOT_ACTIONABLE_MAX_DAYS,
} from "@/lib/ar-actionable";
import { AGING_BUCKETS } from "@/lib/ar-aging";
import { hasActiveFilters, useFilterState } from "@/lib/hooks/useFilterState";
import { isBoolean, useLocalSetting } from "@/lib/hooks/useLocalSetting";
import type { ClaimDto } from "@/lib/ar-serialize";
import { downloadCsv } from "@/lib/csv-export";
import { formatDate, formatUSD } from "@/lib/format";
import { ALL_STATUSES, statusLabelToCategory } from "@/lib/ar-status";
import type { StatusCategory } from "@/lib/generated/prisma/enums";
import { formatDateIST } from "@/lib/timezone";
import {
  BatchAnalysisTab,
  type DrillDownStep,
} from "@/components/ar/BatchAnalysisTab";
import {
  BatchSummaryBar,
  type ClaimListMeta,
} from "@/components/ar/BatchSummaryBar";
import {
  BulkFollowUpModal,
  BulkUpdateModal,
} from "@/components/ar/BulkClaimModals";
import { ClaimQuickPanel } from "@/components/ar/ClaimQuickPanel";
import { SmartAlertsTab } from "@/components/ar/SmartAlertsTab";
import {
  ALERT_TYPE_LABELS,
  HOW_CHECKED_FILTERS,
  isAlertType,
  type SmartAlert,
} from "@/lib/ar/batch-insights-shared";
import { CLAIMS_CHANGED_EVENT } from "@/lib/ar/claims-changed";

export type TabKey =
  | "all"
  | "unassigned"
  | "red"
  | "blue"
  | "overdue"
  | "reassigned"
  | "analysis"
  | "alerts";

/** Tabs that show the claim table, as opposed to a report about it. */
const LIST_TABS: TabKey[] = [
  "all",
  "unassigned",
  "red",
  "blue",
  "overdue",
  "reassigned",
];

type SortKey = "aging" | "patientName" | "provider" | "balance" | "status";

/** The first of the shared page sizes — 50 rows. */
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0]!;

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All Claims" },
  { key: "unassigned", label: "Unassigned" },
  { key: "red", label: "Red Claims" },
  { key: "blue", label: "Blue Claims" },
  { key: "overdue", label: "Overdue Follow-ups" },
];

/** "Nobody" is a choice in the Assigned To list, but it is not a user. */
const UNASSIGNED = "__unassigned__";

/**
 * The three categories, in the order a claim moves through them, with what
 * each one actually means — "Red" alone tells a new PM nothing.
 */
const CATEGORY_OPTIONS: {
  value: StatusCategory;
  label: string;
  dot: string;
}[] = [
  {
    value: "RED",
    label: "Red — Biller Action Pending",
    dot: "bg-red-500",
  },
  {
    value: "BLUE",
    label: "Blue — Blocked on Practice",
    dot: "bg-sky-500",
  },
  {
    value: "GREEN",
    label: "Green — Biller Action Complete",
    dot: "bg-emerald-500",
  },
];

/**
 * The export's columns, in order, and the row that fills them.
 *
 * Declared beside each other so a column added to one without the other is a
 * visible mistake rather than a silently shifted spreadsheet.
 */
const EXPORT_COLUMNS = [
  "Patient Name",
  "Date of Service",
  "Insurance Name",
  "Claim#",
  "CPT Code",
  "Visit ID",
  "Visit Status",
  "Provider",
  "Billed Amount",
  "Insurance Paid",
  "Patient Paid",
  "Balance",
  "Aging Days",
  "Status Category",
  "Status Label",
  "Assigned To",
  "Follow-up Date",
  "Last Worked Date",
  "Last Worked By",
  "Last Note",
];

interface ExportRow {
  patientName: string;
  dateOfService: string;
  insuranceName: string;
  claimNumber: string | null;
  cptCode: string | null;
  visitId: string | null;
  visitStatus: string | null;
  provider: string | null;
  billedAmount: string | null;
  insurancePaid: string | null;
  patientPaid: string | null;
  balance: string;
  agingDays: number;
  statusCategory: StatusCategory;
  statusLabel: string;
  assignedToName: string | null;
  followUpDate: string | null;
  lastWorkedAt: string | null;
  lastWorkedByName: string | null;
  lastNote: string | null;
}

const CATEGORY_WORD: Record<StatusCategory, string> = {
  RED: "Red",
  BLUE: "Blue",
  GREEN: "Green",
};

function exportRow(row: ExportRow) {
  return [
    row.patientName,
    // Dates of service and follow-ups are calendar dates at UTC midnight, so
    // they format in UTC; the last-worked stamp is a moment, so it is IST.
    formatDate(row.dateOfService),
    row.insuranceName,
    row.claimNumber ?? "",
    row.cptCode ?? "",
    row.visitId ?? "",
    row.visitStatus ?? "",
    row.provider ?? "",
    row.billedAmount ?? "",
    row.insurancePaid ?? "",
    row.patientPaid ?? "",
    row.balance,
    row.agingDays,
    CATEGORY_WORD[row.statusCategory],
    row.statusLabel,
    row.assignedToName ?? "",
    row.followUpDate ? formatDate(row.followUpDate) : "",
    row.lastWorkedAt ? formatDateIST(row.lastWorkedAt) : "",
    row.lastWorkedByName ?? "",
    row.lastNote ?? "",
  ];
}

/** Headings the status labels are listed under. */
const CATEGORY_GROUP: Record<StatusCategory, string> = {
  RED: "🔴 Red",
  BLUE: "🔵 Blue",
  GREEN: "🟢 Green",
};

interface Assignee {
  id: string;
  name: string;
  role: string;
}

/** Who handed a claim over, and what they said — only on the reassigned tab. */
interface Reassignment {
  reassignedByName: string;
  reassignedById: string;
  reassignedAt: string;
  note: string;
}

type PanelClaim = ClaimDto & {
  reassignment?: Reassignment | null;
  /** The status an open biller request asks for, if there is one. */
  pendingStatus?: string | null;
};

/** How long a row stays open after an update, so the new note can be read. */
const AUTO_COLLAPSE_MS = 3000;

/**
 * What every filter reads as when nothing is chosen. Declared once: the hook
 * infers each value's shape from its default, and "clear all" is a reset to
 * exactly this.
 */
const FILTER_DEFAULTS = {
  tab: "all",
  insurance: [] as string[],
  aging: [] as string[],
  provider: [] as string[],
  assignedTo: [] as string[],
  statusCategories: [] as string[],
  statusLabels: [] as string[],
  /** Brings the 0–30 day bucket back into a list that excludes it. */
  includeNotActionable: false,
  visitStatus: "",
  dosFrom: "",
  dosTo: "",
  search: "",
  /** Claims with a work note checked this way — Portal, IVR or Phone. */
  howChecked: "",
  /** A Smart Alert's own claim condition, set by "View affected claims". */
  alert: "",
  alertKey: "",
  sort: "aging",
  dir: "desc",
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
};

export function BatchClaimsPanel({
  batchId,
  canAssign,
  batchClosed,
  assignees,
  insuranceOptions,
  providerOptions,
  visitStatusOptions,
  initialTab = "all",
  showReassignedTab = false,
  reassignedCount = 0,
  notActionableCount = 0,
  canExport = false,
  exportFileName,
}: {
  batchId: string;
  canAssign: boolean;
  batchClosed: boolean;
  assignees: Assignee[];
  insuranceOptions: string[];
  /** Both provider fields, merged — the column shows whichever it has. */
  providerOptions: string[];
  /**
   * Distinct visit statuses in this batch. Empty for the batches whose EHR
   * does not export the field, and the filter is then not rendered at all —
   * an empty dropdown is a promise the data cannot keep.
   */
  visitStatusOptions: string[];
  /** Seeded from the URL, so a dashboard count lands on what it counted. */
  initialTab?: TabKey;
  /**
   * Claims a biller has handed back to this manager. Only managers have a
   * queue of their own to be handed to, so a biller gets no tab at all rather
   * than an empty one.
   */
  showReassignedTab?: boolean;
  reassignedCount?: number;
  /** How many claims the default exclusion is holding back, for the hint. */
  notActionableCount?: number;
  /**
   * Owner and PM only. A biller's list is already their own work, but a file
   * of patient names leaves the building, so the button is theirs alone — and
   * the route enforces the same rule rather than trusting this.
   */
  canExport?: boolean;
  /** "[practice]-[month-year]-claims-[today].csv", built by the page. */
  exportFileName?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  /**
   * Every filter lives in the query string, so opening a claim and pressing
   * back restores the list exactly as it was. `initialTab` still seeds the
   * tab for links that arrive with one — a dashboard count, say — but the URL
   * wins once the person starts filtering.
   */
  const [filters, setFilters, clearFilters] = useFilterState(
    { ...FILTER_DEFAULTS, tab: initialTab as string },
    { debounced: ["search"], pageKey: "page" },
  );

  const tab = filters.tab as TabKey;
  const sortKey = filters.sort as SortKey;
  const ascending = filters.dir === "asc";
  const page = filters.page;
  const pageSize = filters.limit;

  const [claims, setClaims] = useState<PanelClaim[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);
  /**
   * Off by default: a claim insurance has not had time to process is not work
   * to hand out. Ticking it is the PM saying they mean it.
   */
  const [assignNotActionable, setAssignNotActionable] = useState(false);
  /**
   * Optional columns, off by default. Most batches carry neither field, and a
   * column of dashes costs width the columns people actually read need.
   */
  const [showVisitId, setShowVisitId] = useLocalSetting(
    "ar.claims.showVisitId",
    false,
    isBoolean,
  );
  const [showVisitStatus, setShowVisitStatus] = useLocalSetting(
    "ar.claims.showVisitStatus",
    false,
    isBoolean,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [meta, setMeta] = useState<ClaimListMeta | null>(null);
  /**
   * The one open row. Local state, deliberately not in the URL: opening a row
   * is a glance, not a place, and a history entry per row would make back walk
   * through every claim somebody looked at.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bulkModal, setBulkModal] = useState<"update" | "followUp" | null>(
    null,
  );

  const [alerts, setAlerts] = useState<SmartAlert[] | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  const isListTab = LIST_TABS.includes(tab);
  /** Owners and PMs — the same people who may assign. */
  const isManager = canAssign;

  /**
   * Which status labels the category filter currently permits.
   *
   * Choosing "Red" and then leaving "Paid & Posted" ticked would be a filter
   * that matches nothing, so the labels outside the chosen categories are
   * greyed out — and, below, dropped from what is actually sent. They stay
   * visible rather than disappearing: an option that vanishes leaves somebody
   * hunting for it.
   */
  const allowedLabels = useMemo(() => {
    if (filters.statusCategories.length === 0) return null;

    return new Set<string>(
      ALL_STATUSES.filter((label) =>
        filters.statusCategories.includes(statusLabelToCategory(label)),
      ),
    );
  }, [filters.statusCategories]);

  /**
   * The labels actually applied — the selection narrowed to what the category
   * filter allows. Derived rather than written back into the URL, so widening
   * the categories again restores the labels the person had chosen instead of
   * having silently discarded them.
   */
  const visibleStatusLabels = useMemo(
    () =>
      allowedLabels === null
        ? filters.statusLabels
        : filters.statusLabels.filter((label) => allowedLabels.has(label)),
    [allowedLabels, filters.statusLabels],
  );

  const statusLabelOptions = useMemo(
    () =>
      ALL_STATUSES.map((label) => {
        const category = statusLabelToCategory(label);

        return {
          label,
          value: label,
          group: CATEGORY_GROUP[category],
          disabled: allowedLabels !== null && !allowedLabels.has(label),
        };
      }),
    [allowedLabels],
  );

  /**
   * Page size is remembered per browser, but a URL that names one wins: a
   * shared link should show the list the sender was looking at. The stored
   * preference is applied once, on arrival at a URL that is silent about it.
   */
  const [storedPageSize, setStoredPageSize] = useLocalSetting(
    "ar.claims.pageSize",
    DEFAULT_PAGE_SIZE,
    isPageSize,
  );

  const appliedStoredSize = useRef(false);

  useEffect(() => {
    if (appliedStoredSize.current) return;
    appliedStoredSize.current = true;

    const urlNamesSize = new URLSearchParams(window.location.search).has(
      "limit",
    );

    if (!urlNamesSize && storedPageSize !== DEFAULT_PAGE_SIZE) {
      setFilters({ limit: storedPageSize });
    }
  }, [storedPageSize, setFilters]);

  /**
   * The filter bar's params alone — no tab, page or sort. The claim list adds
   * those; the Analysis tab sends this as it is, so a pivot and the list it
   * drills into read the same filters the same way.
   */
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams();

    // Empty means "no filter", so the params are omitted entirely.
    if (filters.insurance.length > 0) {
      params.set("insuranceNames", filters.insurance.join(","));
    }
    if (filters.aging.length > 0) {
      params.set("agingBuckets", filters.aging.join(","));
    }
    if (filters.provider.length > 0) {
      params.set("providerNames", filters.provider.join(","));
    }

    /**
     * "Unassigned" travels as its own flag rather than a sentinel id: the API
     * has no user by that name, and a magic string in a list of ids is the
     * kind of thing that later gets looked up.
     */
    const people = filters.assignedTo.filter((id) => id !== UNASSIGNED);

    if (filters.assignedTo.includes(UNASSIGNED)) {
      params.set("includeUnassigned", "true");
    }
    if (people.length > 0) params.set("assignedToIds", people.join(","));

    if (filters.includeNotActionable) {
      params.set("includeNotActionable", "true");
    }
    if (filters.statusCategories.length > 0) {
      params.set("statusCategories", filters.statusCategories.join(","));
    }
    if (visibleStatusLabels.length > 0) {
      params.set("statusLabels", visibleStatusLabels.join(","));
    }
    if (filters.visitStatus) params.set("visitStatus", filters.visitStatus);
    if (filters.dosFrom) params.set("dosFrom", filters.dosFrom);
    if (filters.dosTo) params.set("dosTo", filters.dosTo);
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.howChecked) params.set("howChecked", filters.howChecked);
    if (filters.alert) params.set("alert", filters.alert);
    if (filters.alertKey) params.set("alertKey", filters.alertKey);

    return params.toString();
  }, [
    filters.howChecked,
    filters.alert,
    filters.alertKey,
    filters.insurance,
    filters.aging,
    filters.provider,
    filters.assignedTo,
    filters.includeNotActionable,
    filters.statusCategories,
    visibleStatusLabels,
    filters.visitStatus,
    filters.dosFrom,
    filters.dosTo,
    filters.search,
  ]);

  const query = useMemo(() => {
    const params = new URLSearchParams(filterQuery);
    params.set("batchId", batchId);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    if (tab === "unassigned") params.set("unassigned", "true");
    if (tab === "red") params.set("statusCategory", "RED");
    if (tab === "blue") params.set("statusCategory", "BLUE");
    if (tab === "overdue") params.set("overdue", "true");
    if (tab === "reassigned") params.set("reassignedToMe", "true");

    params.set("sort", sortKey);
    params.set("direction", ascending ? "asc" : "desc");

    return params.toString();
  }, [filterQuery, batchId, page, pageSize, tab, sortKey, ascending]);

  /**
   * `quiet` refreshes the rows without the skeleton. After an update the
   * open row has to stay on screen so the new note can be read — a full
   * reload would unmount the table, and the panel with it.
   */
  const load = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      // The report tabs have no claim table to fill.
      if (!LIST_TABS.includes(tab)) return;

      if (!options.quiet) setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/ar/claims?${query}`);
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          setError(payload?.error ?? "Could not load claims.");
          setClaims([]);
          return;
        }

        setClaims(payload.data);
        setTotal(payload.pagination.total);
        setMeta(payload.meta ?? null);
      } catch {
        setError("Could not load claims. Check your connection and retry.");
      } finally {
        setLoading(false);
      }
    },
    [query, tab],
  );

  useEffect(() => {
    load();
  }, [load]);

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);

    try {
      const response = await fetch(`/api/ar/batches/${batchId}/smart-alerts`);
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setAlertsError(payload?.error ?? "Could not load alerts.");
        return;
      }

      setAlerts(payload.data);
    } catch {
      setAlertsError("Could not load alerts. Check your connection.");
    } finally {
      setAlertsLoading(false);
    }
  }, [batchId]);

  // Loaded up front, so the tab badge can say whether anything is urgent.
  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // An approval, a bulk change or a quick update made anywhere on the page.
  useEffect(() => {
    const refresh = () => {
      load({ quiet: true });
      loadAlerts();
    };
    window.addEventListener(CLAIMS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CLAIMS_CHANGED_EVENT, refresh);
  }, [load, loadAlerts]);

  // One row open at most, and it closes when the rows under it change.
  useEffect(() => {
    setExpandedId(null);
  }, [query]);

  useEffect(() => {
    if (!expandedId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedId(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedId]);

  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    },
    [],
  );

  function toggleRow(claimId: string) {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setExpandedId((current) => (current === claimId ? null : claimId));
  }

  /** After an update the row stays open a moment, then closes itself. */
  function afterRowUpdate(claimId: string) {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);

    collapseTimer.current = setTimeout(() => {
      setExpandedId((current) => (current === claimId ? null : current));
      collapseTimer.current = null;
    }, AUTO_COLLAPSE_MS);
  }

  /**
   * A pivot cell, opened as a claim list. Each step of the path becomes the
   * filter that means the same thing; the rest of the filter bar stays as it
   * was, since the pivot was computed under it.
   *
   * The 0–30 checkbox and bucket are dropped: the pivot never counts those
   * claims, and leaving them in would list more rows than the figure clicked.
   */
  function drillDown(path: DrillDownStep[]) {
    const next: Partial<typeof filters> = {
      tab: "all",
      alert: "",
      alertKey: "",
      includeNotActionable: false,
      aging: filters.aging.filter((bucket) => bucket !== NOT_ACTIONABLE_BUCKET),
    };

    for (const step of path) {
      switch (step.dimension) {
        case "insurance":
          if (step.key) next.insurance = [step.key];
          break;
        case "statusLabel":
          if (step.key) next.statusLabels = [step.key];
          break;
        case "statusCategory":
          if (step.key) next.statusCategories = [step.key];
          break;
        case "provider":
          if (step.key) next.provider = [step.key];
          break;
        case "assignee":
          next.assignedTo = [step.key ?? UNASSIGNED];
          break;
        case "visitStatus":
          if (step.key) next.visitStatus = step.key;
          break;
      }
    }

    setFilters(next);
  }

  /**
   * An alert's claims, opened as a claim list. Alerts are computed over the
   * whole batch, so every other filter is cleared — otherwise the list would
   * show fewer claims than the alert counted.
   */
  function viewAlertClaims(alert: SmartAlert) {
    const filter = alert.claimFilter;

    setFilters({
      ...FILTER_DEFAULTS,
      sort: filters.sort,
      dir: filters.dir,
      limit: filters.limit,
      tab: "all",
      alert: filter.alert ?? "",
      alertKey: filter.alertKey ?? "",
      statusCategories: filter.statusCategories
        ? filter.statusCategories.split(",")
        : [],
      assignedTo: filter.assignedToIds ? filter.assignedToIds.split(",") : [],
    });
  }

  const highAlerts =
    alerts?.filter((alert) => alert.severity === "HIGH").length ?? 0;

  const activeAlertLabel =
    filters.alert && isAlertType(filters.alert)
      ? (alerts?.find(
          (alert) =>
            (alert.claimFilter.alert ?? "") === filters.alert &&
            (alert.claimFilter.alertKey ?? "") === filters.alertKey,
        )?.title ?? ALERT_TYPE_LABELS[filters.alert])
      : null;

  // A changed filter changes which rows exist, so a selection made against
  // the old set is no longer meaningful.
  useEffect(() => {
    setSelected(new Set());
  }, [query]);

  // The tab, the sort and the page are how you move through a list rather
  // than narrow it, so they do not light up "clear all filters".
  const filtersActive = hasActiveFilters(filters, FILTER_DEFAULTS, [
    "tab",
    "sort",
    "dir",
    "page",
    "limit",
  ]);

  /** Selected claims on this page — the only ones a modal can preview. */
  const selectedClaims = claims.filter((claim) => selected.has(claim.id));
  const canSelect = !batchClosed;

  const allOnPageSelected =
    claims.length > 0 && claims.every((claim) => selected.has(claim.id));

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) {
        claims.forEach((claim) => next.delete(claim.id));
      } else {
        claims.forEach((claim) => next.add(claim.id));
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkAssign() {
    if (selected.size === 0 || !assignTo) return;

    setAssigning(true);

    try {
      const response = await fetch("/api/ar/claims/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimIds: Array.from(selected),
          assignedToId: assignTo === "__unassign__" ? null : assignTo,
          includeNotActionable: assignNotActionable,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Assignment failed.", "error");
        return;
      }

      // The server drops 0–30 day claims unless asked otherwise, so the toast
      // says what actually happened rather than what was selected.
      toast(
        `${payload.updated} claim${payload.updated === 1 ? "" : "s"} assigned` +
          (payload.skipped > 0
            ? ` · ${payload.skipped} skipped as not yet actionable`
            : ""),
      );
      setSelected(new Set());
      setAssignTo("");
      await load();
      loadAlerts();
      router.refresh();
    } catch {
      toast("Assignment failed. Check your connection.", "error");
    } finally {
      setAssigning(false);
    }
  }

  /**
   * Route a handed-back claim to a biller.
   *
   * Selects just this claim and seeds the assign dropdown with whoever passed
   * it over, since sending it back to them is the common case — the manager
   * has answered the question they were stuck on. It is only a default: the
   * dropdown is right there to change.
   */
  function routeBack(claim: PanelClaim) {
    setSelected(new Set([claim.id]));
    setAssignTo(claim.reassignment?.reassignedById ?? "");
    // The assign controls live in the filter bar above the table.
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * Everything the filters currently match, as a file.
   *
   * Deliberately not "the rows on screen": a page of fifty is never what
   * somebody wants to work with in a spreadsheet. The same query string the
   * table was built from goes to the export route, minus the paging, so the
   * file is the table's contents by construction.
   */
  async function handleExport() {
    setExporting(true);

    try {
      const params = new URLSearchParams(query);
      params.delete("page");
      params.delete("pageSize");

      const response = await fetch(`/api/ar/claims/export?${params}`);
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Could not export these claims.", "error");
        return;
      }

      if (payload.total === 0) {
        toast("No claims match the current filters", "error");
        return;
      }

      // Above the cap the file would be a database dump rather than something
      // anyone opens, so the choice is theirs to make knowingly.
      if (
        payload.truncated &&
        !window.confirm(
          `This export contains ${payload.total} claims. Only the first ${payload.limit} will be exported. Continue?`,
        )
      ) {
        return;
      }

      downloadCsv(
        exportFileName ?? "ar-claims.csv",
        EXPORT_COLUMNS,
        payload.data.map(exportRow),
      );
    } catch {
      toast("Could not export these claims. Check your connection.", "error");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /** Every column the table is drawing, for the expanded row's colSpan. */
  const columnCount =
    (canSelect ? 1 : 0) +
    11 +
    (showVisitId ? 1 : 0) +
    (showVisitStatus ? 1 : 0);

  // A bigger page, or a filter that shortened the list, can leave the cursor
  // past the end of it.
  useEffect(() => {
    // Only once a response has landed. Before the first fetch `total` is 0,
    // so totalPages is 1 — clamping then would throw away the page number the
    // URL just restored, which is exactly what a back navigation depends on.
    if (loading) return;

    if (page > totalPages) setFilters({ page: totalPages });
  }, [loading, page, totalPages, setFilters]);

  const SortHeader = ({
    label,
    sortAs,
  }: {
    label: string;
    sortAs: SortKey;
  }) => (
    <button
      type="button"
      onClick={() =>
        setFilters(
          sortKey === sortAs
            ? { dir: ascending ? "desc" : "asc" }
            : // Aging reads newest-first; names and amounts read ascending.
              { sort: sortAs, dir: sortAs === "aging" ? "desc" : "asc" },
        )
      }
      className="inline-flex items-center gap-1 hover:text-slate-800"
    >
      {label}
      {sortKey === sortAs ? <span>{ascending ? "▲" : "▼"}</span> : null}
    </button>
  );

  return (
    <div>
      <div
        id="reassigned-to-me"
        className="mb-4 flex flex-wrap items-center gap-1 border-b border-slate-200"
      >
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setFilters({ tab: entry.key })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === entry.key
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {entry.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setFilters({ tab: "analysis" })}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "analysis"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Analysis
        </button>

        <button
          type="button"
          onClick={() => {
            setFilters({ tab: "alerts" });
            loadAlerts();
          }}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "alerts"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Smart Alerts
          {alerts && alerts.length > 0 ? (
            // Red when anything is high priority; otherwise just a count.
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                highAlerts > 0
                  ? "bg-red-600 text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {alerts.length}
            </span>
          ) : null}
        </button>

        {showReassignedTab ? (
          <button
            type="button"
            onClick={() => setFilters({ tab: "reassigned" })}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === "reassigned"
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Reassigned to Me
            {/* Amber, because this is somebody waiting on the manager. */}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                reassignedCount > 0
                  ? "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {reassignedCount}
            </span>
          </button>
        ) : null}
      </div>

      {tab === "reassigned" ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-100">
          Claims a biller could not finish and handed to you — either a blue
          status, which escalates on its own, or one they reassigned
          deliberately. Work it yourself, or route it back with the assign
          dropdown.
        </p>
      ) : null}

      {tab === "alerts" ? (
        <SmartAlertsTab
          alerts={alerts}
          loading={alertsLoading}
          error={alertsError}
          onViewClaims={viewAlertClaims}
          onRefresh={loadAlerts}
        />
      ) : (
        <>
          {activeAlertLabel ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-100">
              <span>
                Showing the claims behind the alert{" "}
                <span className="font-semibold">{activeAlertLabel}</span>
              </span>
              <button
                type="button"
                onClick={() => setFilters({ alert: "", alertKey: "" })}
                className="font-medium underline hover:text-amber-700"
              >
                Clear alert filter
              </button>
            </div>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <MultiSelectDropdown
              options={insuranceOptions.map((name) => ({
                label: name,
                value: name,
              }))}
              selected={filters.insurance}
              onChange={(next) => setFilters({ insurance: next })}
              placeholder="All insurances"
              allLabel="All Insurances"
              noun="insurances"
              aria-label="Insurance"
              className="w-auto min-w-[200px]"
            />

            <MultiSelectDropdown
              options={AGING_BUCKETS.map((bucket) => ({
                label: bucket.label,
                value: bucket.key,
              }))}
              selected={filters.aging}
              onChange={(next) => setFilters({ aging: next })}
              placeholder="All ages"
              allLabel="All Ages"
              noun="buckets"
              aria-label="Aging"
              className="w-auto min-w-[180px]"
            />

            <MultiSelectDropdown
              options={providerOptions.map((name) => ({
                label: name,
                value: name,
              }))}
              selected={filters.provider}
              onChange={(next) => setFilters({ provider: next })}
              placeholder="All providers"
              allLabel="All Providers"
              noun="providers"
              aria-label="Provider"
              className="w-auto min-w-[200px]"
            />

            <MultiSelectDropdown
              options={CATEGORY_OPTIONS.map((option) => ({
                label: option.label,
                value: option.value,
                prefix: (
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${option.dot}`}
                  />
                ),
              }))}
              selected={filters.statusCategories}
              onChange={(next) => setFilters({ statusCategories: next })}
              placeholder="All categories"
              allLabel="All Categories"
              noun="categories"
              aria-label="Status category"
              className="w-auto min-w-[210px]"
            />

            <MultiSelectDropdown
              options={statusLabelOptions}
              selected={visibleStatusLabels}
              onChange={(next) => setFilters({ statusLabels: next })}
              placeholder="All statuses"
              allLabel="All Statuses"
              noun="statuses"
              aria-label="Status label"
              className="w-auto min-w-[200px]"
            />

            {/*
          "Unassigned" sits at the top of the same list as the people, because
          "who is this with?" is one question and nobody is a valid answer to
          it. Only rendered where an assignee list exists — a biller sees only
          their own claims, so the filter would have one option.
        */}
            {canAssign ? (
              <MultiSelectDropdown
                options={[
                  { label: "— Unassigned —", value: UNASSIGNED },
                  ...assignees.map((user) => ({
                    label: user.name,
                    value: user.id,
                  })),
                ]}
                selected={filters.assignedTo}
                onChange={(next) => setFilters({ assignedTo: next })}
                placeholder="Anyone"
                allLabel="Assigned To: anyone"
                noun="people"
                aria-label="Assigned to"
                className="w-auto min-w-[190px]"
              />
            ) : null}

            {/*
          The list excludes 0–30 day claims by default: it is a work queue
          first, and a freshly uploaded batch is mostly claims nobody may act
          on yet. Selecting the 0–30 aging bucket above is the other way to
          see them — asking for that bucket already says you want it.
        */}
            <label
              className={`${isListTab ? "flex" : "hidden"} items-center gap-1.5 text-xs text-slate-600`}
              title={`Claims aged ${NOT_ACTIONABLE_MAX_DAYS} days or less are hidden by default — insurance has not had time to process them.`}
            >
              <input
                type="checkbox"
                checked={filters.includeNotActionable}
                onChange={(event) =>
                  setFilters({ includeNotActionable: event.target.checked })
                }
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              Include 0–{NOT_ACTIONABLE_MAX_DAYS} day claims
              {notActionableCount > 0 && !filters.includeNotActionable ? (
                <span className="text-slate-400">
                  ({notActionableCount} hidden)
                </span>
              ) : null}
            </label>

            <div className="flex items-center gap-1.5">
              <label htmlFor="dosFrom" className="text-xs text-slate-500">
                DOS
              </label>
              <Input
                id="dosFrom"
                type="date"
                value={filters.dosFrom}
                max={filters.dosTo || undefined}
                onChange={(event) =>
                  setFilters({ dosFrom: event.target.value })
                }
                className="w-auto"
                aria-label="Date of service from"
              />
              <span className="text-xs text-slate-400">to</span>
              <Input
                id="dosTo"
                type="date"
                value={filters.dosTo}
                min={filters.dosFrom || undefined}
                onChange={(event) => setFilters({ dosTo: event.target.value })}
                className="w-auto"
                aria-label="Date of service to"
              />
            </div>

            {/*
          Only rendered when this batch actually carries visit statuses. Most
          EHR exports do not include the field, and a dropdown with nothing in
          it is worse than no dropdown.
        */}
            {visitStatusOptions.length > 0 ? (
              <Select
                value={filters.visitStatus}
                onChange={(event) =>
                  setFilters({ visitStatus: event.target.value })
                }
                aria-label="Visit status"
                className="w-auto min-w-[160px]"
              >
                <option value="">All visit statuses</option>
                {visitStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            ) : null}

            {/*
          How the claim was checked lives on its work notes, so this matches
          claims with at least one note checked that way.
        */}
            <Select
              value={filters.howChecked}
              onChange={(event) =>
                setFilters({ howChecked: event.target.value })
              }
              aria-label="How checked"
              className="w-auto min-w-[150px]"
            >
              <option value="">Checked: any way</option>
              {HOW_CHECKED_FILTERS.map((way) => (
                <option key={way} value={way}>
                  Checked via {way}
                </option>
              ))}
            </Select>

            <Input
              type="search"
              value={filters.search}
              onChange={(event) => setFilters({ search: event.target.value })}
              placeholder="Search patient name, CPT or Visit ID..."
              aria-label="Search patient name, CPT or Visit ID"
              className="w-auto min-w-[220px]"
            />

            {filtersActive ? (
              <Button
                variant="secondary"
                className="px-3 py-2 text-xs"
                onClick={clearFilters}
              >
                Clear all filters
              </Button>
            ) : null}

            {/*
          Owner and PM only. The route refuses a biller regardless — this
          just keeps a control they cannot use off their screen.
        */}
            {canExport && isListTab ? (
              <Button
                variant="secondary"
                className="px-3 py-2 text-xs"
                onClick={handleExport}
                disabled={exporting || loading}
              >
                {exporting ? "Exporting…" : "Export"}
              </Button>
            ) : null}

            <div className={isListTab ? "relative" : "hidden"}>
              <Button
                variant="secondary"
                className="px-3 py-2 text-xs"
                onClick={() => setColumnsOpen((open) => !open)}
                aria-expanded={columnsOpen}
                aria-haspopup="true"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
                Columns
              </Button>

              {columnsOpen ? (
                <div className="absolute right-0 z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Optional columns
                  </p>
                  <label className="flex items-center gap-2 rounded px-1 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={showVisitId}
                      onChange={(event) => setShowVisitId(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Visit ID
                  </label>
                  <label className="flex items-center gap-2 rounded px-1 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={showVisitStatus}
                      onChange={(event) =>
                        setShowVisitStatus(event.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Visit Status
                  </label>
                </div>
              ) : null}
            </div>

            {canAssign && !batchClosed && isListTab ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {selected.size} selected
                </span>
                <label
                  className="flex items-center gap-1.5 text-xs text-slate-600"
                  title={`0–${NOT_ACTIONABLE_MAX_DAYS} day claims are skipped unless this is ticked — insurance has not had time to process them.`}
                >
                  <input
                    type="checkbox"
                    checked={assignNotActionable}
                    onChange={(event) =>
                      setAssignNotActionable(event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  />
                  Include 0–{NOT_ACTIONABLE_MAX_DAYS} day claims
                </label>
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
                  onClick={handleBulkAssign}
                  disabled={selected.size === 0 || !assignTo || assigning}
                  className="px-3 py-2 text-xs"
                >
                  {assigning ? "Assigning…" : "Apply"}
                </Button>

                {/*
              Capacity planning lives in the planner, not here. A pointer keeps
              the question answerable without putting a second screen's worth
              of numbers beside a dropdown.
            */}
                <Link
                  href="/analytics/workload"
                  className="whitespace-nowrap text-xs font-medium text-brand-700 hover:text-brand-800"
                >
                  Check biller availability → Workload Planner
                </Link>
              </div>
            ) : null}
          </div>

          {tab === "analysis" ? (
            <BatchAnalysisTab
              batchId={batchId}
              filterQuery={filterQuery}
              onDrillDown={drillDown}
            />
          ) : (
            <>
              <BatchSummaryBar
                meta={meta}
                filtered={filtersActive || tab !== "all"}
                loading={loading}
              />

              {/*
        Two or more, because one claim is better updated from its own row.
        Offered to billers too: their status change becomes a request, and
        the follow-up route keeps them to their own claims.
      */}
              {canSelect && selected.size >= 2 ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm">
                  <span className="font-medium text-brand-900">
                    {selected.size} selected
                  </span>
                  <Button
                    className="px-3 py-1.5 text-xs"
                    onClick={() => setBulkModal("update")}
                  >
                    Update Selected ({selected.size})
                  </Button>
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => setBulkModal("followUp")}
                  >
                    Set Follow-up Date
                  </Button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    Clear selection
                  </button>
                </div>
              ) : null}

              {bulkModal === "update" && selectedClaims.length > 0 ? (
                <BulkUpdateModal
                  claims={selectedClaims}
                  isManager={isManager}
                  onClose={() => setBulkModal(null)}
                  onDone={() => {
                    setBulkModal(null);
                    setSelected(new Set());
                  }}
                />
              ) : null}

              {bulkModal === "followUp" && selectedClaims.length > 0 ? (
                <BulkFollowUpModal
                  claims={selectedClaims}
                  onClose={() => setBulkModal(null)}
                  onDone={() => {
                    setBulkModal(null);
                    setSelected(new Set());
                  }}
                />
              ) : null}

              {loading ? (
                <TableSkeleton rows={8} columns={8} />
              ) : error ? (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-100">
                  {error}
                  <button
                    type="button"
                    onClick={() => load()}
                    className="ml-2 font-medium underline"
                  >
                    Retry
                  </button>
                </div>
              ) : claims.length === 0 ? (
                <EmptyState
                  title={
                    tab === "unassigned"
                      ? "Every claim is assigned"
                      : tab === "blue"
                        ? "No blue claims"
                        : tab === "overdue"
                          ? "No overdue follow-ups"
                          : "No claims match these filters"
                  }
                  description={
                    tab === "all"
                      ? "Adjust the insurance or aging filter to see more."
                      : undefined
                  }
                />
              ) : (
                <>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
                    <table className="w-full min-w-[1000px] text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        <tr>
                          {canSelect ? (
                            <th className="w-10 px-4 py-3">
                              <input
                                type="checkbox"
                                checked={allOnPageSelected}
                                onChange={toggleAll}
                                aria-label="Select all on this page"
                                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                              />
                            </th>
                          ) : null}
                          <th className="px-4 py-3">
                            <SortHeader label="Patient" sortAs="patientName" />
                          </th>
                          <th className="px-4 py-3">Insurance</th>
                          <th className="px-4 py-3">
                            <SortHeader label="Provider" sortAs="provider" />
                          </th>
                          <th className="px-4 py-3">DOS</th>
                          <th className="px-4 py-3">CPT</th>
                          {showVisitId ? (
                            <th className="px-4 py-3">Visit ID</th>
                          ) : null}
                          {showVisitStatus ? (
                            <th className="px-4 py-3">Visit Status</th>
                          ) : null}
                          <th className="px-4 py-3 text-right">
                            <SortHeader label="Balance" sortAs="balance" />
                          </th>
                          <th className="px-4 py-3 text-right">
                            <SortHeader label="Aging" sortAs="aging" />
                          </th>
                          <th className="px-4 py-3">
                            <SortHeader label="Status" sortAs="status" />
                          </th>
                          <th className="px-4 py-3">Assigned to</th>
                          <th className="px-4 py-3">Follow-up</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {claims.map((claim) => {
                          const overdue =
                            claim.followUpDate !== null &&
                            new Date(claim.followUpDate) < new Date() &&
                            claim.statusCategory === "RED";

                          const expanded = expandedId === claim.id;

                          return (
                            <Fragment key={claim.id}>
                              <tr
                                onClick={(event) => {
                                  // Links, buttons and checkboxes keep their own jobs.
                                  if (
                                    (event.target as HTMLElement).closest(
                                      "a, button, input, select, textarea, label",
                                    )
                                  ) {
                                    return;
                                  }
                                  toggleRow(claim.id);
                                }}
                                aria-expanded={expanded}
                                className={`cursor-pointer ${
                                  expanded
                                    ? "bg-brand-50/50"
                                    : "hover:bg-slate-50"
                                }`}
                              >
                                {canSelect ? (
                                  <td className="px-4 py-3">
                                    <input
                                      type="checkbox"
                                      checked={selected.has(claim.id)}
                                      onChange={() => toggleOne(claim.id)}
                                      aria-label={`Select ${claim.patientName}`}
                                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                                    />
                                  </td>
                                ) : null}
                                <td className="px-4 py-3">
                                  <Link
                                    href={`/ar/claims/${claim.id}`}
                                    className="font-medium text-slate-900 hover:text-brand-700"
                                  >
                                    {claim.patientName}
                                  </Link>
                                  {/*
                          On the reassigned tab, who passed it over and what
                          they said. The note is the context that saves the
                          manager opening the claim to find out why.
                        */}
                                  {claim.reassignment ? (
                                    <span className="mt-0.5 block text-xs text-amber-700">
                                      ↩ Reassigned by{" "}
                                      {claim.reassignment.reassignedByName}
                                      <span
                                        className="block text-slate-500"
                                        title={claim.reassignment.note}
                                      >
                                        {claim.reassignment.note.length > 90
                                          ? `${claim.reassignment.note.slice(0, 90)}…`
                                          : claim.reassignment.note}
                                      </span>
                                    </span>
                                  ) : tab === "reassigned" &&
                                    claim.statusCategory === "BLUE" ? (
                                    <span className="mt-0.5 block text-xs text-sky-700">
                                      Escalated by blue status
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {claim.insuranceName}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {/* renderingProvider is the specific name; providerName
                            is what the import carried. */}
                                  {claim.renderingProvider ??
                                    claim.providerName ?? (
                                      <span className="text-slate-400">—</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {formatDate(claim.dateOfService)}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {claim.cptCode ?? "—"}
                                </td>
                                {showVisitId ? (
                                  <td className="px-4 py-3 text-slate-600">
                                    {claim.visitId ?? (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                ) : null}
                                {showVisitStatus ? (
                                  <td className="px-4 py-3 text-slate-600">
                                    {claim.visitStatus ?? (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                ) : null}
                                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                                  {formatUSD(claim.balance)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <AgingBadge
                                    days={claim.agingDays}
                                    withLabel
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center gap-1">
                                    <StatusBadge
                                      label={claim.statusLabel}
                                      category={claim.statusCategory}
                                    />
                                    {claim.pendingStatus ? (
                                      <span
                                        title={`Status change to ${claim.pendingStatus} pending PM approval`}
                                        aria-label={`Status change to ${claim.pendingStatus} pending PM approval`}
                                        className="cursor-help text-sm"
                                      >
                                        ⏳
                                      </span>
                                    ) : null}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {claim.assignedToName ?? (
                                    <Badge variant="amber">Unassigned</Badge>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {claim.followUpDate ? (
                                    <span
                                      className={
                                        overdue
                                          ? "font-medium text-red-600"
                                          : "text-slate-600"
                                      }
                                    >
                                      {formatDate(claim.followUpDate)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {tab === "reassigned" ? (
                                    <div className="flex items-center justify-end gap-2">
                                      <Link
                                        href={`/ar/claims/${claim.id}`}
                                        className="text-xs font-medium text-brand-700 hover:text-brand-800"
                                      >
                                        Work it
                                      </Link>
                                      {canAssign && !batchClosed ? (
                                        <button
                                          type="button"
                                          onClick={() => routeBack(claim)}
                                          className="text-xs font-medium text-slate-500 hover:text-slate-800"
                                        >
                                          Reassign
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <Link
                                      href={`/ar/claims/${claim.id}`}
                                      className="text-xs font-medium text-brand-700 hover:text-brand-800"
                                    >
                                      View
                                    </Link>
                                  )}
                                </td>
                              </tr>
                              {expanded ? (
                                <tr className="bg-slate-50/70">
                                  <td
                                    colSpan={columnCount}
                                    className="px-4 py-4"
                                  >
                                    <ClaimQuickPanel
                                      claim={claim}
                                      isManager={isManager}
                                      batchClosed={batchClosed}
                                      onSubmitted={() =>
                                        afterRowUpdate(claim.id)
                                      }
                                    />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    totalItems={total}
                    pageSize={pageSize}
                    onPageChange={(next) => setFilters({ page: next })}
                    onPageSizeChange={(size) => {
                      // Remembered for the next visit, and carried in this URL so a
                      // shared link opens the same view.
                      setStoredPageSize(size);
                      setFilters({ limit: size, page: 1 });
                    }}
                    noun="claims"
                    filtered={filtersActive}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
