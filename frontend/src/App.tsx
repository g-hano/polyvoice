import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkBackendHealth,
  createJob,
  ensureJobModels,
  exportDownloadUrl,
  getCues,
  getLanguages,
  getSubtitleFonts,
  mediaUrl,
  requestExport,
  subscribeProgress,
  waitForModelDownloads,
} from "./api";
import { useSubtitleStyleSettings } from "./hooks/useSubtitleStyleSettings";
import JobForm from "./components/JobForm";
import ModelsModal from "./components/ModelsModal";
import Player from "./components/Player";
import CollapsibleSection from "./components/CollapsibleSection";
import SubtitleSettingsPanel from "./components/SubtitleSettingsPanel";
import type { Cue, CreateJobParams, JobFormSubmitParams, ProgressEvent } from "./types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  downloading: "Fetching media",
  extracting: "Extracting audio",
  transcribing: "Transcribing",
  segmenting: "Building cues",
  translating: "Translating",
  quality_check: "Quality check (LM Studio)",
  building: "Writing subtitles",
  done: "Done",
  error: "Error",
};

function translatorModelName(params: CreateJobParams, jobRepos: string[] = []): string {
  switch (params.translatorBackend) {
    case "nllb":
      return params.nllbModel;
    case "hunyuan":
      return params.hunyuanModel;
    case "translategemma":
      return "google/translategemma-4b-it";
    case "helsinki": {
      const repo = jobRepos.find((r) => r.startsWith("Helsinki-NLP/"));
      return repo ?? `Helsinki ${params.sourceLang}→${params.targetLang}`;
    }
    default:
      return params.translatorBackend;
  }
}

function statusLabel(
  status: string,
  params: CreateJobParams | null,
  jobRepos: string[] = []
): string {
  if (status === "transcribing" && params) {
    const model =
      params.asrEngine === "whisper"
        ? params.whisperModel
        : params.asrEngine === "nemotron"
          ? params.nemotronModel
          : params.asrModel;
    return `Transcribing (${model})`;
  }
  if (status === "translating" && params) {
    return `Translating (${translatorModelName(params, jobRepos)})`;
  }
  return STATUS_LABEL[status] ?? status;
}

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobParams, setJobParams] = useState<CreateJobParams | null>(null);
  const [jobRepos, setJobRepos] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportReady, setExportReady] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelsWatchIds, setModelsWatchIds] = useState<string[]>([]);
  const [modelPrepMessage, setModelPrepMessage] = useState<string | null>(null);
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [languages, setLanguages] = useState<Record<string, string>>({});
  const [fonts, setFonts] = useState<string[]>(["Arial", "Verdana", "Georgia"]);
  const unsubRef = useRef<(() => void) | null>(null);
  const {
    settings: styleSettings,
    updateSource,
    updateTarget,
    reset: resetStyle,
  } = useSubtitleStyleSettings();

  const busy =
    !!modelPrepMessage ||
    (!!jobId && progress?.status !== "done" && progress?.status !== "error");

  const handleSubmit = useCallback(
    async (params: JobFormSubmitParams) => {
      setError(null);
      setCues(null);
      setProgress(null);
      setExportReady(false);
      setJobRepos([]);
      const fullParams: CreateJobParams = { ...params, subtitleStyle: styleSettings };
      setJobParams(fullParams);
      try {
        const ensure = await ensureJobModels(fullParams);
        setJobRepos(ensure.repos ?? []);
        if (ensure.pending.length > 0) {
          setModelsWatchIds(ensure.pending);
          setModelsOpen(true);
          setModelPrepMessage(
            ensure.started.length > 0
              ? `Downloading ${ensure.pending.length} required model(s)…`
              : `Waiting for ${ensure.pending.length} model download(s)…`
          );
          await waitForModelDownloads(ensure.pending);
          setModelPrepMessage(null);
        }

        const { job_id } = await createJob(fullParams);
        setJobId(job_id);
        unsubRef.current?.();
        unsubRef.current = subscribeProgress(job_id, (e) => setProgress(e));
      } catch (err) {
        setModelPrepMessage(null);
        setError((err as Error).message);
      }
    },
    [styleSettings]
  );

  useEffect(() => {
    checkBackendHealth().then(setBackendOk);
    getLanguages()
      .then((data) => setLanguages(data.languages))
      .catch(() => undefined);
    getSubtitleFonts().then(setFonts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (progress?.status === "done" && jobId) {
      getCues(jobId).then(setCues).catch((e) => setError(e.message));
    }
    if (progress?.status === "error") {
      setError(progress.message || "Pipeline failed");
    }
  }, [progress?.status, jobId]);

  useEffect(() => () => unsubRef.current?.(), []);

  useEffect(() => {
    if (exportReady) setExportReady(false);
  }, [styleSettings]);

  const handleExport = async () => {
    if (!jobId) return;
    setExporting(true);
    setError(null);
    try {
      await requestExport(jobId, styleSettings);
      setExportReady(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const sourceLabel =
    (jobParams && languages[jobParams.sourceLang]) || jobParams?.sourceLang || "Source";
  const targetLabel =
    (jobParams && languages[jobParams.targetLang]) || jobParams?.targetLang || "Translation";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            DualSub
          </h1>
          <p className="mt-2 text-white/60">
            Transcribe, translate, and watch with both languages and live word
            highlighting.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModelsOpen(true)}
          className="rounded-xl border border-white/15 bg-panel/80 px-4 py-2.5 text-sm font-medium text-white/90 shadow-lg backdrop-blur hover:border-brand/40 hover:bg-panel"
        >
          Downloaded models
        </button>
      </header>

      <ModelsModal
        open={modelsOpen}
        watchModelIds={modelsWatchIds}
        onClose={() => setModelsOpen(false)}
      />

      {backendOk === false && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Backend not reachable. Start it with{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
            cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
          </code>{" "}
          and use the frontend at <strong>http://localhost:5173</strong> (not port 8000).
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
        <div className="space-y-4">
          <JobForm onSubmit={handleSubmit} busy={busy} />
          {modelPrepMessage && (
            <div className="rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-brand">
              {modelPrepMessage}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {progress && (
            <ProgressPanel progress={progress} params={jobParams} jobRepos={jobRepos} />
          )}

          {cues && jobId ? (
            <>
              <Player src={mediaUrl(jobId)} cues={cues} style={styleSettings} />
              <CollapsibleSection title="Subtitle settings" defaultOpen>
                <SubtitleSettingsPanel
                  settings={styleSettings}
                  fonts={fonts}
                  onSourceChange={updateSource}
                  onTargetChange={updateTarget}
                  onReset={resetStyle}
                  sourceLabel={sourceLabel}
                  targetLabel={targetLabel}
                  embedded
                />
              </CollapsibleSection>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="rounded-lg border border-white/15 bg-panel px-4 py-2 text-sm font-medium hover:bg-white/5 disabled:opacity-40"
                >
                  {exporting ? "Burning subtitles..." : "Export burned-in video"}
                </button>
                {exportReady && (
                  <a
                    href={exportDownloadUrl(jobId)}
                    className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
                  >
                    Download MP4
                  </a>
                )}
              </div>
            </>
          ) : (
            !progress && (
              <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-white/15 text-white/40">
                Submit a video to get started
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressPanel({
  progress,
  params,
  jobRepos,
}: {
  progress: ProgressEvent;
  params: CreateJobParams | null;
  jobRepos: string[];
}) {
  const pct = Math.round(progress.progress * 100);
  const isError = progress.status === "error";
  return (
    <div className="rounded-2xl border border-white/10 bg-panel/60 p-5">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">
          {statusLabel(progress.status, params, jobRepos)}
        </span>
        <span className="text-white/50">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${
            isError ? "bg-red-500" : "bg-brand"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.message && (
        <p className="mt-2 text-xs text-white/50">{progress.message}</p>
      )}
    </div>
  );
}
