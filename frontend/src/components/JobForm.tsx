import Alert from "./ui/Alert";
import Button from "./ui/Button";
import FileDropZone from "./ui/FileDropZone";
import FormSection from "./ui/FormSection";
import ModeCard from "./ui/ModeCard";
import { IconArrowRight, IconDub, IconLink, IconPlay, IconSubtitles, IconUpload } from "./ui/Icons";
import Input, { FileInput, Textarea } from "./ui/Input";
import Select from "./ui/Select";
import SegmentedControl from "./ui/SegmentedControl";
import { TTS_BACKEND_LABELS, useJobForm } from "../hooks/useJobForm";
import type { AsrModelOption, TtsBackend } from "../types";

export default function JobForm() {
  const f = useJobForm();

  return (
    <form onSubmit={f.submit} className="space-y-6">
      <div className="flex gap-3">
        <ModeCard
          selected={f.jobMode === "subtitle"}
          onClick={() => f.setJobMode("subtitle")}
          icon={<IconSubtitles className="h-5 w-5" />}
          title="Subtitles"
          description="Dual-language subtitles with karaoke highlighting"
        />
        <ModeCard
          selected={f.jobMode === "dub"}
          onClick={() => f.setJobMode("dub")}
          icon={<IconDub className="h-5 w-5" />}
          title="Dubbing"
          description="Replace speech with synthesized voice"
        />
      </div>

      <FormSection step={1} title="Media source" description="YouTube link or local file">
        <SegmentedControl
          value={f.mode}
          onChange={f.setMode}
          size="sm"
          options={[
            { value: "url" as const, label: "URL", icon: <IconLink className="h-3.5 w-3.5" /> },
            { value: "file" as const, label: "Upload", icon: <IconUpload className="h-3.5 w-3.5" /> },
          ]}
        />
        <div className="mt-3">
          {f.mode === "url" ? (
            <Input
              type="url"
              value={f.sourceUrl}
              onChange={(e) => f.setSourceUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          ) : (
            <FileDropZone accept="video/*,audio/*" file={f.file} onFile={f.setFile} />
          )}
        </div>
      </FormSection>

      <FormSection step={2} title="Languages" description="Spoken language and translation target">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select label="From" value={f.sourceLang} onChange={(e) => f.setSourceLang(e.target.value)}>
              {f.sortedLanguages.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <span className="mb-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500">
            <IconArrowRight className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <Select label="To" value={f.targetLang} onChange={(e) => f.setTargetLang(e.target.value)}>
              {f.sortedLanguages.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </FormSection>

      {f.jobMode === "dub" && (
        <FormSection step={3} title="Voice & dubbing" description="TTS engine and voice settings">
          <div className="space-y-4 rounded-xl border border-border bg-[var(--panel-bg)] p-4">
            {f.isVoiceDesign && (
              <Alert variant="warning">
                VoiceDesign can vary between lines. For more consistent dubbing, use CustomVoice or
                voice clone instead.
              </Alert>
            )}
            <Select
              label="TTS engine"
              value={f.ttsBackend}
              onChange={(e) => f.handleTtsBackendChange(e.target.value as TtsBackend)}
            >
              {(Object.keys(TTS_BACKEND_LABELS) as TtsBackend[]).map((id) => (
                <option key={id} value={id}>
                  {TTS_BACKEND_LABELS[id]}
                </option>
              ))}
            </Select>

            {f.ttsBackend === "qwen" && f.ttsMeta && (
              <RepoSelect
                label="Qwen3-TTS model"
                value={f.ttsModel}
                onChange={f.handleTtsModelChange}
                options={f.ttsMeta.qwen_models}
              />
            )}

            {f.showCloneUi && !f.isVoiceClone && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-zinc-400">Voice source</p>
                <SegmentedControl
                  value={f.voiceMode}
                  onChange={f.setVoiceMode}
                  options={[
                    { value: "clone_video" as const, label: "From video" },
                    { value: "clone_upload" as const, label: "Upload ref" },
                    ...(f.backendInfo?.supports_preset
                      ? [{ value: "preset" as const, label: "Preset" }]
                      : []),
                  ]}
                />
              </div>
            )}

            {f.isVoiceClone && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-zinc-400">Voice source</p>
                <SegmentedControl
                  value={f.voiceMode}
                  onChange={f.setVoiceMode}
                  options={[
                    { value: "clone_video" as const, label: "From video" },
                    { value: "clone_upload" as const, label: "Upload ref" },
                  ]}
                />
              </div>
            )}

            {f.showPresetUi && f.presetVoices.length > 0 && f.voiceMode === "preset" && (
              <Select label="Preset voice" value={f.voiceId} onChange={(e) => f.setVoiceId(e.target.value)}>
                {f.presetVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            )}

            {f.isVoiceDesign && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-zinc-400">Voice description (required)</p>
                <Textarea
                  value={f.voiceDesignInstruct}
                  onChange={(e) => f.setVoiceDesignInstruct(e.target.value)}
                  rows={3}
                  placeholder="Describe the target voice in natural language…"
                />
              </div>
            )}

            {f.ttsBackend === "qwen" && f.qwenKind === "custom_voice" && f.voiceMode === "preset" && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-zinc-400">Style instruct (optional)</p>
                <Input
                  value={f.voiceInstruct}
                  onChange={(e) => f.setVoiceInstruct(e.target.value)}
                  placeholder="e.g. speak cheerfully"
                />
              </div>
            )}

            {f.ttsBackend === "voxcpm" && f.voiceMode === "preset" && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-zinc-400">
                  Voice design description (optional)
                </p>
                <Input
                  value={f.voiceDesignInstruct}
                  onChange={(e) => f.setVoiceDesignInstruct(e.target.value)}
                  placeholder="e.g. A young woman, gentle and sweet voice"
                />
              </div>
            )}

            {f.voiceMode === "clone_upload" && (
              <>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-zinc-400">Reference audio</p>
                  <FileInput
                    type="file"
                    accept="audio/*"
                    onChange={(e) => f.setRefAudioFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                {!f.voiceCloneXVectorOnly && (
                  <div>
                    <p className="mb-1.5 text-sm font-medium text-zinc-400">
                      Reference transcript (required)
                    </p>
                    <Textarea
                      value={f.refText}
                      onChange={(e) => f.setRefText(e.target.value)}
                      rows={2}
                      placeholder="Exact words spoken in the reference clip"
                    />
                  </div>
                )}
              </>
            )}

            {f.voiceMode === "clone_video" &&
              (f.isVoiceClone ||
                f.ttsBackend === "omnivoice" ||
                f.ttsBackend === "higgs" ||
                f.ttsBackend === "voxcpm") && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-zinc-400">
                    Reference transcript override (optional)
                  </p>
                  <Textarea
                    value={f.refText}
                    onChange={(e) => f.setRefText(e.target.value)}
                    rows={2}
                    placeholder="Leave empty to auto-detect from ASR"
                  />
                </div>
              )}

            {f.isVoiceClone && (
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={f.voiceCloneXVectorOnly}
                  onChange={(e) => f.setVoiceCloneXVectorOnly(e.target.checked)}
                  className="h-4 w-4 accent-zinc-400"
                />
                <span className="text-sm text-zinc-300">
                  x_vector_only mode (no ref transcript; lower clone quality)
                </span>
              </label>
            )}

            {f.ttsBackend === "higgs" && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-zinc-400">Higgs TTS server URL</p>
                <Input value={f.higgsServerUrl} onChange={(e) => f.setHiggsServerUrl(e.target.value)} />
                <p className="mt-1 text-xs text-zinc-500">
                  Run SGLang-Omni or vLLM-Omni locally. Research/non-commercial license.
                </p>
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={f.keepBackground}
                onChange={(e) => f.setKeepBackground(e.target.checked)}
                className="h-4 w-4 rounded accent-indigo-500"
              />
              <span className="text-sm text-zinc-300">Keep background music (Demucs separation)</span>
            </label>
          </div>
        </FormSection>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={!f.canSubmit || f.busy}
        className="w-full"
        icon={<IconPlay className="h-4 w-4" />}
      >
        {f.busy
          ? "Processing..."
          : f.jobMode === "dub"
            ? "Generate dubbed video"
            : "Generate dual subtitles"}
      </Button>
    </form>
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
