import type { SubtitleFontSettings } from "../hooks/useSubtitleFontSettings";

export default function SubtitleSettingsPanel({
  settings,
  onSourceChange,
  onTargetChange,
  onReset,
  sourceLabel = "Spoken language",
  targetLabel = "Translation",
  embedded = false,
}: {
  settings: SubtitleFontSettings;
  onSourceChange: (px: number) => void;
  onTargetChange: (px: number) => void;
  onReset: () => void;
  sourceLabel?: string;
  targetLabel?: string;
  /** When true, omit outer card chrome (used inside Advanced settings). */
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "" : "rounded-xl border border-white/10 bg-panel/60 p-4"}>
      <div className={`flex items-center justify-between ${embedded ? "mb-3" : "mb-3"}`}>
        {!embedded && (
          <h3 className="text-sm font-semibold text-white/90">Subtitle appearance</h3>
        )}
        {embedded && (
          <p className="text-xs text-white/50">Adjust on-screen and transcript font sizes.</p>
        )}
        <button
          type="button"
          onClick={onReset}
          className="ml-auto text-xs text-white/40 transition hover:text-white/70"
        >
          Reset
        </button>
      </div>
      <div className="space-y-4">
        <FontSlider
          label={sourceLabel}
          value={settings.sourceFontSize}
          onChange={onSourceChange}
        />
        <FontSlider
          label={targetLabel}
          value={settings.targetFontSize}
          onChange={onTargetChange}
        />
      </div>
    </div>
  );
}

function FontSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (px: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-white/60">{label}</span>
        <span className="font-mono text-white/45">{value}px</span>
      </div>
      <input
        type="range"
        min={12}
        max={48}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="subtitle-font-slider w-full"
      />
      <p
        className="mt-2 truncate rounded bg-black/30 px-2 py-1 text-white/80"
        style={{ fontSize: value }}
        aria-hidden
      >
        Sample text — {label}
      </p>
    </label>
  );
}
