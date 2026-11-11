"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { initialRepeats, repeatsToCover } from "@/lib/marquee";

// The scrolling track of an announcement bar (the bar's own element is the parent: it owns the
// background, text colour, overflow-hidden and the dismiss button).
//
// TWO identical halves, each repeating the message `repeats` times, translated by exactly one
// half by .marquee-track (globals.css), so the loop is seamless. `repeats` starts from an
// estimate that covers a 4K-wide bar (identical on the server and the first client render, so
// there is no flash of an empty bar and no hydration difference) and only ever GROWS after
// measuring the real bar and message: a running loop never gets shorter. The second half is
// aria-hidden, so a screen reader hears the message once per copy at most in the first half.
export default function MarqueeTrack({
  plainText,
  renderItem,
}: {
  // The message as plain text, only used to estimate its width before it is measured.
  plainText: string;
  // One copy of the message. Called once per copy; copies must be identical.
  renderItem: () => ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [repeats, setRepeats] = useState(() => initialRepeats(plainText));

  useLayoutEffect(() => {
    const track = trackRef.current;
    const bar = track?.parentElement;
    if (!track || !bar) return;
    function measure() {
      const item = track?.querySelector<HTMLElement>(".marquee-item");
      if (!item || !bar) return;
      const needed = repeatsToCover(bar.clientWidth, item.offsetWidth);
      setRepeats((current) => (needed > current ? Math.min(needed, 256) : current));
    }
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [plainText]);

  const half = (hidden: boolean) => (
    <div className="marquee-half flex shrink-0" aria-hidden={hidden || undefined}>
      {Array.from({ length: repeats }, (_, i) => (
        <span key={i} className="marquee-item shrink-0 px-4" aria-hidden={hidden || i > 0 ? true : undefined}>
          {renderItem()}
        </span>
      ))}
    </div>
  );

  return (
    <div ref={trackRef} className="marquee-track flex w-max">
      {half(false)}
      {half(true)}
    </div>
  );
}
