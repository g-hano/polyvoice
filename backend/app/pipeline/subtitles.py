"""Build subtitle artifacts: cue list (for the web player), an ASS file with
karaoke word timing, and an optional ffmpeg burn-in export."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

from ..config import SubtitleStyleConfig, TrackStyle
from ..models import Cue, Line, Word
from .segment import Segment

# Preview player uses max-h 480px; overlay padding/gap are CSS px at that scale.
PREVIEW_DISPLAY_HEIGHT = 480
PREVIEW_BOTTOM_PAD_PX = 24  # pb-6
PREVIEW_TRACK_GAP_PX = 8  # gap-2
PREVIEW_BOX_PAD_Y_PX = 8  # py-2
PREVIEW_BOX_PAD_X_PX = 20  # px-5
PREVIEW_CONTAINER_PAD_PX = 16  # px-4
CHARS_PER_FONT_WIDTH = 0.42
BOLD_WIDTH_FACTOR = 1.12


def _split_target_words(text: str) -> List[str]:
    return [t for t in re.split(r"\s+", text.strip()) if t]


def _approx_target_words(text: str, start: float, end: float) -> List[Word]:
    """Distribute a cue's time across target words proportionally to length."""
    tokens = _split_target_words(text)
    if not tokens:
        return []
    weights = [max(len(t), 1) for t in tokens]
    total = sum(weights)
    span = max(end - start, 0.001)
    words: List[Word] = []
    cursor = start
    for tok, weight in zip(tokens, weights):
        dur = span * (weight / total)
        words.append(
            Word(w=tok, start=round(cursor, 3), end=round(cursor + dur, 3))
        )
        cursor += dur
    if words:
        words[-1].end = round(end, 3)
    return words


def build_cues(
    segments: List[Segment],
    translations: List[str],
    *,
    offset_sec: float = 0.0,
) -> List[Cue]:
    cues: List[Cue] = []
    for idx, (seg, translation) in enumerate(zip(segments, translations)):
        start = round(seg.start + offset_sec, 3)
        end = round(seg.end + offset_sec, 3)
        source_words = [
            Word(
                w=w.w,
                start=round(w.start + offset_sec, 3),
                end=round(w.end + offset_sec, 3),
            )
            for w in seg.words
        ]
        target_words = _approx_target_words(translation, start, end)
        cues.append(
            Cue(
                id=idx,
                start=start,
                end=end,
                source=Line(text=seg.text, words=source_words),
                target=Line(text=translation, words=target_words),
            )
        )
    return cues


def _fmt_ass_time(seconds: float) -> str:
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs == 100:
        cs = 0
        s += 1
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def _hex_to_ass_color(hex_color: str, alpha: int = 0) -> str:
    """Convert #RRGGBB to ASS &HAABBGGRR format."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        return "&H00FFFFFF"
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def _scale_preview_px(px: int, play_res_y: int) -> int:
    """Map preview CSS px to native video pixels."""
    return max(1, round(px * play_res_y / PREVIEW_DISPLAY_HEIGHT))


def _ass_font_size(px: int, play_res_y: int) -> int:
    """Map preview CSS px to ASS font size, scaled to the video height."""
    return max(12, _scale_preview_px(px, play_res_y))


def _ass_box_padding(play_res_y: int) -> int:
    """ASS BorderStyle=3 uses Outline as box padding (preview py-2)."""
    return _scale_preview_px(PREVIEW_BOX_PAD_Y_PX, play_res_y)


def _subtitle_layout(play_res_x: int, play_res_y: int) -> dict[str, int]:
    """Layout metrics matching SubtitleOverlay (max-w 95%, px-4/px-5 padding)."""
    box_pad_x = _scale_preview_px(PREVIEW_BOX_PAD_X_PX, play_res_y)
    box_pad_y = _ass_box_padding(play_res_y)
    container_pad = _scale_preview_px(PREVIEW_CONTAINER_PAD_PX, play_res_y)
    track_max = int((play_res_x - 2 * container_pad) * 0.95)
    usable_width = max(track_max - 2 * box_pad_x, play_res_x // 4)
    margin_l = max(0, (play_res_x - usable_width) // 2)
    margin_r = max(0, play_res_x - usable_width - margin_l)
    return {
        "play_res_y": play_res_y,
        "box_pad_x": box_pad_x,
        "box_pad_y": box_pad_y,
        "usable_width": usable_width,
        "margin_l": margin_l,
        "margin_r": margin_r,
        "bottom_pad": _scale_preview_px(PREVIEW_BOTTOM_PAD_PX, play_res_y),
        "gap": _scale_preview_px(PREVIEW_TRACK_GAP_PX, play_res_y),
        "cx": play_res_x // 2,
    }


def _word_display_width(word: str, font_size: int, *, bold: bool = False) -> float:
    factor = CHARS_PER_FONT_WIDTH * (BOLD_WIDTH_FACTOR if bold else 1.0)
    return max(len(word), 1) * font_size * factor


def _pack_words_into_lines(
    words: List[str],
    *,
    usable_width: int,
    font_size: int,
    bold: bool = False,
) -> List[List[str]]:
    """Greedy word wrap to match preview line breaking."""
    if not words:
        return [[]]
    space_width = font_size * 0.25
    lines: List[List[str]] = []
    current: List[str] = []
    current_width = 0.0
    for word in words:
        word_width = _word_display_width(word, font_size, bold=bold)
        extra = (space_width if current else 0.0) + word_width
        if current and current_width + extra > usable_width:
            lines.append(current)
            current = [word]
            current_width = word_width
        else:
            current.append(word)
            current_width += extra
    if current:
        lines.append(current)
    return lines


def _plain_words(text: str) -> List[str]:
    plain = re.sub(r"\{[^}]*\}", "", text).replace("\\N", " ").strip()
    return plain.split() if plain else []


def _count_wrapped_lines(
    text: str,
    *,
    usable_width: int,
    font_size: int,
    bold: bool = False,
) -> int:
    return len(_pack_words_into_lines(_plain_words(text), usable_width=usable_width, font_size=font_size, bold=bold))


def _wrap_plain_text(
    text: str,
    *,
    usable_width: int,
    font_size: int,
    bold: bool = False,
) -> str:
    lines = _pack_words_into_lines(
        _plain_words(text),
        usable_width=usable_width,
        font_size=font_size,
        bold=bold,
    )
    return "\\N".join(_ass_escape(" ".join(line)) for line in lines if line)


def _line_block_height(font_size: int, line_count: int) -> int:
    return max(font_size, int(font_size * 1.28 * line_count))


def _track_block_height(font_size: int, line_count: int, box_pad: int) -> int:
    """Text block height including BorderStyle=3 box padding."""
    return _line_block_height(font_size, line_count) + 2 * box_pad


def _stacked_pos_tags(
    *,
    layout: dict[str, int],
    source_lines: int,
    target_lines: int,
    source_font_size: int,
    target_font_size: int,
) -> tuple[str, str]:
    """Return \\pos tags so source sits above target, matching the web preview."""
    box_pad_y = layout["box_pad_y"]
    target_y = layout["play_res_y"] - layout["bottom_pad"]
    target_height = _track_block_height(target_font_size, target_lines, box_pad_y)
    source_y = target_y - target_height - layout["gap"]
    cx = layout["cx"]
    return (
        f"{{\\an2\\q2\\pos({cx},{source_y})}}",
        f"{{\\an2\\q2\\pos({cx},{target_y})}}",
    )


def _opacity_to_ass_alpha(opacity: float) -> int:
    """Map 0..1 opacity to ASS alpha byte (0=opaque, 255=transparent)."""
    return int((1.0 - max(0.0, min(1.0, opacity))) * 255)


def _track_style_line(
    name: str,
    track: TrackStyle,
    *,
    margin_l: int,
    margin_r: int,
    play_res_y: int,
) -> str:
    primary = _hex_to_ass_color(track.color)
    karaoke = _hex_to_ass_color(track.karaoke_active_color)
    back_alpha = _opacity_to_ass_alpha(track.background_opacity)
    back_colour = f"&H{back_alpha:02X}000000"
    bold = -1 if track.bold else 0
    italic = -1 if track.italic else 0
    fontsize = _ass_font_size(track.font_size, play_res_y)
    box_pad = _ass_box_padding(play_res_y)
    margin_v = _scale_preview_px(PREVIEW_BOTTOM_PAD_PX, play_res_y)
    return (
        f"Style: {name},{track.font_family},{fontsize},{primary},{karaoke},"
        f"&H00000000,{back_colour},{bold},{italic},0,0,100,100,0,0,3,{box_pad},0,2,"
        f"{margin_l},{margin_r},{margin_v},1"
    )


def probe_video_size(path: Path) -> tuple[int, int]:
    """Return (width, height) of the first video stream, or 1920x1080 if unknown."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 1920, 1080
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
        str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return 1920, 1080
    try:
        w_str, h_str = proc.stdout.strip().split("x")
        w, h = int(w_str), int(h_str)
        if w > 0 and h > 0:
            return w, h
    except ValueError:
        pass
    return 1920, 1080


def build_ass_header(
    style: Optional[SubtitleStyleConfig] = None,
    *,
    play_res_x: int = 1920,
    play_res_y: int = 1080,
    layout: Optional[dict[str, int]] = None,
) -> str:
    style = style or SubtitleStyleConfig()
    layout = layout or _subtitle_layout(play_res_x, play_res_y)
    source_line = _track_style_line(
        "Source",
        style.source,
        margin_l=layout["margin_l"],
        margin_r=layout["margin_r"],
        play_res_y=play_res_y,
    )
    target_line = _track_style_line(
        "Target",
        style.target,
        margin_l=layout["margin_l"],
        margin_r=layout["margin_r"],
        play_res_y=play_res_y,
    )
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {play_res_x}
PlayResY: {play_res_y}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{source_line}
{target_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _karaoke_line(
    words: List[Word],
    cue_start: float,
    *,
    usable_width: int,
    font_size: int,
    bold: bool = False,
) -> str:
    """Build ASS karaoke text with explicit \\N line breaks for narrow videos."""
    if not words:
        return ""
    word_texts = [w.w for w in words]
    line_groups = _pack_words_into_lines(
        word_texts,
        usable_width=usable_width,
        font_size=font_size,
        bold=bold,
    )
    rendered_lines: List[str] = []
    idx = 0
    prev_end = cue_start
    for group in line_groups:
        parts: List[str] = []
        for _ in group:
            word = words[idx]
            idx += 1
            gap_cs = max(int(round((word.start - prev_end) * 100)), 0)
            if gap_cs > 0:
                parts.append(f"{{\\k{gap_cs}}} ")
            dur_cs = max(int(round((word.end - word.start) * 100)), 1)
            parts.append(f"{{\\k{dur_cs}}}{_ass_escape(word.w)} ")
            prev_end = word.end
        rendered_lines.append("".join(parts).strip())
    return "\\N".join(rendered_lines)


def build_ass(
    cues: List[Cue],
    style: Optional[SubtitleStyleConfig] = None,
    *,
    play_res_x: int = 1920,
    play_res_y: int = 1080,
) -> str:
    style = style or SubtitleStyleConfig()
    layout = _subtitle_layout(play_res_x, play_res_y)
    source_font_size = _ass_font_size(style.source.font_size, play_res_y)
    target_font_size = _ass_font_size(style.target.font_size, play_res_y)
    usable_width = layout["usable_width"]
    margin_l = layout["margin_l"]
    margin_r = layout["margin_r"]
    lines = [
        build_ass_header(
            style,
            play_res_x=play_res_x,
            play_res_y=play_res_y,
            layout=layout,
        )
    ]
    for cue in cues:
        start = _fmt_ass_time(cue.start)
        end = _fmt_ass_time(cue.end)
        source_text = (
            _karaoke_line(
                cue.source.words,
                cue.start,
                usable_width=usable_width,
                font_size=source_font_size,
                bold=style.source.bold,
            )
            if cue.source.words
            else _wrap_plain_text(
                cue.source.text,
                usable_width=usable_width,
                font_size=source_font_size,
                bold=style.source.bold,
            )
        )
        target_text = (
            _karaoke_line(
                cue.target.words,
                cue.start,
                usable_width=usable_width,
                font_size=target_font_size,
                bold=style.target.bold,
            )
            if cue.target.words
            else _wrap_plain_text(
                cue.target.text,
                usable_width=usable_width,
                font_size=target_font_size,
                bold=style.target.bold,
            )
        )
        source_lines = _count_wrapped_lines(
            cue.source.text,
            usable_width=usable_width,
            font_size=source_font_size,
            bold=style.source.bold,
        )
        target_lines = _count_wrapped_lines(
            cue.target.text,
            usable_width=usable_width,
            font_size=target_font_size,
            bold=style.target.bold,
        )
        source_pos, target_pos = _stacked_pos_tags(
            layout=layout,
            source_lines=source_lines,
            target_lines=target_lines,
            source_font_size=source_font_size,
            target_font_size=target_font_size,
        )
        lines.append(
            f"Dialogue: 0,{start},{end},Source,,{margin_l},{margin_r},0,,{source_pos}{source_text}"
        )
        lines.append(
            f"Dialogue: 0,{start},{end},Target,,{margin_l},{margin_r},0,,{target_pos}{target_text}"
        )
    return "\n".join(lines) + "\n"


def write_artifacts(
    cues: List[Cue],
    job_dir: Path,
    style: Optional[SubtitleStyleConfig] = None,
    *,
    media_path: Optional[Path] = None,
) -> tuple[Path, Path]:
    """Write cues.json and subtitles.ass; return their paths."""
    import json

    play_res_x, play_res_y = 1920, 1080
    if media_path is not None and media_path.exists():
        play_res_x, play_res_y = probe_video_size(media_path)

    cues_path = job_dir / "cues.json"
    ass_path = job_dir / "subtitles.ass"
    cues_path.write_text(
        json.dumps([c.model_dump() for c in cues], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    ass_path.write_text(
        build_ass(cues, style, play_res_x=play_res_x, play_res_y=play_res_y),
        encoding="utf-8",
    )
    return cues_path, ass_path


def burn_in(
    media_path: Path,
    out_path: Path,
    *,
    cues: List[Cue],
    style: SubtitleStyleConfig,
) -> Path:
    """Burn subtitles using the preview-matched Pillow renderer."""
    from .subtitle_render import burn_in_preview

    return burn_in_preview(media_path, out_path, cues, style)
