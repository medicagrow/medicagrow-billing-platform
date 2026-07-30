"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import type { Role } from "@/lib/generated/prisma/enums";
import { isActivePath, navItemsFor, subNavFor } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex flex-col bg-sidebar",
        // Icons only on smaller screens, full labels from lg up.
        "w-16 lg:w-64",
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-3 lg:px-5">
        <LogoMark />
        <span className="hidden min-w-0 lg:block">
          <Wordmark className="block truncate text-white" />
          <span className="block truncate text-[11px] text-sidebar-muted">
            Billing Operations
          </span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4 lg:px-3">
        <p className="mb-2 hidden px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 lg:block">
          Modules
        </p>
        <ul className="space-y-1">
          {navItemsFor(role).map((item) => {
            const active = isActivePath(pathname, item.href);
            const IconComponent = item.icon;
            const subItems = subNavFor(item.href, role);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    "justify-center lg:justify-start",
                    active
                      ? "bg-sidebar-active text-white"
                      : "text-slate-400 hover:bg-sidebar-hover hover:text-slate-100",
                  )}
                >
                  <IconComponent
                    className={cn(
                      "h-5 w-5 shrink-0",
                      active
                        ? "text-brand-400"
                        : "text-slate-500 group-hover:text-slate-300",
                    )}
                  />
                  <span className="hidden min-w-0 flex-1 truncate lg:block">
                    {item.label}
                  </span>
                  {item.comingSoon ? (
                    <Badge variant="onDark" className="hidden lg:inline-flex">
                      Soon
                    </Badge>
                  ) : null}
                </Link>

                {subItems.length > 0 ? (
                  <ul className="mt-1 hidden space-y-0.5 border-l border-sidebar-border pl-3 lg:ml-5 lg:block">
                    {subItems.map((subItem) => {
                      const subActive = isActivePath(pathname, subItem.href);

                      return (
                        <li key={subItem.href}>
                          <Link
                            href={subItem.href}
                            className={cn(
                              "block rounded-md px-3 py-1.5 text-[13px] transition-colors",
                              subActive
                                ? "bg-sidebar-hover font-medium text-brand-300"
                                : "text-slate-500 hover:bg-sidebar-hover hover:text-slate-200",
                            )}
                          >
                            {subItem.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="hidden border-t border-sidebar-border px-5 py-3 lg:block">
        <p className="text-[11px] text-slate-500">MedicaGrow Platform v0.1</p>
      </div>
    </aside>
  );
}
