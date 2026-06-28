import { useEffect, useMemo, useRef, useState } from "react";
import type { SubtitleStyleSettings } from "../hooks/useSubtitleStyleSettings";
import type { Cue } from "../types";
import SubtitleOverlay from "./SubtitleOverlay";

function findCueIndex(cues: Cue[], time: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < cues[mid].start) {
      hi = mid - 1;
    } else if (time > cues[mid].end) {
      lo = mid + 1;
    } else {
      ans = mid;
      break;
    }
  }
  return ans;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function Player({
  src,
  cues,
  style,
}: {
  src: string;
  cues: Cue[];
  style: SubtitleStyleSettings;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      const v = videoRef.current;
      if (v) setTime(v.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const activeIndex = useMemo(() => findCueIndex(cues, time), [cues, time]);
  const activeCue = activeIndex >= 0 ? cues[activeIndex] : null;

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  return (
    <div className="flex flex-1 flex-col gap-4 xl:flex-row xl:items-start">
      {/* Video panel */}
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-xl border border-border bg-black shadow-lg shadow-black/40">
          <div className="relative aspect-video w-full">
            <video ref={videoRef} src={src} controls className="absolute inset-0 h-full w-full" />
            {activeCue && (
              <SubtitleOverlay
                source={activeCue.source}
                target={activeCue.target}
                time={time}
                style={style}
              />
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-zinc-600">
          {cues.length} subtitle cues · click transcript to seek
        </p>
      </div>

      {/* Transcript panel */}
      <div className="w-full shrink-0 xl:w-80">
        <div className="flex h-full max-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-[var(--panel-bg)] xl:max-h-[calc(100vh-16rem)]">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-medium text-zinc-200">Transcript</h3>
            <p className="text-xs text-zinc-500">{cues.length} lines</p>
          </div>
          <Transcript cues={cues} activeIndex={activeIndex} style={style} onSeek={seek} />
        </div>
      </div>
    </div>
  );
}

function Transcript({
  cues,
  activeIndex,
  style,
  onSeek,
}: {
  cues: Cue[];
  activeIndex: number;
  style: SubtitleStyleSettings;
  onSeek: (t: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div ref={listRef} className="flex-1 space-y-0.5 overflow-y-auto p-2">
      {cues.map((cue, i) => (
        <button
          key={cue.id}
          type="button"
          data-idx={i}
          onClick={() => onSeek(cue.start)}
          className={`block w-full rounded-lg px-3 py-2.5 text-left transition-all ${
            i === activeIndex
              ? "border-l-2 border-indigo-400 bg-indigo-500/10"
              : "border-l-2 border-transparent hover:bg-zinc-800/60"
          }`}
        >
          <span className="mb-1 block font-mono text-[10px] text-zinc-600">
            {formatTime(cue.start)} → {formatTime(cue.end)}
          </span>
          <div
            className="leading-snug"
            style={{
              fontSize: Math.min(style.source.font_size, 14),
              fontFamily: style.source.font_family,
              color: style.source.color,
              fontWeight: style.source.bold ? 700 : 400,
              fontStyle: style.source.italic ? "italic" : "normal",
            }}
          >
            {cue.source.text}
          </div>
          <div
            className="mt-0.5 leading-snug opacity-80"
            style={{
              fontSize: Math.min(style.target.font_size, 13),
              fontFamily: style.target.font_family,
              color: style.target.color,
              fontWeight: style.target.bold ? 700 : 400,
              fontStyle: style.target.italic ? "italic" : "normal",
            }}
          >
            {cue.target.text}
          </div>
        </button>
      ))}
    </div>
  );
}
