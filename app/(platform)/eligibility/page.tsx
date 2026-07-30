import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, EmptyState } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Eligibility" };

export default function EligibilityPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Eligibility"
        description="Verify patient coverage and benefits before the visit."
        action={<Badge variant="sky">Coming Soon</Badge>}
      />
      <Card>
        <CardBody>
          <EmptyState
            title="Not available yet"
            description="This module is planned for a future release."
          />
        </CardBody>
      </Card>
    </div>
  );
}
