"""Synthesize dubbed speech aligned to subtitle cue timestamps."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List

import numpy as np
import soundfile as sf

from ..config import PipelineConfig, settings
from ..models import Cue
from .tts import TARGET_SR, TtsEngine, build_voice_config, get_tts_engine
from .voice_ref import VoiceReference

logger = logging.getLogger(__name__)

MAX_STRETCH = 1.4


def _resample(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr or len(audio) == 0:
        return audio
    try:
        import librosa

        return librosa.resample(audio, orig_sr=orig_sr, target_sr=target_sr)
    except Exception:
        ratio = target_sr / orig_sr
        n = max(1, int(len(audio) * ratio))
        x_old = np.linspace(0, 1, len(audio))
        x_new = np.linspace(0, 1, n)
        return np.interp(x_new, x_old, audio).astype(np.float32)


def _fit_duration(audio: np.ndarray, sr: int, target_sec: float) -> np.ndarray:
    if target_sec <= 0:
        return np.zeros(0, dtype=np.float32)
    target_samples = max(1, int(target_sec * sr))
    if len(audio) == 0:
        return np.zeros(target_samples, dtype=np.float32)
    current = len(audio) / sr
    if current <= target_sec:
        pad = target_samples - len(audio)
        return np.pad(audio, (0, pad))
    ratio = current / target_sec
    if ratio <= MAX_STRETCH:
        try:
            import librosa

            stretched = librosa.effects.time_stretch(audio, rate=ratio)
            if len(stretched) > target_samples:
                return stretched[:target_samples].astype(np.float32)
            return np.pad(stretched, (0, target_samples - len(stretched))).astype(np.float32)
        except Exception:
            pass
    return audio[:target_samples].astype(np.float32)


def synthesize_timeline(
    cues: List[Cue],
    cfg: PipelineConfig,
    ref: VoiceReference | None,
    out_path: Path,
    engine: TtsEngine | None = None,
) -> Path:
    """Generate a mono WAV with dubbed speech placed at cue timestamps."""
    if not cues:
        raise ValueError("No cues to dub.")

    voice = build_voice_config(cfg, ref)
    tts = engine or get_tts_engine(cfg.tts_backend, cfg.tts_model)

    total_end = max(c.end for c in cues) + 0.5
    timeline = np.zeros(int(total_end * TARGET_SR) + TARGET_SR, dtype=np.float32)

    active_cues = [c for c in cues if c.target.text.strip()]
    if not active_cues:
        raise ValueError("No translated text available for dubbing.")

    use_batch = cfg.tts_backend == "qwen" and "CustomVoice" in cfg.tts_model
    if use_batch:
        texts = [c.target.text.strip() for c in active_cues]
        batch_size = 8
        synthesized: list[tuple[np.ndarray, int]] = []
        for i in range(0, len(texts), batch_size):
            chunk = texts[i : i + batch_size]
            synthesized.extend(tts.synthesize_batch(chunk, voice))
        for cue, (wav, sr) in zip(active_cues, synthesized):
            wav = _resample(wav, sr, TARGET_SR)
            fitted = _fit_duration(wav, TARGET_SR, cue.end - cue.start)
            start_sample = int(cue.start * TARGET_SR)
            end_sample = start_sample + len(fitted)
            if end_sample <= len(timeline):
                timeline[start_sample:end_sample] += fitted
    else:
        for cue in active_cues:
            text = cue.target.text.strip()
            wav, sr = tts.synthesize(text, voice)
            wav = _resample(wav, sr, TARGET_SR)
            fitted = _fit_duration(wav, TARGET_SR, cue.end - cue.start)
            start_sample = int(cue.start * TARGET_SR)
            end_sample = start_sample + len(fitted)
            if end_sample <= len(timeline):
                timeline[start_sample:end_sample] += fitted

    peak = np.max(np.abs(timeline))
    if peak > 1e-6:
        timeline = timeline / peak * 0.95

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), timeline, TARGET_SR)
    logger.info("Wrote dubbed vocals timeline to %s (%.1fs)", out_path, len(timeline) / TARGET_SR)
    return out_path
