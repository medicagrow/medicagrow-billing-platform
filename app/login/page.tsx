import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { LogoMark } from "@/components/ui/Logo";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await getSession();

  if (session?.user) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <LogoMark className="h-11 w-11" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
            Medica<span className="text-brand-600">Grow</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Billing Operations Platform
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          {/* LoginForm reads ?callbackUrl via useSearchParams. */}
          <Suspense fallback={<div className="h-[268px]" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Internal use only. Contact your administrator for access.
        </p>
      </div>
    </div>
  );
}
