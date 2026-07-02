"""Render subtitles matching the web SubtitleOverlay preview, then burn into video."""
from __future__ import annotations

import platform
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from ..config import SubtitleStyleConfig, TrackStyle, settings
from ..models import Cue, Line, Word
from .subtitles import (
    PREVIEW_BOTTOM_PAD_PX,
    PREVIEW_BOX_PAD_X_PX,
    PREVIEW_BOX_PAD_Y_PX,
    PREVIEW_CONTAINER_PAD_PX,
    PREVIEW_TRACK_GAP_PX,
    _scale_preview_px,
    probe_video_size,
)

# Tailwind classes used in SubtitleOverlay.tsx
PREVIEW_ROUNDED_RADIUS_PX = 12  # rounded-xl
PREVIEW_BLUR_RADIUS_PX = 4  # backdrop-blur-sm
PREVIEW_LINE_HEIGHT = 1.375  # leading-snug
PREVIEW_GLOW_RADIUS_PX = 14

_WINDOWS_FONT_FILES = {
    "arial": ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"),
    "calibri": ("calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"),
    "segoe ui": ("segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf"),
    "tahoma": ("tahoma.ttf", "tahomabd.ttf", None, None),
    "verdana": ("verdana.ttf", "verdanab.ttf", "verdanai.ttf", "verdanaz.ttf"),
    "times new roman": ("times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"),
    "courier new": ("cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"),
}


@dataclass
class _RenderedLine:
    words: List[Tuple[str, str, bool]]  # text, #RRGGBB, active
    width: float
    height: float


@dataclass
class _TrackBox:
    x0: int
    y0: int
    x1: int
    y1: int
    lines: List[_RenderedLine]


def _hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        return 255, 255, 255
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
    )


def _find_cue(cues: List[Cue], time: float) -> Optional[Cue]:
    for cue in cues:
        if cue.start <= time <= cue.end:
            return cue
    return None


def _resolve_font_path(family: str, *, bold: bool, italic: bool) -> Optional[Path]:
    key = family.strip().lower()
    files = _WINDOWS_FONT_FILES.get(key)
    if files is None:
        safe = key.replace(" ", "")
        files = (f"{safe}.ttf", f"{safe}bd.ttf", f"{safe}i.ttf", f"{safe}bi.ttf")
    idx = (1 if bold else 0) + (2 if italic else 0)
    filename = files[idx] or files[0]
    if filename is None:
        return None
    if platform.system() == "Windows":
        path = Path("C:/Windows/Fonts") / filename
        if path.exists():
            return path
    return None


def _load_font(track: TrackStyle, size_px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = _resolve_font_path(track.font_family, bold=track.bold, italic=track.italic)
    if path is not None:
        try:
            return ImageFont.truetype(str(path), size=size_px)
        except OSError:
            pass
    return ImageFont.load_default()


def _word_color(word: Word, time: float, track: TrackStyle) -> str:
    if time >= word.start and time < word.end:
        return track.karaoke_active_color
    if time >= word.end:
        return track.karaoke_done_color
    return track.color


def _line_words(line: Line) -> List[Word]:
    if line.words:
        return line.words
    return [Word(w=line.text, start=0.0, end=0.0)]


def _wrap_word_groups(
    words: List[Word],
    font: ImageFont.ImageFont,
    max_text_width: float,
    draw: ImageDraw.ImageDraw,
) -> List[List[Word]]:
    groups: List[List[Word]] = []
    current: List[Word] = []
    for word in words:
        trial = current + [word]
        text = " ".join(w.w for w in trial)
        width = draw.textlength(text, font=font)
        if current and width > max_text_width:
            groups.append(current)
            current = [word]
        else:
            current = trial
    if current:
        groups.append(current)
    return groups or [[]]


def _render_track_lines(
    line: Line,
    time: float,
    track: TrackStyle,
    font: ImageFont.ImageFont,
    font_size: int,
    max_text_width: float,
    draw: ImageDraw.ImageDraw,
) -> List[_RenderedLine]:
    words = _line_words(line)
    groups = _wrap_word_groups(words, font, max_text_width, draw)
    rendered: List[_RenderedLine] = []
    line_height = font_size * PREVIEW_LINE_HEIGHT
    for group in groups:
        parts: List[Tuple[str, str, bool]] = []
        total = 0.0
        for i, word in enumerate(group):
            prefix = "" if i == 0 else " "
            token = prefix + word.w
            active = time >= word.start and time < word.end
            color = _word_color(word, time, track)
            parts.append((token, color, active))
            total += draw.textlength(token, font=font)
        rendered.append(_RenderedLine(words=parts, width=total, height=line_height))
    return rendered


def _layout_track_boxes(
  play_res_x: int,
  play_res_y: int,
  source_lines: List[_RenderedLine],
  target_lines: List[_RenderedLine],
  source_pad_x: int,
  source_pad_y: int,
  target_pad_x: int,
  target_pad_y: int,
) -> Tuple[_TrackBox, _TrackBox]:
    container_pad = _scale_preview_px(PREVIEW_CONTAINER_PAD_PX, play_res_y)
    gap = _scale_preview_px(PREVIEW_TRACK_GAP_PX, play_res_y)
    bottom_pad = _scale_preview_px(PREVIEW_BOTTOM_PAD_PX, play_res_y)
    track_max = int((play_res_x - 2 * container_pad) * 0.95)

    def box_for(lines: List[_RenderedLine], pad_x: int, pad_y: int) -> Tuple[int, int, int, int]:
        text_w = max((line.width for line in lines), default=0.0)
        text_h = sum(line.height for line in lines) or 0.0
        box_w = min(track_max, int(text_w) + 2 * pad_x)
        box_h = int(text_h) + 2 * pad_y
        x0 = (play_res_x - box_w) // 2
        return x0, box_w, box_h

    tx0, tw, th = box_for(target_lines, target_pad_x, target_pad_y)
    ty1 = play_res_y - bottom_pad
    ty0 = ty1 - th
    target_box = _TrackBox(tx0, ty0, tx0 + tw, ty1, target_lines)

    sx0, sw, sh = box_for(source_lines, source_pad_x, source_pad_y)
    sy1 = ty0 - gap
    sy0 = sy1 - sh
    source_box = _TrackBox(sx0, sy0, sx0 + sw, sy1, source_lines)

    return source_box, target_box


def _apply_backdrop_blur(frame: Image.Image, box: _TrackBox, radius: int) -> None:
    if radius <= 0:
        return
    x0, y0, x1, y1 = box.x0, box.y0, box.x1, box.y1
    region = frame.crop((x0, y0, x1, y1))
    blurred = region.filter(ImageFilter.GaussianBlur(radius=radius))
    frame.paste(blurred, (x0, y0))


def _apply_backdrop_blur_to_overlay(
    overlay: Image.Image,
    source: Image.Image,
    box: _TrackBox,
    radius: int,
) -> None:
    if radius <= 0:
        return
    x0, y0, x1, y1 = box.x0, box.y0, box.x1, box.y1
    region = source.crop((x0, y0, x1, y1))
    blurred = region.filter(ImageFilter.GaussianBlur(radius=radius)).convert("RGBA")
    overlay.paste(blurred, (x0, y0))


def _draw_track_box(
    frame: Image.Image,
    box: _TrackBox,
    track: TrackStyle,
    font: ImageFont.ImageFont,
    *,
    radius: int,
    blur_radius: int,
    source: Optional[Image.Image] = None,
) -> None:
    opacity = max(0.0, min(1.0, track.background_opacity))
    if opacity > 0:
        if source is not None:
            _apply_backdrop_blur_to_overlay(frame, source, box, blur_radius)
        else:
            _apply_backdrop_blur(frame, box, blur_radius)
        tint = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        tint_draw = ImageDraw.Draw(tint)
        alpha = int(opacity * 255)
        tint_draw.rounded_rectangle(
            (box.x0, box.y0, box.x1, box.y1),
            radius=radius,
            fill=(0, 0, 0, alpha),
        )
        frame.alpha_composite(tint)

    draw = ImageDraw.Draw(frame)
    pad_y = _scale_preview_px(PREVIEW_BOX_PAD_Y_PX, frame.height)
    y = box.y0 + pad_y
    cx = (box.x0 + box.x1) / 2
    glow_radius = max(1, _scale_preview_px(PREVIEW_GLOW_RADIUS_PX, frame.height))
    for line in box.lines:
        x = cx - line.width / 2
        for token, color, active in line.words:
            rgb = _hex_to_rgb(color)
            if active:
                glow = _hex_to_rgb(track.karaoke_active_color)
                glow_img = Image.new("RGBA", frame.size, (0, 0, 0, 0))
                glow_draw = ImageDraw.Draw(glow_img)
                glow_draw.text((x, y), token, font=font, fill=(*glow, 136))
                glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=glow_radius))
                frame.alpha_composite(glow_img)
            draw.text((x, y), token, font=font, fill=(*rgb, 255))
            x += draw.textlength(token, font=font)
        y += line.height


def _layout_cue_boxes(
    frame: Image.Image,
    cue: Cue,
    style: SubtitleStyleConfig,
    time: float,
) -> Tuple[_TrackBox, _TrackBox, ImageFont.ImageFont, ImageFont.ImageFont, int, int]:
    play_res_x, play_res_y = frame.size
    draw = ImageDraw.Draw(Image.new("RGBA", frame.size))

    source_font_px = _scale_preview_px(style.source.font_size, play_res_y)
    target_font_px = _scale_preview_px(style.target.font_size, play_res_y)
    source_font = _load_font(style.source, source_font_px)
    target_font = _load_font(style.target, target_font_px)

    container_pad = _scale_preview_px(PREVIEW_CONTAINER_PAD_PX, play_res_y)
    source_pad_x = _scale_preview_px(PREVIEW_BOX_PAD_X_PX, play_res_y)
    target_pad_x = source_pad_x
    source_pad_y = _scale_preview_px(PREVIEW_BOX_PAD_Y_PX, play_res_y)
    target_pad_y = source_pad_y
    track_max = int((play_res_x - 2 * container_pad) * 0.95)
    source_text_w = track_max - 2 * source_pad_x
    target_text_w = track_max - 2 * target_pad_x

    source_lines = _render_track_lines(
        cue.source, time, style.source, source_font, source_font_px, source_text_w, draw
    )
    target_lines = _render_track_lines(
        cue.target, time, style.target, target_font, target_font_px, target_text_w, draw
    )
    source_box, target_box = _layout_track_boxes(
        play_res_x,
        play_res_y,
        source_lines,
        target_lines,
        source_pad_x,
        source_pad_y,
        target_pad_x,
        target_pad_y,
    )
    radius = _scale_preview_px(PREVIEW_ROUNDED_RADIUS_PX, play_res_y)
    blur_radius = max(1, _scale_preview_px(PREVIEW_BLUR_RADIUS_PX, play_res_y))
    return source_box, target_box, source_font, target_font, radius, blur_radius


def render_overlay_frame(
    frame: Image.Image,
    cues: List[Cue],
    style: SubtitleStyleConfig,
    time: float,
) -> Image.Image:
    """Render blur/glow/text as a transparent RGBA overlay for ffmpeg compositing."""
    play_res_x, play_res_y = frame.size
    overlay = Image.new("RGBA", (play_res_x, play_res_y), (0, 0, 0, 0))
    cue = _find_cue(cues, time)
    if cue is None:
        return overlay

    source = frame.convert("RGB")
    source_box, target_box, source_font, target_font, radius, blur_radius = _layout_cue_boxes(
        source, cue, style, time
    )
    _draw_track_box(
        overlay,
        target_box,
        style.target,
        target_font,
        radius=radius,
        blur_radius=blur_radius,
        source=source,
    )
    _draw_track_box(
        overlay,
        source_box,
        style.source,
        source_font,
        radius=radius,
        blur_radius=blur_radius,
        source=source,
    )
    return overlay


def render_frame(
    frame: Image.Image,
    cues: List[Cue],
    style: SubtitleStyleConfig,
    time: float,
) -> Image.Image:
    """Composite preview-style subtitles onto a video frame."""
    overlay = render_overlay_frame(frame, cues, style, time)
    if overlay.getextrema()[3] == (0, 0):
        return frame
    base = frame.convert("RGBA")
    composed = Image.alpha_composite(base, overlay)
    return composed.convert("RGB")


def _probe_fps(path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 30.0
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=r_frame_rate,avg_frame_rate",
        "-of",
        "csv=p=0",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return 30.0
    rate = proc.stdout.strip().split("\n")[0].split(",")[0].strip()
    if "/" in rate:
        num, den = rate.split("/", 1)
        try:
            n, d = float(num), float(den)
            if d > 0:
                return n / d
        except ValueError:
            pass
    try:
        value = float(rate)
        if value > 0:
            return value
    except ValueError:
        pass
    return 30.0


def _probe_color_properties(path: Path) -> dict[str, str]:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return {}
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=color_primaries,color_transfer,color_space",
        "-of",
        "default=noprint_wrappers=1",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return {}
    props: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if value and value.lower() != "unknown":
            props[key] = value
    return props


def _build_encode_args(
    *,
    crf: int | None = None,
    preset: str | None = None,
    pix_fmt: str | None = None,
    color_props: Optional[dict[str, str]] = None,
) -> List[str]:
    crf = settings.export_crf if crf is None else crf
    preset = settings.export_preset if preset is None else preset
    pix_fmt = settings.export_pix_fmt if pix_fmt is None else pix_fmt
    args = [
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(crf),
        "-pix_fmt",
        pix_fmt,
        "-x264-params",
        "ref=6:bframes=8:aq-mode=3",
    ]
    color_props = color_props or {}
    if primaries := color_props.get("color_primaries"):
        args.extend(["-color_primaries", primaries])
    if transfer := color_props.get("color_transfer"):
        args.extend(["-color_trc", transfer])
    if space := color_props.get("color_space"):
        args.extend(["-colorspace", space])
    return args


def _escape_ffmpeg_path(path: Path) -> str:
    """Escape a filesystem path for use inside an ffmpeg filter argument."""
    resolved = path.resolve().as_posix()
    return resolved.replace(":", "\\:").replace("'", "'\\''")


def burn_in_ass(media_path: Path, ass_path: Path, out_path: Path) -> Path:
    """Burn ASS subtitles with ffmpeg libass (single encode pass, best quality)."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found on PATH.")
    if not ass_path.exists():
        raise FileNotFoundError(f"ASS file not found: {ass_path}")

    color_props = _probe_color_properties(media_path)
    ass_filter = f"ass='{_escape_ffmpeg_path(ass_path)}'"
    cmd = [
        ffmpeg,
        "-y",
        "-v",
        "error",
        "-i",
        str(media_path),
        "-vf",
        ass_filter,
        *_build_encode_args(color_props=color_props),
        "-c:a",
        "copy",
        "-map_metadata",
        "0",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg ass burn-in failed:\n{proc.stderr[-2000:]}")

    src_w, src_h = probe_video_size(media_path)
    out_w, out_h = probe_video_size(out_path)
    if (src_w, src_h) != (out_w, out_h):
        raise RuntimeError(
            f"Export resolution mismatch: source {src_w}x{src_h}, output {out_w}x{out_h}"
        )
    return out_path
