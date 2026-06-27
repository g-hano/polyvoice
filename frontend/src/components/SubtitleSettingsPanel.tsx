import type { SubtitleStyleSettings, TrackStyle } from "../types";

const TIER_LABEL: Record<string, string> = {
  ready: "Transcription-ready",
  broad: "Broad-coverage",
  adaptation: "Adaptation-ready",
};

export default function SubtitleSettingsPanel({
  settings,
  fonts,
  onSourceChange,
  onTargetChange,
  onReset,
  sourceLabel = "Spoken language",
  targetLabel = "Translation",
  embedded = false,
}: {
  settings: SubtitleStyleSettings;
  fonts: string[];
  onSourceChange: (patch: Partial<TrackStyle>) => void;
  onTargetChange: (patch: Partial<TrackStyle>) => void;
  onReset: () => void;
  sourceLabel?: string;
  targetLabel?: string;
  embedded?: boolean;
}) {
  return (
    <div className={embedded ? "" : "rounded-xl border border-white/10 bg-panel/60 p-4"}>
      <div className="mb-3 flex items-center justify-between">
        {!embedded && (
          <h3 className="text-sm font-semibold text-white/90">Subtitle appearance</h3>
        )}
        {embedded && (
          <p className="text-xs text-white/50">
            Adjust on-screen preview and export styling. Export uses system fonts.
          </p>
        )}
        <button
          type="button"
          onClick={onReset}
          className="ml-auto text-xs text-white/40 transition hover:text-white/70"
        >
          Reset
        </button>
      </div>
      <div className="space-y-6">
        <TrackEditor
          label={sourceLabel}
          track={settings.source}
          fonts={fonts}
          onChange={onSourceChange}
        />
        <TrackEditor
          label={targetLabel}
          track={settings.target}
          fonts={fonts}
          onChange={onTargetChange}
        />
      </div>
    </div>
  );
}

function TrackEditor({
  label,
  track,
  fonts,
  onChange,
}: {
  label: string;
  track: TrackStyle;
  fonts: string[];
  onChange: (patch: Partial<TrackStyle>) => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-ink/40 p-3">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/45">{label}</p>
      <div className="space-y-3">
        <label className="block text-xs">
          <span className="text-white/55">Font</span>
          <select
            value={track.font_family}
            onChange={(e) => onChange({ font_family: e.target.value })}
            className="mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 outline-none focus:border-brand"
          >
            {fonts.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-white/55">Size</span>
            <span className="font-mono text-white/45">{track.font_size}px</span>
          </div>
          <input
            type="range"
            min={12}
            max={48}
            step={1}
            value={track.font_size}
            onChange={(e) => onChange({ font_size: Number(e.target.value) })}
            className="subtitle-font-slider w-full"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <ColorField label="Text color" value={track.color} onChange={(c) => onChange({ color: c })} />
          <ColorField
            label="Karaoke active"
            value={track.karaoke_active_color}
            onChange={(c) => onChange({ karaoke_active_color: c })}
          />
          <ColorField
            label="Karaoke done"
            value={track.karaoke_done_color}
            onChange={(c) => onChange({ karaoke_done_color: c })}
          />
          <label className="block text-xs">
            <span className="text-white/55">Background</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(track.background_opacity * 100)}
              onChange={(e) => onChange({ background_opacity: Number(e.target.value) / 100 })}
              className="subtitle-font-slider mt-1 w-full"
            />
          </label>
        </div>

        <div className="flex gap-4 text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-white/70">
            <input
              type="checkbox"
              checked={track.bold}
              onChange={(e) => onChange({ bold: e.target.checked })}
            />
            Bold
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-white/70">
            <input
              type="checkbox"
              checked={track.italic}
              onChange={(e) => onChange({ italic: e.target.checked })}
            />
            Italic
          </label>
        </div>

        <p
          className="truncate rounded px-2 py-1"
          style={{
            fontSize: track.font_size,
            fontFamily: track.font_family,
            color: track.color,
            fontWeight: track.bold ? 700 : 400,
            fontStyle: track.italic ? "italic" : "normal",
            backgroundColor: `rgba(0,0,0,${track.background_opacity})`,
          }}
          aria-hidden
        >
          Sample — {label}
        </p>
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label className="block text-xs">
      <span className="text-white/55">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-2 py-1 font-mono text-[11px] outline-none focus:border-brand"
        />
      </div>
    </label>
  );
}

export { TIER_LABEL };
