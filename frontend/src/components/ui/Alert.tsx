import type { ReactNode } from "react";

type AlertVariant = "info" | "warning" | "error";

const variantClasses: Record<AlertVariant, string> = {
  info: "border-l-indigo-500 bg-indigo-500/5 text-zinc-300",
  warning: "border-l-amber-500 bg-amber-500/5 text-zinc-300",
  error: "border-l-red-500 bg-red-500/5 text-zinc-300",
};

const iconMap: Record<AlertVariant, string> = {
  info: "ℹ",
  warning: "⚠",
  error: "✕",
};

export default function Alert({
  variant = "info",
  children,
  className = "",
}: {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-3 rounded-lg border border-border border-l-[3px] px-4 py-3 text-sm leading-relaxed ${variantClasses[variant]} ${className}`}
      role="alert"
    >
      <span className="mt-0.5 shrink-0 text-xs opacity-60">{iconMap[variant]}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
