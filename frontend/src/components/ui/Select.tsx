import type { ReactNode, SelectHTMLAttributes } from "react";

export default function Select({
  label,
  children,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
}) {
  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </label>
      )}
      <select
        className={`w-full appearance-none rounded-lg border border-border bg-zinc-950/80 bg-[length:16px] bg-[right_12px_center] bg-no-repeat px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 ${className}`}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m19 9-7 7-7-7'/%3E%3C/svg%3E")`,
        }}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
