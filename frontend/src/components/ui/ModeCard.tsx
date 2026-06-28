import type { ReactNode } from "react";

export default function ModeCard({
  selected,
  onClick,
  icon,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-1 flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all duration-200 ${
        selected
          ? "border-indigo-500/60 bg-indigo-500/10 ring-1 ring-indigo-500/30"
          : "border-border bg-[var(--panel-bg)] hover:border-zinc-600 hover:bg-[var(--panel-raised)]"
      }`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
          selected
            ? "bg-indigo-500/20 text-indigo-300"
            : "bg-zinc-800 text-zinc-400 group-hover:text-zinc-300"
        }`}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold text-zinc-100">{title}</span>
      <span className="text-xs leading-relaxed text-zinc-500">{description}</span>
      {selected && (
        <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-indigo-400" />
      )}
    </button>
  );
}
