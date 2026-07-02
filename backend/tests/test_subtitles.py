"""Unit tests for ASS subtitle generation and burn-in helpers."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from PIL import Image

from app.config import SubtitleStyleConfig, TrackStyle
from app.models import Cue, Line, Word
from app.pipeline import subtitles
from app.pipeline.subtitle_render import (
  _build_encode_args,
  _escape_ffmpeg_path,
  render_frame,
  render_overlay_frame,
)


class SubtitleAssTests(unittest.TestCase):
  play_res_x = 360
  play_res_y = 640

  def test_ass_font_size_matches_preview_scale(self) -> None:
    self.assertEqual(subtitles._ass_font_size(12, 640), 16)
    self.assertEqual(subtitles._ass_font_size(12, 480), 12)

  def test_subtitle_layout_narrow_video_has_wide_margins(self) -> None:
    layout = subtitles._subtitle_layout(360, 640)
    self.assertGreater(layout["margin_l"], 40)
    self.assertLess(layout["usable_width"], 280)

  def test_count_wrapped_lines_for_portrait_text(self) -> None:
    layout = subtitles._subtitle_layout(360, 640)
    lines = subtitles._count_wrapped_lines(
      "peanuts grow exactly like potatoes This guy planted a raw seed",
      usable_width=layout["usable_width"],
      font_size=16,
      bold=True,
    )
    self.assertGreaterEqual(lines, 2)

  def test_karaoke_line_inserts_explicit_line_breaks(self) -> None:
    layout = subtitles._subtitle_layout(360, 640)
    words = [
      Word(w="peanuts", start=0.0, end=0.5),
      Word(w="grow", start=0.5, end=1.0),
      Word(w="exactly", start=1.0, end=1.5),
      Word(w="like", start=1.5, end=2.0),
      Word(w="potatoes", start=2.0, end=2.5),
      Word(w="This", start=2.5, end=3.0),
      Word(w="guy", start=3.0, end=3.5),
    ]
    line = subtitles._karaoke_line(
      words,
      0.0,
      usable_width=layout["usable_width"],
      font_size=16,
      bold=True,
    )
    self.assertIn("\\N", line)

  def test_stacked_pos_tags_gap_matches_preview(self) -> None:
    layout = subtitles._subtitle_layout(360, 640)
    source_text = "peanuts grow exactly like potatoes This guy"
    target_text = (
      "Çoğu insan, fıstıkların tam olarak patates gibi yetiştiğini düşünür. "
      "Bu kişi çiğ tohumları ekledi."
    )
    source_font = subtitles._ass_font_size(12, 640)
    target_font = subtitles._ass_font_size(12, 640)
    source_lines = subtitles._count_wrapped_lines(
      source_text,
      usable_width=layout["usable_width"],
      font_size=source_font,
      bold=True,
    )
    target_lines = subtitles._count_wrapped_lines(
      target_text,
      usable_width=layout["usable_width"],
      font_size=target_font,
      bold=False,
    )
    source_pos, target_pos = subtitles._stacked_pos_tags(
      layout=layout,
      source_lines=source_lines,
      target_lines=target_lines,
      source_font_size=source_font,
      target_font_size=target_font,
    )
    source_y = int(re.search(r"\\pos\(180,(\d+)\)", source_pos).group(1))
    target_y = int(re.search(r"\\pos\(180,(\d+)\)", target_pos).group(1))
    self.assertEqual(target_y, 640 - layout["bottom_pad"])
    target_height = subtitles._track_block_height(
      target_font, target_lines, layout["box_pad_y"]
    )
    self.assertEqual(source_y, target_y - target_height - layout["gap"])

  def test_track_style_uses_opaque_box_background(self) -> None:
    layout = subtitles._subtitle_layout(360, 640)
    track = TrackStyle(background_opacity=0.37)
    line = subtitles._track_style_line(
      "Target",
      track,
      margin_l=layout["margin_l"],
      margin_r=layout["margin_r"],
      play_res_y=640,
      for_export=False,
    )
    self.assertIn(",3,", line)
    self.assertIn("&HA0000000", line)
    self.assertRegex(line, r",\d+,0,2,")

  def test_track_style_export_uses_outline_without_background(self) -> None:
    layout = subtitles._subtitle_layout(360, 640)
    track = TrackStyle(background_opacity=0.37)
    line = subtitles._track_style_line(
      "Target",
      track,
      margin_l=layout["margin_l"],
      margin_r=layout["margin_r"],
      play_res_y=640,
      for_export=True,
    )
    self.assertIn(",1,", line)
    self.assertIn("&HFF000000", line)
    self.assertRegex(line, r",0,0,1,\d+,1,2,")

  def test_build_ass_header_uses_video_resolution(self) -> None:
    header = subtitles.build_ass_header(play_res_x=360, play_res_y=640)
    self.assertIn("PlayResX: 360", header)
    self.assertIn("PlayResY: 640", header)

  def test_build_ass_wraps_long_lines_for_portrait(self) -> None:
    words = [Word(w=w, start=i * 0.2, end=(i + 1) * 0.2) for i, w in enumerate(
      "Most people think peanuts grow exactly like potatoes This guy planted a raw seed".split()
    )]
    cues = [
      Cue(
        id=0,
        start=0.0,
        end=3.0,
        source=Line(text="Most people think peanuts grow exactly like potatoes", words=words),
        target=Line(text="merhaba dünya", words=[]),
      )
    ]
    ass = subtitles.build_ass(
      cues,
      SubtitleStyleConfig(),
      play_res_x=360,
      play_res_y=640,
    )
    self.assertIn("\\N", ass)
    self.assertIn("Dialogue:", ass)

  def test_render_frame_respects_background_opacity(self) -> None:
    words = [Word(w="hello", start=0.0, end=1.0)]
    cues = [
      Cue(
        id=0,
        start=0.0,
        end=2.0,
        source=Line(text="hello", words=words),
        target=Line(text="merhaba", words=[Word(w="merhaba", start=0.0, end=2.0)]),
      )
    ]
    base_color = (120, 80, 40)
    base = Image.new("RGB", (360, 640), base_color)
    transparent = SubtitleStyleConfig(
      source=TrackStyle(background_opacity=0.0),
      target=TrackStyle(
        background_opacity=0.0,
        color="#A7F3D0",
        bold=False,
        italic=True,
      ),
    )
    opaque = SubtitleStyleConfig(
      source=TrackStyle(background_opacity=1.0),
      target=TrackStyle(
        background_opacity=1.0,
        color="#A7F3D0",
        bold=False,
        italic=True,
      ),
    )
    sample = (180, 600)
    r0 = render_frame(base.copy(), cues, transparent, 0.5)
    r1 = render_frame(base.copy(), cues, opaque, 0.5)
    self.assertNotEqual(r0.getpixel(sample), r1.getpixel(sample))

  def test_render_frame_changes_pixels_when_cue_active(self) -> None:
    words = [Word(w="hello", start=0.0, end=1.0)]
    cues = [
      Cue(
        id=0,
        start=0.0,
        end=2.0,
        source=Line(text="hello", words=words),
        target=Line(text="merhaba", words=[Word(w="merhaba", start=0.0, end=2.0)]),
      )
    ]
    base = Image.new("RGB", (360, 640), (40, 40, 40))
    plain = base.copy()
    rendered = render_frame(base, cues, SubtitleStyleConfig(), 0.5)
    self.assertNotEqual(list(plain.getdata()), list(rendered.getdata()))

  def test_render_overlay_frame_is_fully_transparent_without_cue(self) -> None:
    base = Image.new("RGB", (360, 640), (40, 40, 40))
    overlay = render_overlay_frame(base, [], SubtitleStyleConfig(), 0.5)
    self.assertEqual(overlay.mode, "RGBA")
    self.assertEqual(overlay.getextrema()[3], (0, 0))

  def test_render_overlay_frame_has_opaque_subtitle_region(self) -> None:
    words = [Word(w="hello", start=0.0, end=1.0)]
    cues = [
      Cue(
        id=0,
        start=0.0,
        end=2.0,
        source=Line(text="hello", words=words),
        target=Line(text="merhaba", words=[Word(w="merhaba", start=0.0, end=2.0)]),
      )
    ]
    base = Image.new("RGB", (360, 640), (40, 40, 40))
    overlay = render_overlay_frame(base, cues, SubtitleStyleConfig(), 0.5)
    self.assertGreater(overlay.getextrema()[3][1], 0)
    sample = (180, 600)
    self.assertGreater(overlay.getpixel(sample)[3], 0)

  def test_build_encode_args_uses_export_settings(self) -> None:
    args = _build_encode_args(crf=14, preset="veryslow", pix_fmt="yuv420p")
    self.assertIn("-crf", args)
    self.assertIn("14", args)
    self.assertIn("-preset", args)
    self.assertIn("veryslow", args)
    self.assertIn("-pix_fmt", args)
    self.assertIn("yuv420p", args)
    self.assertIn("-x264-params", args)

  def test_build_encode_args_copies_color_metadata(self) -> None:
    args = _build_encode_args(
      color_props={
        "color_primaries": "bt709",
        "color_transfer": "bt709",
        "color_space": "bt709",
      }
    )
    self.assertIn("-color_primaries", args)
    self.assertIn("bt709", args)
    self.assertIn("-color_trc", args)
    self.assertIn("-colorspace", args)

  def test_escape_ffmpeg_path_escapes_drive_colon(self) -> None:
    escaped = _escape_ffmpeg_path(Path("C:/temp/subtitles.ass"))
    self.assertIn("\\:", escaped)
    self.assertIn("subtitles.ass", escaped)


if __name__ == "__main__":
  unittest.main()
