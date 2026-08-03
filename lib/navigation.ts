import type { ComponentType, SVGProps } from "react";
import type { BadgeVariant } from "@/components/ui/Badge";
import { Role } from "@/lib/generated/prisma/enums";
import {
  ArFollowUpIcon,
  DashboardIcon,
  EligibilityIcon,
  EraPostingIcon,
  ProductivityIcon,
  TrackerIcon,
  SettingsIcon,
  TasksIcon,
  TodoIcon,
} from "@/components/ui/icons";

export type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Module summary shown on the dashboard cards. */
  description: string;
  comingSoon?: boolean;
  /** Accent used for the module card on the dashboard. */
  accent: BadgeVariant;
  /** When set, only these roles see the entry. */
  roles?: Role[];
};

export const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: DashboardIcon,
    description: "Platform overview across every module.",
    accent: "neutral",
  },
  {
    label: "AR Follow-Up",
    href: "/ar",
    icon: ArFollowUpIcon,
    description: "Work aged claims, track denials and follow-up outcomes.",
    accent: "brand",
  },
  {
    label: "EOB/ERA",
    href: "/eob",
    icon: EraPostingIcon,
    description: "Work denials and rejections from posted remittances.",
    accent: "violet",
  },
  {
    label: "Tracker",
    href: "/tracker",
    icon: TrackerIcon,
    description: "Monthly practice health scoring.",
    accent: "amber",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Tasks",
    href: "/tasks",
    icon: TasksIcon,
    description: "Assigned work for everyone, tracked to completion.",
    accent: "brand",
  },
  {
    // To Dos are personal planning for the people who run the operation;
    // Tasks are assignable work for everyone. Different audiences, so the
    // two stay separate rather than sharing one list.
    label: "To Do",
    href: "/todos",
    icon: TodoIcon,
    description: "Plan your day against your scheduled work blocks.",
    accent: "sky",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Eligibility",
    href: "/eligibility",
    icon: EligibilityIcon,
    description: "Verify patient coverage and benefits before the visit.",
    comingSoon: true,
    accent: "sky",
  },
  {
    label: "Productivity",
    href: "/productivity",
    icon: ProductivityIcon,
    description: "Work output per team member across every module.",
    accent: "sky",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Settings",
    href: "/settings",
    icon: SettingsIcon,
    description: "Users, practices and platform configuration.",
    accent: "neutral",
  },
];

/** The four operational modules, i.e. nav minus Dashboard, Productivity and Settings. */
export const moduleItems = navItems.filter(
  (item) =>
    item.href !== "/" &&
    item.href !== "/settings" &&
    item.href !== "/productivity",
);

/** Top-level nav filtered to what this role may see. */
export function navItemsFor(role: Role): NavItem[] {
  return navItems.filter((item) => !item.roles || item.roles.includes(role));
}

/** Sub-navigation, filtered by role (Billers get the AR queue only). */
export interface SubNavItem {
  label: string;
  href: string;
  roles: Role[];
}

export const arSubNav: SubNavItem[] = [
  {
    label: "My Queue",
    href: "/ar/my-queue",
    roles: [Role.OWNER, Role.PROJECT_MANAGER, Role.BILLER],
  },
  {
    label: "Practices",
    href: "/ar",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Dashboard",
    href: "/ar/dashboard",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Denial Reasons",
    href: "/ar/denial-reasons",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
];

export const settingsSubNav: SubNavItem[] = [
  {
    label: "Practices",
    href: "/settings/practices",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Users",
    href: "/settings/users",
    roles: [Role.OWNER],
  },
  {
    label: "Task Types",
    href: "/settings/task-types",
    roles: [Role.OWNER],
  },
];

export const eobSubNav: SubNavItem[] = [
  {
    label: "EOB Overview",
    href: "/eob",
    roles: [Role.OWNER, Role.PROJECT_MANAGER, Role.BILLER],
  },
  {
    label: "My Queue",
    href: "/eob/my-queue",
    roles: [Role.OWNER, Role.PROJECT_MANAGER, Role.BILLER],
  },
];

export const trackerSubNav: SubNavItem[] = [
  {
    label: "Practices",
    href: "/tracker",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Settings",
    href: "/tracker/settings",
    roles: [Role.OWNER],
  },
];

export const todoSubNav: SubNavItem[] = [
  {
    label: "My Day",
    href: "/todos",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "List View",
    href: "/todos/list",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Team",
    href: "/todos/team",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
];

export const taskSubNav: SubNavItem[] = [
  {
    label: "My Tasks",
    href: "/tasks",
    roles: [Role.OWNER, Role.PROJECT_MANAGER, Role.BILLER],
  },
  {
    label: "Team",
    href: "/tasks/team",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "All Tasks",
    href: "/tasks/list",
    roles: [Role.OWNER, Role.PROJECT_MANAGER, Role.BILLER],
  },
];

export const productivitySubNav: SubNavItem[] = [
  {
    label: "Team",
    href: "/productivity",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
  {
    label: "Time Logs",
    href: "/productivity/time-logs",
    roles: [Role.OWNER, Role.PROJECT_MANAGER],
  },
];

/** Sub-navigation keyed by the parent nav item's href. */
const SUB_NAV_BY_PARENT: Record<string, SubNavItem[]> = {
  "/ar": arSubNav,
  "/eob": eobSubNav,
  "/tracker": trackerSubNav,
  "/tasks": taskSubNav,
  "/todos": todoSubNav,
  "/productivity": productivitySubNav,
  "/settings": settingsSubNav,
};

export function subNavFor(parentHref: string, role: Role): SubNavItem[] {
  return (SUB_NAV_BY_PARENT[parentHref] ?? []).filter((item) =>
    item.roles.includes(role),
  );
}

export function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
