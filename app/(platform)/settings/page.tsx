import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/Card";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Settings"
        description="Users, practices and platform configuration."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your account" />
          <CardBody>
            <dl className="divide-y divide-slate-100 text-sm">
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-slate-500">Name</dt>
                <dd className="font-medium text-slate-900">{user.name}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2">
                <dt className="text-slate-500">Email</dt>
                <dd className="font-medium text-slate-900">{user.email}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2">
                <dt className="text-slate-500">Role</dt>
                <dd>
                  <Badge variant={roleBadgeVariants[user.role]}>
                    {roleLabels[user.role]}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Users & practices"
            description="Manage team members and practice assignments."
          />
          <CardBody>
            <EmptyState
              title="Management screens coming next"
              description="User creation and practice assignment are part of the next build step."
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
