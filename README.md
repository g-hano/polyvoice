# DualSub

**Local dual-subtitle pipeline for video and audio.** Transcribe speech with **Qwen3-ASR** or **Whisper**, translate with Helsinki-NLP (or optional LLM backends), optionally refine translations via LM Studio, and play the result in a web player with **two subtitle tracks** and **live word-by-word karaoke highlighting**. Export a high-quality burned-in MP4 when you are done.

Everything runs on your machine — no cloud API keys required for the core workflow.

---

## Features

| Capability | Details |
|---|---|
| **Input** | YouTube URL (`yt-dlp`, highest available quality) or local video/audio upload |
| **ASR engines** | **Qwen3-ASR** (0.6B / 1.7B, standard or HF weights) or **Whisper** (small / medium / large-v3, or any custom Hugging Face model) |
| **Word timestamps** | Qwen: Qwen3 Forced Aligner · Whisper: built-in word-level timestamps (`return_timestamps="word"`) |
| **Translation** | Helsinki `opus-mt` (default, batched), Hunyuan Hy-MT2, or TranslateGemma 4B (both batched) |
| **GPU memory** | ASR model is unloaded from VRAM before translation starts |
| **Quality control** | Optional back-translation + LM Studio review in batches |
| **Player** | Dual subtitles, clickable transcript, per-word highlight sync, adjustable font sizes |
| **Export** | Burn subtitles into MP4 via ffmpeg (CRF 18, audio copied losslessly) |
| **Model manager** | In-app Hugging Face download UI with live progress |

Supported spoken languages depend on the ASR engine (Qwen supports a fixed set; Whisper is broader). Translation pairs depend on the backend — Helsinki requires a pre-trained `opus-mt-{src}-{tgt}` model for each direction.

---

## Example Output + UI

![UI](assets/UI.png)

https://github.com/user-attachments/assets/3b2deb8f-3903-41ce-b451-d06bd67da0cd

<sub><i>Original video on YouTube: https://www.youtube.com/watch?v=YsJCXFOgvMM</i></sub>

---

## How it works

```
YouTube URL / file upload
        │
        ▼
  yt-dlp (bestvideo+bestaudio) + ffmpeg ──► source.mp4 + 16 kHz mono WAV
        │
        ▼
  ASR engine (Qwen3-ASR + aligner  OR  Whisper)
        │  word-level timestamps on the source line
        ▼
  Cue segmentation (max chars / duration / pause gap)
        │
        ▼
  asr.unload()  ──►  free GPU VRAM
        │
        ▼
  Translation backend (Helsinki / Hunyuan / TranslateGemma)
        │  batched by translate_batch_size (default 16)
        ▼
  Optional QC (back-translate + LM Studio, batched)
        │
        ▼
  cues.json + subtitles.ass ──► web player / ffmpeg burn-in export
```

The **spoken language** line gets real word timings from the ASR engine. The **translated** line timings are approximated by distributing each cue's duration across its words proportionally to character length.

---

## ASR engines

### Qwen3-ASR (default)

Best choice when you want the highest-quality word alignment for karaoke highlighting on less common languages Qwen supports.

| Setting | Options |
|---|---|
| ASR model | `Qwen/Qwen3-ASR-1.7B`, `Qwen/Qwen3-ASR-0.6B`, and `-hf` weight variants |
| Forced aligner | `Qwen/Qwen3-ForcedAligner-0.6B` (required for word timestamps) |
| Source language | ISO code (e.g. `sv`, `en`, `de`) or auto-detect |

Use matching `-hf` variants together when selecting HF weight layouts.

### Whisper

Alternative engine via the Hugging Face `transformers` ASR pipeline. No separate forced aligner is needed — Whisper produces word timestamps directly.

| Setting | Options |
|---|---|
| Presets | `openai/whisper-small`, `openai/whisper-medium`, `openai/whisper-large-v3` |
| Custom model | Any Hugging Face repo id (e.g. `KBLab/kb-whisper-large`) |
| Source language | ISO code passed to Whisper; omit / use auto for language detection |
| Chunking | 30-second chunks for long audio |

Whisper large-v3 is the default preset and offers the best accuracy at the cost of more VRAM.

---

## Translation backends

| Backend | Model | Speed | Notes |
|---|---|---|---|
| **helsinki** (default) | `Helsinki-NLP/opus-mt-{src}-{tgt}` | Fast | One HF model per language direction; best for common pairs |
| **hunyuan** | `tencent/Hy-MT2-1.8B` | Slower | Instruction-tuned LLM; works across many language pairs |
| **translategemma** | `google/translategemma-4b-it` | Slower | Google's instruction translation model |

All backends translate subtitle cues in **batches** (configurable via `translate_batch_size`, default 16). Larger batches are faster on GPU but use more VRAM — reduce if you hit out-of-memory errors.

### Optional quality control

When enabled, each translation is back-translated to the source language, then an LM Studio LLM compares the original with the back-translation and suggests corrections where meaning diverged. Requests are sent in small batches (`qc_batch_size`, default 8) to stay within context limits.

LM Studio's native chat API is used (`POST /api/v1/chat`). A small model such as `liquid/lfm2.5-1.2b` is a reliable choice.

---

## Video quality

### YouTube download

yt-dlp selects the highest available quality:

- Format: `bestvideo*+bestaudio/best` (separate streams merged when possible)
- Sort priority: resolution → fps → HDR → codec → bitrate
- Container: MP4 (browser-compatible for in-app preview; streams are remuxed without re-encoding when codecs allow)

### Subtitle burn-in export

Burning ASS subtitles requires re-encoding the video track. Export uses:

- **Video:** `libx264 -preset slow -crf 18` (visually near-lossless)
- **Audio:** copied unchanged (`-c:a copy`)
- **Container:** MP4 with `faststart` for streaming/seeking

The source video in the player is the original downloaded/uploaded file; only the exported MP4 is re-encoded.

---

## Requirements

| Component | Version / notes |
|---|---|
| **Python** | 3.10+ |
| **[uv](https://docs.astral.sh/uv/)** | Recommended package manager for the backend |
| **Node.js** | 18+ (frontend) |
| **ffmpeg** | Must be on `PATH` (audio extract + subtitle burn-in) |
| **[Deno](https://docs.deno.com/runtime/getting_started/installation/)** | Required for YouTube downloads via yt-dlp (JS challenge solving) |
| **GPU** | NVIDIA CUDA strongly recommended (ASR + translation models are heavy) |
| **LM Studio** | Optional — local LLM server for translation quality control |

### VRAM guidance (approximate)

| Component | VRAM |
|---|---|
| Qwen3-ASR 1.7B + aligner | ~4–6 GB |
| Whisper large-v3 | ~3–5 GB |
| Helsinki opus-mt | ~0.5 GB |
| Hunyuan / TranslateGemma | ~4–8 GB |

Only one heavy model stage runs at a time — ASR is unloaded before translation loads.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/dualsub.git
cd dualsub
```

### 2. Backend

```bash
cd backend

# Create virtualenv and install dependencies (PyTorch CUDA 11.8 via pyproject.toml)
uv sync

# Start the API server
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Alternative without uv:

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The API listens on **http://localhost:8000**.

### 3. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` (including WebSockets) to the backend on port 8000.

> **Important:** Use the frontend at port **5173**, not port 8000 directly.

### 4. Download models

Before your first job, open the app and click **Downloaded models**, or let the app auto-download required models when you submit a job.

**Default Qwen job** expects:

- `Qwen/Qwen3-ASR-1.7B`
- `Qwen/Qwen3-ForcedAligner-0.6B`
- `Helsinki-NLP/opus-mt-{src}-{tgt}`

**Default Whisper job** expects:

- `openai/whisper-large-v3` (or your chosen preset / custom model)
- `Helsinki-NLP/opus-mt-{src}-{tgt}`

Models are cached by Hugging Face Hub after the first download.

---

## Usage

1. Paste a **YouTube URL** or **upload** a video/audio file.
2. Select **spoken language** and **translation language**.
3. Expand **Advanced settings**:
   - Choose **ASR engine**: Qwen3-ASR or Whisper.
   - **Qwen:** pick ASR model and forced aligner.
   - **Whisper:** pick a preset (small / medium / large) or enter a custom Hugging Face model name.
   - Pick a **translation engine** and optionally adjust **translation batch size**.
   - Optionally enable **quality control** and set your LM Studio URL / model name.
   - Adjust subtitle font sizes in the player settings panel.
4. Click **Generate dual subtitles**. Progress shows the selected model names (e.g. `Transcribing (whisper-large-v3)`, `Translating (Helsinki)`).
5. Play the video with dual subtitles and karaoke highlighting.
6. Click **Export burned-in video** to produce a high-quality MP4, then **Download MP4**.

---

## Configuration

### Environment variables

Prefix: `SUBTITLE_`. Can also be set in `backend/.env`.

| Variable | Default | Description |
|---|---|---|
| `SUBTITLE_DEVICE` | `cuda:0` | Torch device for inference |
| `SUBTITLE_TORCH_DTYPE` | `bfloat16` | Model dtype (`bfloat16`, `float16`, `float32`) |
| `SUBTITLE_MOCK_MODELS` | unset | Set to `1` / `true` to run with mock ASR/translation (no GPU, for UI testing) |
| `SUBTITLE_DATA_DIR` | `backend/data` | Job artifacts and cache directory |

### Job-level options

Set via the web form or `POST /api/jobs` (`multipart/form-data`):

| Parameter | Default | Description |
|---|---|---|
| `source_url` | — | YouTube URL (provide this or `file`) |
| `file` | — | Uploaded media file |
| `source_lang` | `sv` | ISO 639-1 code of spoken language |
| `target_lang` | `en` | ISO 639-1 code of translation language |
| `asr_engine` | `qwen` | `qwen` or `whisper` |
| `asr_model` | `Qwen/Qwen3-ASR-1.7B` | Qwen ASR repo id (ignored when engine is whisper) |
| `forced_aligner_model` | `Qwen/Qwen3-ForcedAligner-0.6B` | Qwen aligner repo id (ignored when engine is whisper) |
| `whisper_model` | `openai/whisper-large-v3` | Whisper preset or custom HF repo id |
| `translator_backend` | `helsinki` | `helsinki`, `hunyuan`, or `translategemma` |
| `translate_batch_size` | `16` | Cues per translation batch (1–128) |
| `qc_enabled` | `false` | Enable LM Studio quality control |
| `lmstudio_url` | `http://localhost:1234/v1` | LM Studio base URL |
| `lmstudio_model` | `local-model` | Model name loaded in LM Studio |

### Supported languages (UI)

`sv`, `en`, `de`, `fr`, `es`, `it`, `nl`, `da`, `no`, `fi`, `pt`, `pl`, `ru`, `tr`, `ar`, `zh`, `ja`, `ko`

Whisper supports many more languages beyond this list when given the correct ISO code.

---

## API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/languages` | Supported language codes |
| `GET` | `/api/asr-models` | Qwen, aligner, and Whisper model lists |
| `GET` | `/api/models` | All registered models with download status |
| `POST` | `/api/models/ensure-for-job` | Pre-download models required for a job config |
| `POST` | `/api/models/{id}/download` | Start downloading a model |
| `WS` | `/api/models/{id}/download/progress` | Live download progress |
| `POST` | `/api/jobs` | Create and start a pipeline job |
| `GET` | `/api/jobs/{id}` | Job status, progress, config |
| `GET` | `/api/jobs/{id}/cues` | Subtitle cues JSON |
| `GET` | `/api/jobs/{id}/media` | Source video stream |
| `POST` | `/api/jobs/{id}/export` | Burn subtitles into MP4 |
| `GET` | `/api/jobs/{id}/export` | Download exported MP4 |
| `WS` | `/api/jobs/{id}/progress` | Live pipeline progress |

### Job artifacts

Each job writes to `backend/data/jobs/{job_id}/`:

| File | Description |
|---|---|
| `source.mp4` | Downloaded or uploaded media |
| `audio.wav` | 16 kHz mono audio for ASR |
| `cues.json` | Subtitle cues with word timings |
| `subtitles.ass` | ASS file with karaoke tags |
| `export.mp4` | Burned-in export (after export step) |
| `job.json` | Job metadata and config snapshot |

---

## Project structure

```
dualsub/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI routes
│   │   ├── config.py            # PipelineConfig, Settings, model lists
│   │   ├── jobs.py              # Job manager, pipeline orchestration
│   │   ├── models.py            # Job, Cue, Word pydantic models
│   │   ├── model_downloads.py   # HF model registry & downloads
│   │   └── pipeline/
│   │       ├── ingest.py        # yt-dlp download, ffmpeg audio extract
│   │       ├── asr.py           # Qwen + Whisper transcription, GPU unload
│   │       ├── segment.py       # Word → subtitle cue segmentation
│   │       ├── translate.py     # Helsinki / Hunyuan / TranslateGemma
│   │       ├── qc.py            # Optional LM Studio quality check
│   │       └── subtitles.py     # ASS generation, ffmpeg burn-in
│   ├── data/jobs/               # Per-job artifacts (gitignored)
│   ├── pyproject.toml
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── App.tsx              # Main layout, progress, player
│       ├── api.ts               # Backend client
│       ├── components/
│       │   ├── JobForm.tsx      # Job creation form
│       │   ├── Player.tsx       # Video player + subtitle overlay
│       │   └── ModelsModal.tsx  # Model download manager
│       └── hooks/
│           └── useSubtitleFontSettings.ts
├── assets/
└── README.md
```

---

## Troubleshooting

### Backend not reachable

Start the backend and use the frontend at **http://localhost:5173**:

```bash
cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
cd frontend && npm run dev
```

### YouTube download warnings or failures

- Install **Deno** and ensure it is on `PATH` (yt-dlp uses it for YouTube JS challenges).
- Warnings about "GVS PO Token" or "SABR-only streaming" are usually non-fatal — yt-dlp falls back to other formats.
- Update yt-dlp: `uv pip install -U yt-dlp` in the backend venv.

### CUDA out of memory

- Use a smaller ASR model (Qwen 0.6B or Whisper small/medium).
- Reduce `translate_batch_size` (e.g. 4 or 8).
- ASR is already unloaded before translation; if OOM persists during translation, switch to Helsinki (lightest backend).

### Whisper custom model not found

Enter the full Hugging Face repo id (e.g. `KBLab/kb-whisper-large`). The model manager will auto-download it on first use.

### Export takes a long time

Burn-in uses `-preset slow -crf 18` for quality. Long videos at high resolution will take several minutes. Audio is not re-encoded.

---

## Development

**Backend with mock models (no GPU):**

```bash
cd backend
# Linux / macOS
SUBTITLE_MOCK_MODELS=1 uv run uvicorn app.main:app --reload

# Windows PowerShell
$env:SUBTITLE_MOCK_MODELS="1"; uv run uvicorn app.main:app --reload
```

**Frontend production build:**

```bash
cd frontend
npm run build
npm run preview
```

---

## Acknowledgements

- [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) — speech recognition and forced alignment
- [OpenAI Whisper](https://github.com/openai/whisper) / [Hugging Face transformers](https://huggingface.co/docs/transformers) — alternative ASR engine
- [Helsinki-NLP opus-mt](https://huggingface.co/Helsinki-NLP) — fast neural machine translation
- [Hunyuan MT](https://huggingface.co/tencent/Hy-MT2-1.8B) — LLM translation backend
- [TranslateGemma](https://huggingface.co/google/translategemma-4b-it) — Google instruction translation model
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — media ingestion
- [LM Studio](https://lmstudio.ai/) — optional local LLM quality control

---

## License

MIT — see [LICENSE](LICENSE).
