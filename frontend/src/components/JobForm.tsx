import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { getAsrModels, getLanguages, getTranslationModels } from "../api";
import type { AsrEngine, AsrModelOption, JobFormSubmitParams } from "../types";
import CollapsibleSection from "./CollapsibleSection";

const CUSTOM_WHISPER = "__custom__";

const BACKENDS = [
  { id: "helsinki", label: "Helsinki opus-mt (fast, recommended)" },
  { id: "nllb", label: "NLLB-200 (multilingual)" },
  { id: "hunyuan", label: "Hunyuan (HY-MT1.5 / Hy-MT2)" },
  { id: "translategemma", label: "TranslateGemma 4B" },
];

export default function JobForm({
  onSubmit,
  busy,
}: {
  onSubmit: (params: JobFormSubmitParams) => void;
  busy: boolean;
}) {
  const [languages, setLanguages] = useState<Record<string, string>>({ sv: "Swedish", en: "English" });
  const [nemotronByIso, setNemotronByIso] = useState<
    Record<string, { locale: string; tier: string | null }>
  >({});
  const [mode, setMode] = useState<"url" | "file">("url");
  const [sourceUrl, setSourceUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState("sv");
  const [targetLang, setTargetLang] = useState("en");
  const [asrModels, setAsrModels] = useState<AsrModelOption[]>([
    { repo_id: "Qwen/Qwen3-ASR-1.7B", label: "Qwen3 ASR 1.7B" },
  ]);
  const [alignerModels, setAlignerModels] = useState<AsrModelOption[]>([
    { repo_id: "Qwen/Qwen3-ForcedAligner-0.6B", label: "Qwen3 Forced Aligner 0.6B" },
  ]);
  const [asrModel, setAsrModel] = useState("Qwen/Qwen3-ASR-1.7B");
  const [forcedAlignerModel, setForcedAlignerModel] = useState("Qwen/Qwen3-ForcedAligner-0.6B");
  const [asrEngine, setAsrEngine] = useState<AsrEngine>("qwen");
  const [whisperModels, setWhisperModels] = useState<AsrModelOption[]>([]);
  const [nemotronModels, setNemotronModels] = useState<AsrModelOption[]>([
    { repo_id: "nvidia/nemotron-3.5-asr-streaming-0.6b", label: "Nemotron 3.5 ASR 0.6B" },
  ]);
  const [nemotronModel, setNemotronModel] = useState("nvidia/nemotron-3.5-asr-streaming-0.6b");
  const [whisperPreset, setWhisperPreset] = useState("openai/whisper-large-v3");
  const [whisperCustom, setWhisperCustom] = useState("");
  const [translatorBackend, setTranslatorBackend] = useState("helsinki");
  const [nllbModels, setNllbModels] = useState<AsrModelOption[]>([]);
  const [nllbModel, setNllbModel] = useState("facebook/nllb-200-distilled-600M");
  const [hunyuanModels, setHunyuanModels] = useState<AsrModelOption[]>([]);
  const [hunyuanModel, setHunyuanModel] = useState("tencent/HY-MT1.5-1.8B");
  const [translateBatchSize, setTranslateBatchSize] = useState(16);
  const [qcEnabled, setQcEnabled] = useState(false);
  const [lmstudioUrl, setLmstudioUrl] = useState("http://localhost:1234/v1");
  const [lmstudioModel, setLmstudioModel] = useState("local-model");

  useEffect(() => {
    getLanguages()
      .then((data) => {
        setLanguages(data.languages);
        if (data.nemotron_by_iso) setNemotronByIso(data.nemotron_by_iso);
      })
      .catch(() => undefined);
    getAsrModels()
      .then((data) => {
        setAsrModels(data.asr_models);
        setAlignerModels(data.forced_aligner_models);
        if (data.whisper_models?.length) setWhisperModels(data.whisper_models);
        if (data.nemotron_models?.length) setNemotronModels(data.nemotron_models);
      })
      .catch(() => undefined);
    getTranslationModels()
      .then((data) => {
        if (data.nllb_models?.length) setNllbModels(data.nllb_models);
        if (data.hunyuan_models?.length) setHunyuanModels(data.hunyuan_models);
      })
      .catch(() => undefined);
  }, []);

  const whisperModel =
    whisperPreset === CUSTOM_WHISPER ? whisperCustom.trim() : whisperPreset;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      sourceUrl: mode === "url" ? sourceUrl.trim() : undefined,
      file: mode === "file" ? file : null,
      sourceLang,
      targetLang,
      asrEngine,
      asrModel,
      forcedAlignerModel,
      whisperModel: asrEngine === "whisper" ? whisperModel : "openai/whisper-large-v3",
      nemotronModel: asrEngine === "nemotron" ? nemotronModel : "nvidia/nemotron-3.5-asr-streaming-0.6b",
      translatorBackend,
      nllbModel,
      hunyuanModel,
      translateBatchSize,
      qcEnabled,
      lmstudioUrl,
      lmstudioModel,
    });
  };

  const hasSource = mode === "url" ? sourceUrl.trim().length > 0 : !!file;
  const whisperValid = asrEngine !== "whisper" || whisperModel.length > 0;
  const canSubmit = hasSource && whisperValid;
  const nemotronInfo = asrEngine === "nemotron" ? nemotronByIso[sourceLang] : null;

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-white/10 bg-panel/60 p-6">
      <div className="flex gap-2">
        <TabButton active={mode === "url"} onClick={() => setMode("url")}>
          YouTube URL
        </TabButton>
        <TabButton active={mode === "file"} onClick={() => setMode("file")}>
          Upload file
        </TabButton>
      </div>

      {mode === "url" ? (
        <input
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-lg border border-white/10 bg-ink px-4 py-3 outline-none focus:border-brand"
        />
      ) : (
        <input
          type="file"
          accept="video/*,audio/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-lg border border-white/10 bg-ink px-4 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-white"
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <Select label="Spoken language" value={sourceLang} onChange={setSourceLang} options={languages} />
        <Select label="Translate to" value={targetLang} onChange={setTargetLang} options={languages} />
      </div>

      <CollapsibleSection title="Advanced settings">
        <div>
          <Label>ASR engine</Label>
          <div className="flex flex-wrap gap-2">
            <TabButton active={asrEngine === "qwen"} onClick={() => setAsrEngine("qwen")}>
              Qwen3-ASR
            </TabButton>
            <TabButton active={asrEngine === "whisper"} onClick={() => setAsrEngine("whisper")}>
              Whisper
            </TabButton>
            <TabButton active={asrEngine === "nemotron"} onClick={() => setAsrEngine("nemotron")}>
              Nemotron 3.5
            </TabButton>
          </div>
        </div>

        {asrEngine === "qwen" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RepoSelect label="ASR model" value={asrModel} onChange={setAsrModel} options={asrModels} />
            <RepoSelect
              label="Forced aligner"
              value={forcedAlignerModel}
              onChange={setForcedAlignerModel}
              options={alignerModels}
            />
          </div>
        )}

        {asrEngine === "whisper" && (
          <div className="space-y-3">
            <div>
              <Label>Whisper model</Label>
              <select
                value={whisperPreset}
                onChange={(e) => setWhisperPreset(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
              >
                {whisperModels.map((opt) => (
                  <option key={opt.repo_id} value={opt.repo_id}>
                    {opt.label}
                  </option>
                ))}
                <option value={CUSTOM_WHISPER}>Custom HF model…</option>
              </select>
            </div>
            {whisperPreset === CUSTOM_WHISPER && (
              <input
                value={whisperCustom}
                onChange={(e) => setWhisperCustom(e.target.value)}
                placeholder="e.g. openai/whisper-large-v3-turbo"
                className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            )}
          </div>
        )}

        {asrEngine === "nemotron" && (
          <div className="space-y-3">
            <RepoSelect
              label="Nemotron model"
              value={nemotronModel}
              onChange={setNemotronModel}
              options={nemotronModels}
            />
            {nemotronInfo?.tier === "adaptation" && (
              <p className="text-xs text-amber-300/80">
                This language is adaptation-ready in Nemotron — accuracy may be lower unless
                fine-tuned on in-domain data.
              </p>
            )}
          </div>
        )}

        <div>
          <Label>Translation engine</Label>
          <select
            value={translatorBackend}
            onChange={(e) => setTranslatorBackend(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
          >
            {BACKENDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        {translatorBackend === "nllb" && (
          <RepoSelect label="NLLB model" value={nllbModel} onChange={setNllbModel} options={nllbModels} />
        )}

        {translatorBackend === "hunyuan" && (
          <RepoSelect
            label="Hunyuan model"
            value={hunyuanModel}
            onChange={setHunyuanModel}
            options={hunyuanModels}
          />
        )}

        <div>
          <Label>Translation batch size</Label>
          <input
            type="number"
            min={1}
            max={128}
            value={translateBatchSize}
            onChange={(e) =>
              setTranslateBatchSize(Math.min(128, Math.max(1, Number(e.target.value) || 1)))
            }
            className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
          />
        </div>

        <div className="rounded-xl border border-white/10 bg-ink/60 p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={qcEnabled}
              onChange={(e) => setQcEnabled(e.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            <span className="font-medium">Quality control (back-translate + LM Studio fix)</span>
          </label>
          {qcEnabled && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                value={lmstudioUrl}
                onChange={(e) => setLmstudioUrl(e.target.value)}
                placeholder="LM Studio URL"
                className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <input
                value={lmstudioModel}
                onChange={(e) => setLmstudioModel(e.target.value)}
                placeholder="Model name"
                className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
          )}
        </div>
      </CollapsibleSection>

      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Processing..." : "Generate dual subtitles"}
      </button>
    </form>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
        active ? "bg-brand text-white" : "bg-ink text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-sm font-medium text-white/70">{children}</div>;
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
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
      >
        {options.map((opt) => (
          <option key={opt.repo_id} value={opt.repo_id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 outline-none focus:border-brand"
      >
        {Object.entries(options)
          .sort(([, a], [, b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
          .map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
