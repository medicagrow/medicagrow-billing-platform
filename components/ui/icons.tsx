import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icon>
  );
}

export function ArFollowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h3" />
      <path d="M9 17h6" />
    </Icon>
  );
}

export function EligibilityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l7 3v5.5c0 4.3-2.9 8.3-7 9.5-4.1-1.2-7-5.2-7-9.5V6z" />
      <path d="M9.25 12l1.9 1.9 3.6-3.8" />
    </Icon>
  );
}

export function TodoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 6.5l1.6 1.6 2.6-2.8" />
      <path d="M3.5 12.5l1.6 1.6 2.6-2.8" />
      <path d="M3.5 18.5l1.6 1.6 2.6-2.8" />
      <path d="M12 6.5h8.5" />
      <path d="M12 12.5h8.5" />
      <path d="M12 18.5h8.5" />
    </Icon>
  );
}

export function EraPostingIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-1.8-2 1.4-2-1.4-2 1.4-2-1.4z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.6.81 1.01 1.46 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
    </Icon>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 17l5-5-5-5" />
      <path d="M20 12H9" />
      <path d="M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
    </Icon>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Icon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.6 6.7a9.8 9.8 0 0 1 1.4-.1c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.6" />
      <path d="M6.3 7.9A17 17 0 0 0 2.5 13S6 19.5 12 19.5a9.6 9.6 0 0 0 4-.8" />
      <path d="M10.1 10.4a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </Icon>
  );
}

export function TrackerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
      <circle cx="11" cy="10" r="1" />
      <circle cx="14" cy="13" r="1" />
    </Icon>
  );
}

export function ProductivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </Icon>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h1.5A1.5 1.5 0 0 1 19 6.5v13A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-13A1.5 1.5 0 0 1 6.5 5H8" />
    </Icon>
  );
}

export function TasksIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7.5l2 2 3.5-4" />
      <path d="M4 17.5l2 2 3.5-4" />
      <path d="M13 8h7" />
      <path d="M13 18h7" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Icon>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 6.5l3 3" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </Icon>
  );
}
