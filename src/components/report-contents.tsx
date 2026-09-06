"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ChartNoAxesCombined, ChevronDown, List, PanelLeftClose } from "lucide-react";
import styles from "./report-contents.module.css";

interface OutlineEntry {
  id: string;
  title: string;
  depth: number;
  figure: boolean;
}

export function collectReportOutline(container: HTMLElement): OutlineEntry[] {
  let headingLevel = 2;
  const entries = [...container.querySelectorAll<HTMLElement>("h1, h2, h3, figure.report-figure")].map((element, index) => {
    const figure = element.tagName === "FIGURE";
    if (!figure) headingLevel = Number(element.tagName[1]);
    const title = figure ? element.querySelector("img")?.alt || "Figure" : element.textContent?.trim() || "Section";
    if (!element.id) element.id = `report-outline-${index + 1}`;
    return { id: element.id, title, depth: figure ? headingLevel + 1 : headingLevel, figure };
  });
  const topLevel = Math.min(...entries.filter((entry) => !entry.figure).map((entry) => entry.depth), 3);
  return entries.map((entry) => ({ ...entry, depth: Math.max(0, entry.depth - topLevel) }));
}

export function useReportOutline(reportRef: RefObject<HTMLElement | null>, content?: string) {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const report = reportRef.current;
    if (!report || !content) return;
    let entries: OutlineEntry[] = [];
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: OutlineEntry | undefined = entries[0];
      for (const entry of entries) {
        const element = document.getElementById(entry.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top > 100) break;
        current = entry;
      }
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8) current = entries.at(-1);
      setActiveId(current?.id || "");
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(() => {
      entries = collectReportOutline(report);
      setEntries(entries);
      try {
        const target = entries.find((entry) => entry.id === decodeURIComponent(window.location.hash.slice(1)));
        const element = target && document.getElementById(target.id);
        if (element) window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80, behavior: "instant" });
      } catch { /* Invalid fragments do not prevent report navigation. */ }
      update();
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    report.addEventListener("load", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      report.removeEventListener("load", schedule, true);
    };
  }, [content, reportRef]);

  return { entries, activeId };
}

export function ReportContents({ entries, activeId, mobile = false }: ReturnType<typeof useReportOutline> & { mobile?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const containerRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !active) return;
    const top = active.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (top < 0) list.scrollTop += top - 8;
    else if (top + active.offsetHeight > list.clientHeight) list.scrollTop += top + active.offsetHeight - list.clientHeight + 8;
  }, [activeId, collapsed, mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!containerRef.current?.contains(event.target as Node)) setMobileOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        containerRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  if (entries.length < 2) return null;
  const open = mobile ? mobileOpen : !collapsed;
  const current = entries.find((entry) => entry.id === activeId);
  return <nav ref={containerRef} className={`${styles.contents} ${mobile ? styles.mobile : styles.desktop}`} aria-label={mobile ? "Mobile report contents" : "Report contents"}>
    <button className={styles.toggle} aria-expanded={open} onClick={() => mobile ? setMobileOpen(!mobileOpen) : setCollapsed(!collapsed)}>
      <List size={16} /><span>{mobile && !open ? current?.title || "Contents" : "Contents"}</span>
      {mobile ? <ChevronDown size={15} /> : <PanelLeftClose size={15} />}
    </button>
    {open && <div ref={listRef} className={styles.entries}>
      {entries.map((entry) => <a key={entry.id} href={`#${encodeURIComponent(entry.id)}`} title={entry.title} aria-current={entry.id === activeId ? "location" : undefined} className={entry.depth === 0 ? styles.primary : undefined} style={{ paddingLeft: 12 + Math.min(entry.depth, 3) * 12 }} onClick={(event) => {
        event.preventDefault();
        window.history.pushState(null, "", `#${encodeURIComponent(entry.id)}`);
        const element = document.getElementById(entry.id);
        if (element) window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
        setMobileOpen(false);
      }}>
        {entry.figure && <ChartNoAxesCombined size={14} />}<span>{entry.title}</span>
      </a>)}
    </div>}
  </nav>;
}
