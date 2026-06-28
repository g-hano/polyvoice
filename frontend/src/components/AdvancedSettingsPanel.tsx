import { useEffect, useRef, useState } from "react";
import Input from "./ui/Input";
import Select from "./ui/Select";
import SegmentedControl from "./ui/SegmentedControl";
import { IconSettings } from "./ui/Icons";
import {
  CUSTOM_WHISPER_VALUE,
  TRANSLATION_BACKENDS,
  useJobForm,
} from "../hooks/useJobForm";
import type { AsrModelOption } from "../types";

export function AdvancedSettingsToolbar() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Advanced settings"
        className={`group relative flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          open
            ? "bg-indigo-500/20 text-indigo-300 ring-2 ring-indigo-500/40"
            : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
        }`}
      >
        <IconSettings className="h-4 w-4" />
      </button>

      <div
        role="tooltip"
        className="pointer-events-none absolute right-0 top-[calc(100%+6px)] z-50 whitespace-nowrap rounded-md border border-border bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
      >
        ASR, translation & quality
      </div>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] z-40 w-[min(360px,calc(100vw-2.5rem))] max-h-[min(70vh,560px)] overflow-y-auto rounded-xl border border-border bg-[var(--panel-bg)] p-4 shadow-xl">
          <AdvancedSettingsFields />
        </div>
      )}
    </div>
  );
}

function AdvancedSettingsFields() {
  const f = useJobForm();

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-400">ASR engine</p>
        <SegmentedControl
          value={f.asrEngine}
          onChange={f.setAsrEngine}
          options={[
            { value: "qwen" as const, label: "Qwen3" },
            { value: "whisper" as const, label: "Whisper" },
            { value: "nemotron" as const, label: "Nemotron" },
          ]}
        />
      </div>

      {f.asrEngine === "qwen" && (
        <div className="grid grid-cols-1 gap-4">
          <RepoSelect label="ASR model" value={f.asrModel} onChange={f.setAsrModel} options={f.asrModels} />
          <RepoSelect
            label="Forced aligner"
            value={f.forcedAlignerModel}
            onChange={f.setForcedAlignerModel}
            options={f.alignerModels}
          />
        </div>
      )}

      {f.asrEngine === "whisper" && (
        <div className="space-y-3">
          <Select
            label="Whisper model"
            value={f.whisperPreset}
            onChange={(e) => f.setWhisperPreset(e.target.value)}
          >
            {f.whisperModels.map((opt) => (
              <option key={opt.repo_id} value={opt.repo_id}>
                {opt.label}
              </option>
            ))}
            <option value={CUSTOM_WHISPER_VALUE}>Custom HF model…</option>
          </Select>
          {f.whisperPreset === CUSTOM_WHISPER_VALUE && (
            <Input
              value={f.whisperCustom}
              onChange={(e) => f.setWhisperCustom(e.target.value)}
              placeholder="e.g. openai/whisper-large-v3-turbo"
            />
          )}
        </div>
      )}

      {f.asrEngine === "nemotron" && (
        <div className="space-y-3">
          <RepoSelect
            label="Nemotron model"
            value={f.nemotronModel}
            onChange={f.setNemotronModel}
            options={f.nemotronModels}
          />
          {f.nemotronInfo?.tier === "adaptation" && (
            <p className="text-xs text-amber-500/80">
              This language is adaptation-ready in Nemotron — accuracy may be lower unless
              fine-tuned on in-domain data.
            </p>
          )}
        </div>
      )}

      <Select
        label="Translation engine"
        value={f.translatorBackend}
        onChange={(e) => f.setTranslatorBackend(e.target.value)}
      >
        {TRANSLATION_BACKENDS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </Select>

      {f.translatorBackend === "nllb" && (
        <RepoSelect label="NLLB model" value={f.nllbModel} onChange={f.setNllbModel} options={f.nllbModels} />
      )}

      {f.translatorBackend === "hunyuan" && (
        <RepoSelect
          label="Hunyuan model"
          value={f.hunyuanModel}
          onChange={f.setHunyuanModel}
          options={f.hunyuanModels}
        />
      )}

      <div>
        <p className="mb-1.5 text-sm font-medium text-zinc-400">Translation batch size</p>
        <Input
          type="number"
          min={1}
          max={128}
          value={f.translateBatchSize}
          onChange={(e) =>
            f.setTranslateBatchSize(Math.min(128, Math.max(1, Number(e.target.value) || 1)))
          }
        />
      </div>

      <div className="rounded-lg border border-border bg-zinc-950/80 p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={f.qcEnabled}
            onChange={(e) => f.setQcEnabled(e.target.checked)}
            className="h-4 w-4 rounded accent-indigo-500"
          />
          <span className="text-sm font-medium text-zinc-200">
            Quality control (back-translate + LM Studio fix)
          </span>
        </label>
        {f.qcEnabled && (
          <div className="mt-3 space-y-3">
            <Input
              value={f.lmstudioUrl}
              onChange={(e) => f.setLmstudioUrl(e.target.value)}
              placeholder="LM Studio URL"
            />
            <Input
              value={f.lmstudioModel}
              onChange={(e) => f.setLmstudioModel(e.target.value)}
              placeholder="Model name"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function RepoSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: AsrModelOption[];
}) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((opt) => (
        <option key={opt.repo_id} value={opt.repo_id}>
          {opt.label}
        </option>
      ))}
    </Select>
  );
}
