"""FastAPI application exposing the dual-subtitle pipeline."""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .config import (
    ASR_MODELS,
    FORCED_ALIGNER_MODELS,
    HUNYUAN_MODELS,
    LANGUAGE_NAMES,
    NEMOTRON_MODELS,
    NLLB_MODELS,
    SUBTITLE_FONT_FAMILIES,
    WHISPER_MODELS,
    PipelineConfig,
    SubtitleStyleConfig,
    nemotron_locale,
    nemotron_tier,
    settings,
)
from .jobs import manager
from .logging_config import setup_logging, suppress_hf_progress_bars
from .model_downloads import download_manager, repos_for_job

setup_logging()
suppress_hf_progress_bars()
logger = logging.getLogger(__name__)

app = FastAPI(title="DualSub")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    started = time.perf_counter()
    logger.info("--> %s %s", request.method, request.url.path)
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("<-- %s %s failed", request.method, request.url.path)
        raise
    elapsed_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "<-- %s %s %s (%.0f ms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


@app.on_event("startup")
async def _startup() -> None:
    manager.bind_loop(asyncio.get_running_loop())
    download_manager.bind_loop(asyncio.get_running_loop())
    logger.info("DualSub API ready")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/models")
def list_models() -> dict:
    return {"models": download_manager.list_models()}


class HfAuthRequest(BaseModel):
    token: Optional[str] = None


@app.get("/api/models/hf-auth")
def get_hf_auth() -> dict:
    return download_manager.get_hf_auth_status()


@app.put("/api/models/hf-auth")
def set_hf_auth(body: HfAuthRequest) -> dict:
    try:
        return download_manager.set_hf_token(body.token)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


class EnsureJobModelsRequest(BaseModel):
    source_lang: str
    target_lang: str
    asr_model: str
    forced_aligner_model: str
    translator_backend: str
    qc_enabled: bool = False
    asr_engine: str = "qwen"
    whisper_model: str = "openai/whisper-large-v3"
    nemotron_model: str = "nvidia/nemotron-3.5-asr-streaming-0.6b"
    nllb_model: str = "facebook/nllb-200-distilled-600M"
    hunyuan_model: str = "tencent/HY-MT1.5-1.8B"


@app.post("/api/models/ensure-for-job")
def ensure_job_models(body: EnsureJobModelsRequest) -> dict:
    try:
        repos = repos_for_job(
            source_lang=body.source_lang,
            target_lang=body.target_lang,
            asr_model=body.asr_model,
            forced_aligner_model=body.forced_aligner_model,
            translator_backend=body.translator_backend,
            qc_enabled=body.qc_enabled,
            asr_engine=body.asr_engine,
            whisper_model=body.whisper_model,
            nemotron_model=body.nemotron_model,
            nllb_model=body.nllb_model,
            hunyuan_model=body.hunyuan_model,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    result = download_manager.ensure_repos(repos)
    logger.info(
        "Ensure job models: repos=%s started=%s waiting=%s",
        repos,
        result["started"],
        result["waiting"],
    )
    return {**result, "repos": repos}


@app.post("/api/models/{model_id}/download")
def download_model(model_id: str) -> dict:
    try:
        state = download_manager.start_download(model_id)
    except KeyError:
        raise HTTPException(404, f"Unknown model: {model_id}")
    return {
        "model_id": model_id,
        "status": state.status.value,
        "progress": state.progress,
        "message": state.message,
    }


@app.post("/api/models/download-required")
def download_required_models() -> dict:
    started = download_manager.start_required_downloads()
    return {"started": started}


@app.websocket("/api/models/{model_id}/download/progress")
async def model_download_progress(websocket: WebSocket, model_id: str) -> None:
    await websocket.accept()
    try:
        download_manager.validate_model_id(model_id)
    except KeyError:
        await websocket.close(code=1008)
        return

    queue = download_manager.subscribe(model_id)
    try:
        models = download_manager.list_models()
        current = next((m for m in models if m["id"] == model_id), None)
        if current:
            await websocket.send_json(current)
        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
            if payload["status"] in ("downloaded", "error"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        download_manager.unsubscribe(model_id, queue)


@app.get("/api/languages")
def languages() -> dict:
    nemotron_by_iso = {
        iso: {"locale": nemotron_locale(iso), "tier": nemotron_tier(iso)}
        for iso in LANGUAGE_NAMES
    }
    return {"languages": LANGUAGE_NAMES, "nemotron_by_iso": nemotron_by_iso}


@app.get("/api/asr-models")
def asr_models() -> dict:
    return {
        "asr_models": ASR_MODELS,
        "forced_aligner_models": FORCED_ALIGNER_MODELS,
        "whisper_models": WHISPER_MODELS,
        "nemotron_models": NEMOTRON_MODELS,
    }


@app.get("/api/translation-models")
def translation_models() -> dict:
    return {"nllb_models": NLLB_MODELS, "hunyuan_models": HUNYUAN_MODELS}


@app.get("/api/subtitle-fonts")
def subtitle_fonts() -> dict:
    return {"fonts": SUBTITLE_FONT_FAMILIES}


def _parse_subtitle_style(raw: Optional[str]) -> SubtitleStyleConfig:
    if not raw:
        return SubtitleStyleConfig()
    try:
        return SubtitleStyleConfig.model_validate(json.loads(raw))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Invalid subtitle_style JSON: {exc}")


@app.post("/api/jobs")
async def create_job(
    source_url: Optional[str] = Form(None),
    source_lang: str = Form("sv"),
    target_lang: str = Form("en"),
    asr_engine: str = Form("qwen"),
    asr_model: str = Form("Qwen/Qwen3-ASR-1.7B"),
    forced_aligner_model: str = Form("Qwen/Qwen3-ForcedAligner-0.6B"),
    whisper_model: str = Form("openai/whisper-large-v3"),
    nemotron_model: str = Form("nvidia/nemotron-3.5-asr-streaming-0.6b"),
    translator_backend: str = Form("helsinki"),
    nllb_model: str = Form("facebook/nllb-200-distilled-600M"),
    hunyuan_model: str = Form("tencent/HY-MT1.5-1.8B"),
    translate_batch_size: int = Form(16),
    qc_enabled: bool = Form(False),
    lmstudio_url: str = Form("http://localhost:1234/v1"),
    lmstudio_model: str = Form("local-model"),
    subtitle_style: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
) -> dict:
    if not source_url and file is None:
        raise HTTPException(400, "Provide either source_url or an uploaded file.")

    if translator_backend == "helsinki":
        from .helsinki_models import resolve_helsinki_repo

        try:
            resolve_helsinki_repo(source_lang, target_lang)
            if qc_enabled:
                resolve_helsinki_repo(target_lang, source_lang)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    asr_label = {
        "whisper": whisper_model,
        "nemotron": nemotron_model,
    }.get(asr_engine, asr_model)

    logger.info(
        "Creating job: source_url=%s file=%s lang=%s->%s engine=%s asr=%s",
        source_url or "(none)",
        file.filename if file else "(none)",
        source_lang,
        target_lang,
        asr_engine,
        asr_label,
    )

    config = PipelineConfig(
        source_lang=source_lang,
        target_lang=target_lang,
        asr_engine=asr_engine,  # type: ignore[arg-type]
        asr_model=asr_model,
        forced_aligner_model=forced_aligner_model,
        whisper_model=whisper_model,
        nemotron_model=nemotron_model,
        translator_backend=translator_backend,  # type: ignore[arg-type]
        nllb_model=nllb_model,
        hunyuan_model=hunyuan_model,
        translate_batch_size=translate_batch_size,
        qc_enabled=qc_enabled,
        lmstudio_url=lmstudio_url,
        lmstudio_model=lmstudio_model,
        subtitle_style=_parse_subtitle_style(subtitle_style),
    )
    job = manager.create_job(config, source_url=source_url or None)

    upload_path: Optional[Path] = None
    upload_name: Optional[str] = None
    if file is not None:
        upload_name = file.filename
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename or "").suffix)
        with tmp:
            shutil.copyfileobj(file.file, tmp)
        upload_path = Path(tmp.name)

    manager.start(job, upload_path=upload_path, upload_name=upload_name)
    logger.info("Job %s started (status=%s)", job.id, job.status.value)
    return {"job_id": job.id, "status": job.status.value}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "job_id": job.id,
        "status": job.status.value,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
        "media_filename": job.media_filename,
        "export_filename": job.export_filename,
        "config": job.config.model_dump(),
    }


@app.get("/api/jobs/{job_id}/cues")
def get_cues(job_id: str) -> JSONResponse:
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    cues = manager.load_cues(job_id)
    return JSONResponse([c.model_dump() for c in cues])


@app.get("/api/jobs/{job_id}/media")
def get_media(job_id: str):
    job = manager.get_job(job_id)
    if not job or not job.media_filename:
        raise HTTPException(404, "Media not found")
    path = manager.job_dir(job_id) / job.media_filename
    if not path.exists():
        raise HTTPException(404, "Media file missing")
    return FileResponse(path)


class ExportJobRequest(BaseModel):
    subtitle_style: Optional[dict] = None


@app.post("/api/jobs/{job_id}/export")
def export_job(job_id: str, body: Optional[ExportJobRequest] = None) -> dict:
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    style_override = None
    if body and body.subtitle_style:
        style_override = SubtitleStyleConfig.model_validate(body.subtitle_style)
    try:
        out = manager.export(job, subtitle_style=style_override)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc))
    return {"export_filename": out.name}


@app.get("/api/jobs/{job_id}/export")
def download_export(job_id: str):
    job = manager.get_job(job_id)
    if not job or not job.export_filename:
        raise HTTPException(404, "No export available")
    path = manager.job_dir(job_id) / job.export_filename
    if not path.exists():
        raise HTTPException(404, "Export file missing")
    return FileResponse(path, filename=f"{job_id}_subtitled.mp4")


@app.websocket("/api/jobs/{job_id}/progress")
async def progress_ws(websocket: WebSocket, job_id: str) -> None:
    await websocket.accept()
    job = manager.get_job(job_id)
    if not job:
        await websocket.close(code=1008)
        return
    queue = manager.subscribe(job_id)
    try:
        await websocket.send_json(
            {
                "job_id": job.id,
                "status": job.status.value,
                "progress": job.progress,
                "message": job.message,
            }
        )
        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
            if payload["status"] in ("done", "error"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.unsubscribe(job_id, queue)
