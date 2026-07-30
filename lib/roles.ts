import type { BadgeVariant } from "@/components/ui/Badge";
import type { Role } from "@/lib/generated/prisma/enums";

export const roleLabels: Record<Role, string> = {
  OWNER: "Owner",
  PROJECT_MANAGER: "Project Manager",
  BILLER: "Biller",
};

export const roleBadgeVariants: Record<Role, BadgeVariant> = {
  OWNER: "brand",
  PROJECT_MANAGER: "sky",
  BILLER: "neutral",
};
