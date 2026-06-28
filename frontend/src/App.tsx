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
import { JobFormProvider } from "./hooks/useJobForm";
import JobForm from "./components/JobForm";
import { AdvancedSettingsToolbar } from "./components/AdvancedSettingsPanel";
import ModelsModal from "./components/ModelsModal";
import Player from "./components/Player";
import Accordion from "./components/ui/Accordion";
import SubtitleSettingsPanel from "./components/SubtitleSettingsPanel";
import Button from "./components/ui/Button";
import Alert from "./components/ui/Alert";
import WorkflowStepper, { type Step } from "./components/ui/WorkflowStepper";
import { IconDatabase, IconDownload, IconPlay, IconSettings } from "./components/ui/Icons";
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
  synthesizing: "Synthesizing speech",
  separating: "Separating background",
  mixing: "Mixing dubbed audio",
  done: "Done",
  error: "Error",
};

const PIPELINE_STEPS = [
  "pending",
  "downloading",
  "extracting",
  "transcribing",
  "segmenting",
  "translating",
  "quality_check",
  "building",
  "synthesizing",
  "separating",
  "mixing",
  "done",
];

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
  if (status === "synthesizing" && params?.jobMode === "dub") {
    return `Synthesizing (${params.ttsModel})`;
  }
  return STATUS_LABEL[status] ?? status;
}

function workflowStep(
  progress: ProgressEvent | null,
  cues: Cue[] | null,
  exportReady: boolean
): Step {
  if (exportReady) return "export";
  if (cues) return "preview";
  if (progress && progress.status !== "error") return "processing";
  return "configure";
}

export default function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobParams, setJobParams] = useState<CreateJobParams | null>(null);
  const [jobRepos, setJobRepos] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingSubs, setExportingSubs] = useState(false);
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

  const handleExport = async (includeSubtitles = false) => {
    if (!jobId) return;
    if (includeSubtitles) setExportingSubs(true);
    else setExporting(true);
    setError(null);
    try {
      await requestExport(jobId, styleSettings, includeSubtitles);
      setExportReady(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
      setExportingSubs(false);
    }
  };

  const isDubJob = jobParams?.jobMode === "dub";
  const currentStep = workflowStep(progress, cues, exportReady);

  const sourceLabel =
    (jobParams && languages[jobParams.sourceLang]) || jobParams?.sourceLang || "Source";
  const targetLabel =
    (jobParams && languages[jobParams.targetLang]) || jobParams?.targetLang || "Translation";

  return (
    <JobFormProvider onSubmit={handleSubmit} busy={busy}>
    <div className="app-shell flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-[#09090b]/90 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20">
              <IconPlay className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none text-zinc-100">DualSub</h1>
              <p className="mt-0.5 hidden text-[11px] text-zinc-500 sm:block">
                Transcribe · Translate · Dub
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {backendOk !== null && (
              <span
                className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${
                  backendOk
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-amber-500/10 text-amber-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${backendOk ? "bg-emerald-400" : "bg-amber-400 animate-pulse-ring"}`}
                />
                {backendOk ? "Backend online" : "Backend offline"}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              icon={<IconDatabase />}
              onClick={() => setModelsOpen(true)}
            >
              Models
            </Button>
          </div>
        </div>
      </header>

      <ModelsModal
        open={modelsOpen}
        watchModelIds={modelsWatchIds}
        onClose={() => setModelsOpen(false)}
      />

      {backendOk === false && (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2.5 lg:px-6">
          <Alert variant="warning" className="border-0 bg-transparent p-0">
            Backend not reachable — start with{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs">
              cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
            </code>
          </Alert>
        </div>
      )}

      {/* Main split layout: left form | center workspace | right advanced */}
      <div className="flex flex-1 flex-col xl:flex-row">
        {/* Left config panel */}
        <aside className="flex w-full shrink-0 flex-col border-b border-border bg-[var(--panel-bg)] lg:max-h-[calc(100vh-3.5rem)] xl:w-[380px] xl:border-b-0 xl:border-r 2xl:w-[400px]">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border px-5 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                New project
              </h2>
              <p className="mt-1 text-sm text-zinc-400">Configure your transcription job</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <JobForm />
              <div className="mt-4 space-y-3">
                {modelPrepMessage && <Alert variant="info">{modelPrepMessage}</Alert>}
                {error && <Alert variant="error">{error}</Alert>}
              </div>
            </div>
          </div>
        </aside>

        {/* Workspace + optional appearance panel */}
        <div className="flex min-h-[50vh] min-w-0 flex-1 flex-col lg:min-h-0 lg:max-h-[calc(100vh-3.5rem)] xl:flex-row">
          <div className="app-grid-bg flex min-w-0 flex-1 flex-col">
            <div className="relative shrink-0 border-b border-border bg-[var(--panel-bg)]/80 px-5 py-4 backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <WorkflowStepper current={currentStep} className="min-w-0 flex-1" />
                {!cues && <AdvancedSettingsToolbar />}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
            {progress && progress.status !== "done" && progress.status !== "error" && (
              <ProgressPanel progress={progress} params={jobParams} jobRepos={jobRepos} />
            )}

            {progress?.status === "error" && (
              <Alert variant="error" className="mb-5">
                {progress.message || "Pipeline failed"}
              </Alert>
            )}

            {progress?.status === "done" && !cues && (
              <div className="flex flex-1 items-center justify-center py-20">
                <div className="text-center">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                  <p className="text-sm text-zinc-400">Loading preview…</p>
                </div>
              </div>
            )}

            {cues && jobId ? (
              <div className="flex flex-1 flex-col gap-5">
                <Player src={mediaUrl(jobId)} cues={cues} style={styleSettings} />

                <div className="xl:hidden">
                  <Accordion
                    title="Subtitle appearance"
                    description="Font, colors, and karaoke styling for preview and export"
                    icon={<IconSettings className="h-4 w-4" />}
                    defaultOpen
                  >
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
                  </Accordion>
                </div>

                {/* Export toolbar */}
                <div className="mt-auto rounded-xl border border-border bg-[var(--panel-bg)] p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Export
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {isDubJob ? (
                      <>
                        <Button
                          variant="secondary"
                          icon={<IconDownload />}
                          onClick={() => handleExport(false)}
                          disabled={exporting || exportingSubs}
                        >
                          {exporting ? "Preparing…" : "Dubbed video"}
                        </Button>
                        <Button
                          variant="secondary"
                          icon={<IconDownload />}
                          onClick={() => handleExport(true)}
                          disabled={exporting || exportingSubs}
                        >
                          {exportingSubs ? "Burning…" : "Dub + subtitles"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        icon={<IconDownload />}
                        onClick={() => handleExport(false)}
                        disabled={exporting}
                      >
                        {exporting ? "Burning…" : "Burned-in video"}
                      </Button>
                    )}
                    {exportReady && (
                      <a
                        href={exportDownloadUrl(jobId)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-500"
                      >
                        <IconDownload className="h-4 w-4" />
                        Download MP4
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              !progress && <EmptyWorkspace />
            )}
            </div>
          </div>

          {cues && (
            <aside className="w-full shrink-0 border-t border-border bg-[var(--panel-bg)] xl:w-[340px] xl:border-l xl:border-t-0 xl:max-h-[calc(100vh-3.5rem)] 2xl:w-[360px]">
              <div className="flex h-full min-h-0 flex-col overflow-y-auto px-5 py-5">
                <div className="mb-4 shrink-0">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Appearance
                  </h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    Subtitle styling for preview & export
                  </p>
                </div>
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
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
    </JobFormProvider>
  );
}

function EmptyWorkspace() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      <div className="relative mb-6">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-border bg-[var(--panel-bg)]">
          <IconPlay className="h-9 w-9 text-zinc-600" />
        </div>
        <div className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[var(--app-bg)] bg-indigo-500" />
      </div>
      <h2 className="text-lg font-semibold text-zinc-200">Your workspace is empty</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
        Configure a job on the left, adjust advanced options on the right, then hit generate.
      </p>
      <div className="mt-8 grid max-w-md grid-cols-3 gap-4 text-left">
        {[
          { n: "1", t: "Add source", d: "URL or file upload" },
          { n: "2", t: "Pick languages", d: "Source and target" },
          { n: "3", t: "Generate", d: "Watch live preview" },
        ].map((item) => (
          <div key={item.n} className="rounded-lg border border-border bg-[var(--panel-bg)] p-3">
            <span className="text-xs font-bold text-indigo-400">{item.n}</span>
            <p className="mt-1 text-xs font-medium text-zinc-300">{item.t}</p>
            <p className="mt-0.5 text-[11px] text-zinc-600">{item.d}</p>
          </div>
        ))}
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
  const stepIdx = PIPELINE_STEPS.indexOf(progress.status);

  return (
    <div className="mb-5 rounded-xl border border-border bg-[var(--panel-bg)] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
            Processing
          </p>
          <p className="mt-1 text-base font-medium text-zinc-100">
            {statusLabel(progress.status, params, jobRepos)}
          </p>
        </div>
        <span className="rounded-lg bg-zinc-800 px-2.5 py-1 font-mono text-sm text-zinc-300">
          {pct}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`relative h-full rounded-full transition-all duration-500 ${
            isError ? "bg-red-500" : "bg-indigo-500"
          }`}
          style={{ width: `${pct}%` }}
        >
          {!isError && (
            <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          )}
        </div>
      </div>

      {stepIdx >= 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {PIPELINE_STEPS.filter((s) => s !== "done" && s !== "error").map((s, i) => (
            <span
              key={s}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
                i < stepIdx
                  ? "bg-indigo-500/20 text-indigo-300"
                  : i === stepIdx
                    ? "bg-indigo-500/30 text-indigo-200 ring-1 ring-indigo-500/40"
                    : "bg-zinc-800/60 text-zinc-600"
              }`}
            >
              {STATUS_LABEL[s] ?? s}
            </span>
          ))}
        </div>
      )}

      {progress.message && (
        <p className="mt-3 text-xs text-zinc-500">{progress.message}</p>
      )}
    </div>
  );
}
