import type { ReactNode } from "react";

export default function FormSection({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="relative pl-10">
      <div className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-[var(--panel-raised)] text-xs font-semibold text-indigo-400">
        {step}
      </div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}
