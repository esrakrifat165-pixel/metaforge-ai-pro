"use client";

import { useEffect, useRef } from "react";
import type { ImageItem } from "./helpers";
import { ToolIcon } from "./ToolIcons";

type ThumbStripProps = {
  items: ImageItem[];
  selectedId: string | undefined;
  size: "small" | "large";
  onSelect: (id: string) => void;
  onAdd?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
};

export function ThumbStrip({
  items,
  selectedId,
  size,
  onSelect,
  onAdd,
  onPrev,
  onNext,
  canPrev = false,
  canNext = false,
}: ThumbStripProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  // Keep the selected thumbnail centered inside the strip.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !selectedId) {
      return;
    }
    const selected = track.querySelector<HTMLElement>('[aria-current="true"]');
    if (!selected) {
      return;
    }
    const target = selected.offsetLeft - (track.clientWidth - selected.clientWidth) / 2;
    track.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [selectedId, items.length]);

  return (
    <div className="mw-strip" data-size={size}>
      {onPrev ? (
        <button
          type="button"
          className="icon-button"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Previous image"
        >
          <ToolIcon name="chevronLeft" />
        </button>
      ) : null}

      <div className="mw-strip-track" ref={trackRef}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="mw-thumb"
            aria-current={item.id === selectedId ? "true" : undefined}
            aria-label={`Show image ${index + 1} of ${items.length}: ${item.file.name}`}
            onClick={() => onSelect(item.id)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt="" decoding="async" />
          </button>
        ))}
        {onAdd ? (
          <button
            type="button"
            className="mw-thumb mw-thumb-add"
            onClick={onAdd}
            aria-label="Add more images"
            title="Add more images"
          >
            <ToolIcon name="plus" />
          </button>
        ) : null}
      </div>

      {onNext ? (
        <button
          type="button"
          className="icon-button"
          onClick={onNext}
          disabled={!canNext}
          aria-label="Next image"
        >
          <ToolIcon name="chevronRight" />
        </button>
      ) : null}
    </div>
  );
}