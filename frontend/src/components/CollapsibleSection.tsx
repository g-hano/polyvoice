import type { ReactNode } from "react";

export default function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group rounded-xl border border-white/10 bg-ink/40 open:bg-panel/60"
      defaultOpen={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-white/90 marker:content-none [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span
          className="text-white/40 transition group-open:rotate-180"
          aria-hidden
        >
          ▾
        </span>
      </summary>
      <div className="space-y-4 border-t border-white/10 px-4 py-4">{children}</div>
    </details>
  );
}
