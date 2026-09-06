"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import { SourceFavicon, sourceHost } from "@/components/source-favicon";
import { trackEvent } from "@/lib/analytics";

interface CitationLinkProps {
  href: string;
  label: string;
  title?: string;
  snippet?: string;
}

export function CitationLink({ href, label, title, snippet }: CitationLinkProps) {
  const id = useId();
  const anchor = useRef<HTMLAnchorElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean }>();
  const host = sourceHost(href);
  const sourceTitle = title?.trim() || host;
  const dismiss = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    hovered.current = false;
    setPosition(undefined);
  }, []);

  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const open = () => {
    keepOpen();
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(340, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const above = below < 280 && rect.top > below;
    setPosition({
      width,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: above ? rect.top - 8 : rect.bottom + 8,
      maxHeight: Math.max(60, Math.min(360, above ? rect.top - 20 : below)),
      above,
    });
  };
  const closeSoon = () => {
    keepOpen();
    closeTimer.current = setTimeout(() => {
      if (!hovered.current && document.activeElement !== anchor.current) setPosition(undefined);
    }, 140);
  };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!position) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !card.current?.contains(event.target)) dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [dismiss, position]);

  return (
    <>
      <a
        ref={anchor}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-citation"
        aria-label={`Source ${label}: ${sourceTitle}`}
        aria-describedby={position ? id : undefined}
        onMouseEnter={() => { hovered.current = true; open(); }}
        onMouseLeave={() => { hovered.current = false; closeSoon(); }}
        onFocus={open}
        onBlur={closeSoon}
        onClick={() => { trackEvent("source_opened", { surface: "report" }); dismiss(); }}
      >
        <SourceFavicon url={href} />
        <span>{label}</span>
      </a>
      {position && createPortal(
        <span
          ref={card}
          id={id}
          role="tooltip"
          className="citation-preview"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, transform: position.above ? "translateY(-100%)" : undefined }}
          onMouseEnter={() => { hovered.current = true; keepOpen(); }}
          onMouseLeave={() => { hovered.current = false; closeSoon(); }}
        >
          <span className="citation-preview-site"><SourceFavicon url={href} /><span>{host}</span><ArrowUpRight size={15} /></span>
          <strong className="citation-preview-title">{sourceTitle}</strong>
          {snippet?.trim() && <span className="citation-preview-excerpt">{snippet.trim()}</span>}
          <span className="citation-preview-footer">Source {label}<span>Click citation to open</span></span>
        </span>,
        document.body,
      )}
    </>
  );
}
