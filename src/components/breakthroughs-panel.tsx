"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { ArcLogo } from "@/components/arc-logo";
import { SourceFavicon, sourceHost } from "@/components/source-favicon";
import { breakthroughs, type BreakthroughKind } from "@/lib/breakthroughs";

const chronologicalBreakthroughs = [...breakthroughs].sort((a, b) => b.date.localeCompare(a.date));
const resultKinds = [...new Set(breakthroughs.map((item) => item.kind))].sort();

interface BreakthroughsPanelProps {
  onClose: () => void;
}

function BreakthroughSourceLink({ title, url }: { title: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <SourceFavicon url={url} />
      <span>
        <small>{sourceHost(url)}</small>
        <b>{title}</b>
      </span>
      <ArrowUpRight size={15} />
    </a>
  );
}

export function BreakthroughsPanel({ onClose }: BreakthroughsPanelProps) {
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<BreakthroughKind | "All">("All");
  const visibleBreakthroughs = useMemo(() => {
    const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return chronologicalBreakthroughs.filter((item) => {
      const text = [item.title, item.field, item.result, item.context, item.aiRole, item.verificationLevel].join(" ").toLowerCase();
      return (kind === "All" || item.kind === kind) && terms.every((term) => text.includes(term));
    });
  }, [filter, kind]);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.querySelectorAll<HTMLElement>(
      ".arc-header, .arc-hero, .search-console, .map-stage, .map-shade, .map-guide, .map-cluster",
    ));
    const previousAccessibility = background.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    background.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    closeButtonRef.current?.focus();

    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.removeEventListener("keydown", handleKeyboard);
      document.body.style.overflow = previousOverflow;
      previousAccessibility.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      returnFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <motion.section
      ref={panelRef}
      className="breakthrough-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="breakthrough-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <header className="breakthrough-header">
        <ArcLogo title="ARC-AGI-N breakthrough log" />
        <button ref={closeButtonRef} onClick={onClose} aria-label="Return to the problem atlas">
          <ArrowLeft size={15} /> Back to the atlas
        </button>
      </header>

      <div className="breakthrough-scroll">
        <section className="breakthrough-intro">
          <div>
            <p>Maths, science and code</p>
            <h1 id="breakthrough-title">Recent breakthroughs.</h1>
            <p className="breakthrough-lede">
              {breakthroughs.length} results, with the papers, code and details of how each was checked.
            </p>
            <a className="breakthrough-jump" href="#breakthrough-timeline">See the results <ArrowUpRight size={16} /></a>
          </div>
          <figure className="astra-result">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://arcprize.org/media/images/blog/astra-arc-agi-3-leaderboard.png"
              alt="ARC-AGI-3 leaderboard showing GPT-6 Astra Standard and Provider Adapter results"
              loading="eager"
              referrerPolicy="no-referrer"
            />
            <figcaption>
              <span>ARC-AGI-3 / Semi-private</span>
              <a href="https://arcprize.org/blog/astra" target="_blank" rel="noreferrer">
                ARC Prize evaluation <ArrowUpRight size={14} />
              </a>
            </figcaption>
          </figure>
        </section>

        <section id="breakthrough-timeline" className="breakthrough-log" aria-label="Breakthroughs by date">
          <header>
            <h2>Breakthrough log</h2>
            <p>Newest first · Sources reviewed 5 September 2026</p>
          </header>
          <div className="breakthrough-tools">
            <label><span>Find a result</span><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Fermat, protein folding, Claude…" /></label>
            <label><span>Type of result</span><select value={kind} onChange={(event) => setKind(event.target.value as BreakthroughKind | "All")}><option value="All">All results</option>{resultKinds.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <p role="status">{visibleBreakthroughs.length} of {breakthroughs.length} results</p>
          </div>
          {visibleBreakthroughs.length === 0 && <p className="empty-curated">No results match these filters. <button onClick={() => { setFilter(""); setKind("All"); }}>Clear filters</button></p>}
          <ol>
            {visibleBreakthroughs.map((breakthrough, index) => (
              <li key={`${breakthrough.date}-${breakthrough.title}`}>
                <div className="breakthrough-index">{String(index + 1).padStart(2, "0")}</div>
                <article>
                  <div className="breakthrough-meta">
                    <time dateTime={breakthrough.date}>{breakthrough.displayDate}</time>
                    <span>{breakthrough.kind}</span>
                    <span>{breakthrough.field}</span>
                  </div>
                  <h3>{breakthrough.title}</h3>
                  <div className="breakthrough-detail">
                    <p className="breakthrough-result">{breakthrough.result}</p>
                    <p className="breakthrough-context">{breakthrough.context}</p>
                    <dl className="breakthrough-verification"><div><dt>How it was checked</dt><dd>{breakthrough.verificationLevel}</dd></div><div><dt>What the model did</dt><dd>{breakthrough.aiRole}</dd></div></dl>
                  </div>
                  <div className="breakthrough-sources">
                    <BreakthroughSourceLink title={breakthrough.sourceTitle} url={breakthrough.sourceUrl} />
                    {breakthrough.additionalSources?.map((source) => (
                      <BreakthroughSourceLink key={source.url} {...source} />
                    ))}
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </section>

        <footer className="breakthrough-footer">
          <p>What will you work on next?</p>
          <button onClick={onClose}>Find an open problem <ArrowUpRight size={16} /></button>
        </footer>
      </div>
    </motion.section>
  );
}
