"""Separate vocals from accompaniment, mix dubbed speech, mux with video."""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

TARGET_SR = 24000


def _require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH.")
    return exe


def _load_mono(path: Path, target_sr: int = TARGET_SR) -> np.ndarray:
    data, sr = sf.read(str(path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != target_sr:
        try:
            import librosa

            data = librosa.resample(data, orig_sr=sr, target_sr=target_sr)
        except Exception:
            ratio = target_sr / sr
            n = max(1, int(len(data) * ratio))
            x_old = np.linspace(0, 1, len(data))
            x_new = np.linspace(0, 1, n)
            data = np.interp(x_new, x_old, data).astype(np.float32)
    return np.asarray(data, dtype=np.float32)


def separate_accompaniment(
    wav_path: Path,
    job_dir: Path,
    *,
    keep_background: bool = True,
) -> tuple[np.ndarray, int]:
    """Return accompaniment stem (no vocals) at TARGET_SR. On failure, returns silence."""
    vocals_path = job_dir / "vocals_orig.wav"
    accomp_path = job_dir / "accompaniment.wav"

    if not keep_background:
        dur_samples = len(_load_mono(wav_path))
        return np.zeros(dur_samples, dtype=np.float32), TARGET_SR

    try:
        import torch
        import torchaudio
        from demucs.apply import apply_model
        from demucs.pretrained import get_model

        model = get_model("htdemucs")
        model.eval()
        wav, sr = torchaudio.load(str(wav_path))
        if wav.shape[0] > 1:
            wav = wav.mean(dim=0, keepdim=True)
        ref_sr = model.samplerate
        if sr != ref_sr:
            wav = torchaudio.functional.resample(wav, sr, ref_sr)
        with torch.no_grad():
            sources = apply_model(model, wav[None], device="cpu", progress=False)[0]
        # sources: drums, bass, other, vocals
        vocals = sources[3].numpy()
        accomp = sources[0].numpy() + sources[1].numpy() + sources[2].numpy()
        vocals_mono = vocals.mean(axis=0).astype(np.float32)
        accomp_mono = accomp.mean(axis=0).astype(np.float32)
        sf.write(str(vocals_path), vocals_mono, ref_sr)
        sf.write(str(accomp_path), accomp_mono, ref_sr)
        if ref_sr != TARGET_SR:
            try:
                import librosa

                accomp_mono = librosa.resample(accomp_mono, orig_sr=ref_sr, target_sr=TARGET_SR)
            except Exception:
                pass
        logger.info("Demucs separation complete")
        return accomp_mono.astype(np.float32), TARGET_SR
    except Exception as exc:
        logger.warning("Demucs separation failed (%s); using full audio replacement fallback", exc)
        return np.zeros(0, dtype=np.float32), TARGET_SR


def mix_dubbed(
    dubbed_vocals_path: Path,
    accompaniment: np.ndarray,
    out_path: Path,
    original_wav: Path | None = None,
) -> Path:
    """Mix dubbed vocals with accompaniment (or use dubbed only as fallback)."""
    dubbed = _load_mono(dubbed_vocals_path, TARGET_SR)
    if len(accompaniment) == 0:
        mixed = dubbed
    else:
        n = max(len(dubbed), len(accompaniment))
        d = np.pad(dubbed, (0, n - len(dubbed)))
        a = np.pad(accompaniment, (0, n - len(accompaniment)))
        mixed = d + a * 0.85

    peak = np.max(np.abs(mixed))
    if peak > 1e-6:
        mixed = mixed / peak * 0.98

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), mixed, TARGET_SR)
    return out_path


def mux_audio(media_path: Path, audio_wav: Path, out_path: Path) -> Path:
    """Replace video audio track with dubbed WAV."""
    ffmpeg = _require_ffmpeg()
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(media_path),
        "-i",
        str(audio_wav),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg mux failed:\n{proc.stderr[-2000:]}")
    return out_path
