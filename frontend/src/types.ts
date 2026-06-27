export interface Word {
  w: string;
  start: number;
  end: number;
}

export interface Line {
  text: string;
  words: Word[];
}

export interface Cue {
  id: number;
  start: number;
  end: number;
  source: Line;
  target: Line;
}

export type JobStatus =
  | "pending"
  | "downloading"
  | "extracting"
  | "transcribing"
  | "segmenting"
  | "translating"
  | "quality_check"
  | "building"
  | "done"
  | "error";

export interface ProgressEvent {
  job_id: string;
  status: JobStatus;
  progress: number;
  message: string;
}

export interface JobInfo {
  job_id: string;
  status: JobStatus;
  progress: number;
  message: string;
  error?: string | null;
  media_filename?: string | null;
  export_filename?: string | null;
}

export type AsrEngine = "qwen" | "whisper" | "nemotron";

export interface TrackStyle {
  font_family: string;
  font_size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  karaoke_active_color: string;
  karaoke_done_color: string;
  background_opacity: number;
}

export interface SubtitleStyleSettings {
  source: TrackStyle;
  target: TrackStyle;
}

export interface CreateJobParams {
  sourceUrl?: string;
  file?: File | null;
  sourceLang: string;
  targetLang: string;
  asrEngine: AsrEngine;
  asrModel: string;
  forcedAlignerModel: string;
  whisperModel: string;
  nemotronModel: string;
  translatorBackend: string;
  nllbModel: string;
  hunyuanModel: string;
  translateBatchSize: number;
  qcEnabled: boolean;
  lmstudioUrl: string;
  lmstudioModel: string;
  subtitleStyle: SubtitleStyleSettings;
}

/** Job form fields; subtitle style is configured separately below the player. */
export type JobFormSubmitParams = Omit<CreateJobParams, "subtitleStyle">;

export interface AsrModelOption {
  repo_id: string;
  label: string;
}

export interface NemotronLocaleOption {
  locale: string;
  label: string;
  tier: "ready" | "broad" | "adaptation";
}

export interface NemotronLangInfo {
  locale: string;
  tier: string | null;
}

export type ModelDownloadStatus =
  | "not_downloaded"
  | "downloaded"
  | "downloading"
  | "error";

export interface ModelInfo {
  id: string;
  repo_id: string;
  label: string;
  category: "asr" | "translation";
  description: string;
  required: boolean;
  status: ModelDownloadStatus;
  progress: number;
  message: string;
  error?: string | null;
  size_on_disk: number;
}

export interface ModelProgressEvent {
  model_id: string;
  repo_id: string;
  status: ModelDownloadStatus;
  progress: number;
  message: string;
  error?: string | null;
  size_on_disk: number;
}

export interface HfAuthStatus {
  configured: boolean;
  username?: string | null;
  source?: "env" | "runtime" | null;
}
