"""Extract or store reference audio for voice-cloning TTS backends."""
from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from .asr import AsrWord

logger = logging.getLogger(__name__)

MIN_REF_SEC = 3.0
MAX_REF_SEC = 15.0
MAX_GAP_SEC = 0.45


@dataclass
class VoiceReference:
    audio_path: Path
    text: str


def _require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH.")
    return exe


def _best_segment(words: List[AsrWord]) -> tuple[float, float, str]:
    """Pick the longest continuous speech run within MIN/MAX duration."""
    if not words:
        raise ValueError("No ASR words available for reference extraction.")

    best_start = words[0].start
    best_end = words[0].end
    best_text = words[0].w
    best_dur = best_end - best_start

    run_start = words[0].start
    run_words: List[str] = [words[0].w]
    run_end = words[0].end

    def score_run(start: float, end: float, text: str) -> float:
        dur = end - start
        if dur < MIN_REF_SEC:
            return dur
        if dur > MAX_REF_SEC:
            return MAX_REF_SEC - (dur - MAX_REF_SEC) * 0.5
        return dur + len(text.split()) * 0.05

    best_score = score_run(best_start, best_end, best_text)

    for word in words[1:]:
        gap = word.start - run_end
        if gap > MAX_GAP_SEC:
            dur = run_end - run_start
            text = " ".join(run_words)
            sc = score_run(run_start, run_end, text)
            if sc > best_score:
                best_score = sc
                best_start, best_end, best_text = run_start, run_end, text
                best_dur = dur
            run_start = word.start
            run_words = [word.w]
            run_end = word.end
            continue
        run_words.append(word.w)
        run_end = word.end
        dur = run_end - run_start
        if dur >= MIN_REF_SEC:
            text = " ".join(run_words)
            sc = score_run(run_start, run_end, text)
            if sc > best_score:
                best_score = sc
                best_start, best_end, best_text = run_start, run_end, text
                best_dur = dur

    dur = run_end - run_start
    text = " ".join(run_words)
    sc = score_run(run_start, run_end, text)
    if sc > best_score:
        best_start, best_end, best_text = run_start, run_end, text
        best_dur = dur

    if best_dur < 1.0:
        best_start = words[0].start
        best_end = min(words[-1].end, words[0].start + MAX_REF_SEC)
        best_text = " ".join(w.w for w in words if w.start < best_end)

    end = min(best_end, best_start + MAX_REF_SEC)
    return best_start, end, best_text.strip()


def extract_from_audio(
    wav_path: Path,
    words: List[AsrWord],
    out_path: Path,
) -> VoiceReference:
    start, end, text = _best_segment(words)
    ffmpeg = _require_ffmpeg()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-y",
        "-ss",
        str(start),
        "-i",
        str(wav_path),
        "-t",
        str(max(end - start, 0.5)),
        "-ac",
        "1",
        "-ar",
        "24000",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg reference clip failed:\n{proc.stderr[-2000:]}")
    logger.info("Reference clip %.2f–%.2fs (%d chars)", start, end, len(text))
    return VoiceReference(audio_path=out_path, text=text)


def prepare_reference(
    job_dir: Path,
    wav_path: Path,
    words: List[AsrWord],
    *,
    voice_mode: str,
    ref_text: str,
    upload_path: Optional[Path] = None,
    voice_clone_x_vector_only: bool = False,
) -> Optional[VoiceReference]:
    """Return a voice reference for cloning backends, or None for preset-only engines."""
    out = job_dir / "ref_clip.wav"
    if voice_mode == "clone_upload":
        if upload_path is None or not upload_path.exists():
            raise ValueError("Voice mode is clone_upload but no reference audio was provided.")
        shutil.copy2(upload_path, out)
        text = ref_text.strip()
        if not text and not voice_clone_x_vector_only:
            raise ValueError("Reference transcript (ref_text) is required for uploaded voice clips.")
        return VoiceReference(audio_path=out, text=text)

    if voice_mode == "clone_video":
        ref = extract_from_audio(wav_path, words, out)
        if ref_text.strip():
            ref = VoiceReference(audio_path=ref.audio_path, text=ref_text.strip())
        return ref

    return None
