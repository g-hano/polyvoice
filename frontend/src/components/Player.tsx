import { useEffect, useMemo, useRef, useState } from "react";
import type { Cue } from "../types";
import type { SubtitleFontSettings } from "../hooks/useSubtitleFontSettings";
import SubtitleOverlay from "./SubtitleOverlay";
import CollapsibleSection from "./CollapsibleSection";

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

export default function Player({
  src,
  cues,
  fonts,
}: {
  src: string;
  cues: Cue[];
  fonts: SubtitleFontSettings;
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
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
        <video ref={videoRef} src={src} controls className="block w-full" />
        {activeCue && (
          <SubtitleOverlay
            source={activeCue.source}
            target={activeCue.target}
            time={time}
            fonts={fonts}
          />
        )}
      </div>

      <CollapsibleSection title="Subtitles & translation" defaultOpen>
        <Transcript
          cues={cues}
          activeIndex={activeIndex}
          fonts={fonts}
          onSeek={seek}
        />
      </CollapsibleSection>
    </div>
  );
}

function Transcript({
  cues,
  activeIndex,
  fonts,
  onSeek,
}: {
  cues: Cue[];
  activeIndex: number;
  fonts: SubtitleFontSettings;
  onSeek: (t: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div ref={listRef} className="max-h-80 space-y-4 overflow-y-auto pr-1">
      {cues.map((cue, i) => (
        <button
          key={cue.id}
          type="button"
          data-idx={i}
          onClick={() => onSeek(cue.start)}
          className={`block w-full rounded-lg px-2 py-2 text-left transition ${
            i === activeIndex ? "bg-brand/15 ring-1 ring-brand/40" : "hover:bg-white/5"
          }`}
        >
          <div
            className="leading-snug text-white"
            style={{ fontSize: fonts.sourceFontSize }}
          >
            {cue.source.text}
          </div>
          <div
            className="mt-0.5 leading-snug text-emerald-200/90"
            style={{ fontSize: fonts.targetFontSize }}
          >
            {cue.target.text}
          </div>
        </button>
      ))}
    </div>
  );
}
