import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import {
  PracticeProvider,
  type PracticeChoice,
} from "@/lib/contexts/PracticeContext";
import type { Role } from "@/lib/generated/prisma/enums";

export function AppShell({
  name,
  role,
  practices,
  children,
}: {
  name: string;
  role: Role;
  practices: PracticeChoice[];
  children: ReactNode;
}) {
  return (
    <PracticeProvider practices={practices}>
      <div className="min-h-screen bg-slate-50">
        <Sidebar role={role} />
        {/* Offset matches the sidebar width at each breakpoint. */}
        <div className="pl-16 lg:pl-64">
          <Topbar name={name} role={role} />
          <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </PracticeProvider>
  );
}
