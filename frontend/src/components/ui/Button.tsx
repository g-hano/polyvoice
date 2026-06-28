import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-500 text-white shadow-sm shadow-indigo-500/25 hover:bg-indigo-400 active:bg-indigo-600 disabled:opacity-40",
  secondary:
    "border border-border bg-[var(--panel-raised)] text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 disabled:opacity-40",
  outline:
    "border border-zinc-700 bg-transparent text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800/50 disabled:opacity-40",
  ghost:
    "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 disabled:opacity-40",
  danger:
    "border border-red-900/60 bg-red-950/80 text-red-200 hover:bg-red-900/40 disabled:opacity-40",
  success:
    "bg-emerald-600 text-white shadow-sm shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-40",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-4 text-sm",
  lg: "h-11 gap-2.5 px-6 text-sm font-semibold",
};

export default function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      {children}
    </button>
  );
}
