import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createPlaylistQueue,
  createMultiUploadQueue,
  ensureJobModels,
  waitForModelDownloads,
} from "../api";
import { useJobFormState } from "../hooks/useJobForm";
import { DEFAULT_SUBTITLE_STYLE } from "../hooks/useSubtitleStyleSettings";
import Button from "./ui/Button";
import FormSection from "./ui/FormSection";
import ModeCard from "./ui/ModeCard";
import {
  IconArrowRight,
  IconDub,
  IconPlay,
  IconSubtitles,
  IconUpload,
  IconList,
} from "./ui/Icons";
import Input from "./ui/Input";
import Select from "./ui/Select";
import SegmentedControl from "./ui/SegmentedControl";
import MultiFileDropZone from "./ui/MultiFileDropZone";

interface BatchQueueFormProps {
  onQueueCreated?: (queueId: string) => void;
}

export default function BatchQueueForm({
  onQueueCreated,
}: BatchQueueFormProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"playlist" | "multi">("playlist");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formState = useJobFormState();
  const {
    jobMode,
    setJobMode,
    sourceLang,
    setSourceLang,
    targetLang,
    setTargetLang,
    sortedLanguages,
  } = formState;

  const canSubmit =
    mode === "playlist" ? playlistUrl.trim() !== "" : files.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;

    setError(null);
    setBusy(true);

    try {
      // Build job params
      const whisperModel =
        formState.whisperPreset === "custom"
          ? formState.whisperCustom.trim()
          : formState.whisperPreset;

      const params = {
        sourceLang,
        targetLang,
        jobMode,
        asrEngine: formState.asrEngine,
        asrModel: formState.asrModel,
        forcedAlignerModel: formState.forcedAlignerModel,
        whisperModel:
          formState.asrEngine === "whisper"
            ? whisperModel
            : "openai/whisper-large-v3",
        nemotronModel:
          formState.asrEngine === "nemotron"
            ? formState.nemotronModel
            : "nvidia/nemotron-3.5-asr-streaming-0.6b",
        translatorBackend: formState.translatorBackend,
        nllbModel: formState.nllbModel,
        hunyuanModel: formState.hunyuanModel,
        translateBatchSize: formState.translateBatchSize,
        qcEnabled: formState.qcEnabled,
        llmProvider: formState.llmProvider,
        llmBaseUrl: formState.llmBaseUrl,
        llmModel: formState.llmModel,
        lmstudioUrl: formState.llmBaseUrl,
        lmstudioModel: formState.llmModel,
        subtitleStyle: DEFAULT_SUBTITLE_STYLE,
        ttsBackend: formState.ttsBackend,
        ttsModel: formState.ttsModel,
        voiceMode: formState.voiceMode,
        voiceId: formState.voiceId,
        voiceDesignInstruct: formState.voiceDesignInstruct,
        voiceInstruct: formState.voiceInstruct,
        refText: formState.refText,
        voiceCloneXVectorOnly: formState.voiceCloneXVectorOnly,
        higgsServerUrl: formState.higgsServerUrl,
        keepBackground: formState.keepBackground,
        backgroundMixLevel: formState.backgroundMixLevel,
        refAudioFile:
          formState.voiceMode === "clone_upload"
            ? formState.refAudioFile
            : null,
      };

      // Ensure models are downloaded
      const ensureResult = await ensureJobModels(params);
      if (ensureResult.started.length > 0 || ensureResult.waiting.length > 0) {
        await waitForModelDownloads([
          ...ensureResult.started,
          ...ensureResult.waiting,
        ]);
      }

      // Create queue
      let result;
      if (mode === "playlist") {
        result = await createPlaylistQueue(playlistUrl, params);
      } else {
        result = await createMultiUploadQueue(files, params);
      }

      // Show success and call callback
      setSuccess(
        t("batchQueue.successMessage", { count: result.total_items, id: result.queue_id }),
      );
      if (onQueueCreated) {
        onQueueCreated(result.queue_id);
      }
    } catch (err: any) {
      console.error("Failed to create queue:", err);
      setError(err.message || t("batchQueue.errorFallback"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Job Mode Selection */}
      <div className="flex gap-3">
        <ModeCard
          selected={jobMode === "subtitle"}
          onClick={() => setJobMode("subtitle")}
          icon={<IconSubtitles className="h-5 w-5" />}
          title={t("jobForm.subtitles")}
          description={t("jobForm.subtitlesDesc")}
        />
        <ModeCard
          selected={jobMode === "dub"}
          onClick={() => setJobMode("dub")}
          icon={<IconDub className="h-5 w-5" />}
          title={t("jobForm.dubbing")}
          description={t("jobForm.dubbingDesc")}
        />
      </div>

      {/* Batch Source Selection */}
      <FormSection
        step={1}
        title={t("batchQueue.sourceTitle")}
        description={t("batchQueue.sourceDesc")}
      >
        <SegmentedControl
          value={mode}
          onChange={setMode}
          size="sm"
          options={[
            {
              value: "playlist" as const,
              label: t("batchQueue.modePlaylist"),
              icon: <IconList className="h-3.5 w-3.5" />,
            },
            {
              value: "multi" as const,
              label: t("batchQueue.modeFiles"),
              icon: <IconUpload className="h-3.5 w-3.5" />,
            },
          ]}
        />
        <div className="mt-3">
          {mode === "playlist" ? (
            <Input
              type="url"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=..."
            />
          ) : (
            <MultiFileDropZone
              accept="video/*,audio/*"
              files={files}
              onFiles={setFiles}
            />
          )}
        </div>
      </FormSection>

      {/* Languages */}
      <FormSection
        step={2}
        title={t("jobForm.languages")}
        description={t("jobForm.languagesDesc")}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select
              label={t("common.from")}
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
            >
              {sortedLanguages.map(([code, name]) => (
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
            <Select
              label={t("common.to")}
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
            >
              {sortedLanguages.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </FormSection>

      {/* Success Message */}
      {success && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-3 text-sm text-green-400">
          {success}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={!canSubmit || busy}
        className="w-full"
        icon={<IconPlay className="h-4 w-4" />}
      >
        {busy
          ? t("batchQueue.submitting")
          : mode === "playlist"
            ? t("batchQueue.submitPlaylist")
            : files.length === 1
              ? t("batchQueue.submitFiles", { count: files.length })
              : t("batchQueue.submitFilesPlural", { count: files.length })}
      </Button>
    </form>
  );
}
