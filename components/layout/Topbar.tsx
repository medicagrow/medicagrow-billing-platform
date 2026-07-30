"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { PracticeSelector } from "@/components/layout/PracticeSelector";
import { Badge } from "@/components/ui/Badge";
import { SignOutIcon } from "@/components/ui/icons";
import { clearStoredPractice } from "@/lib/contexts/PracticeContext";
import type { Role } from "@/lib/generated/prisma/enums";
import { isActivePath, navItemsFor } from "@/lib/navigation";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function Topbar({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname();
  const current = navItemsFor(role).find((item) =>
    isActivePath(pathname, item.href),
  );

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <h1 className="truncate text-sm font-semibold text-slate-900 sm:text-base">
          {current?.label ?? "MedicaGrow"}
        </h1>
        <Suspense fallback={null}>
          <PracticeSelector />
        </Suspense>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight text-slate-900">
            {name}
          </p>
          <Badge variant={roleBadgeVariants[role]} className="mt-0.5">
            {roleLabels[role]}
          </Badge>
        </div>

        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white"
          aria-hidden="true"
        >
          {initialsOf(name)}
        </span>

        <button
          type="button"
          onClick={() => {
            // Don't leave one user's practice filter for the next.
            clearStoredPractice();
            signOut({ callbackUrl: "/login" });
          }}
          title="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
        >
          <SignOutIcon className="h-[18px] w-[18px]" />
          <span className="sr-only">Sign out</span>
        </button>
      </div>
    </header>
  );
}
