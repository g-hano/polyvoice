import type { ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-zinc-800 text-zinc-400",
  success: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20",
  warning: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/20",
  error: "bg-red-500/15 text-red-400 ring-1 ring-red-500/20",
  info: "bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/20",
};

export default function Badge({
  variant = "default",
  children,
  className = "",
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
