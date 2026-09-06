"use client";

import { useState } from "react";
import { ArrowUpRight, Check, ChevronDown, CirclePause, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { SourceFavicon, sourceHost } from "@/components/source-favicon";
import type { ActivitySource, ResearchActivityStep } from "@/lib/research-activity";
import styles from "./research-activity.module.css";

function SourceLinks({ sources }: { sources: ActivitySource[] }) {
  return <div className={styles.sources}>{sources.map((source) => (
    <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
      <SourceFavicon url={source.url} />
      <span><b>{source.title}</b><small>{sourceHost(source.url)}</small></span>
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  ))}</div>;
}

export function ResearchActivity({ steps, sources, status, progress }: {
  steps: ResearchActivityStep[];
  sources: ActivitySource[];
  status: string;
  progress?: { currentStep: number; totalSteps: number };
}) {
  const [showAll, setShowAll] = useState(false);
  const running = status === "running" || status === "queued" || status === "unknown";
  const visibleSteps = showAll ? steps : steps.slice(-5);
  const sourceCount = new Set([...sources.map((source) => source.url), ...steps.flatMap((step) => step.sources.map((source) => source.url))]).size;
  const hasActivity = steps.length > 0 || sources.length > 0;
  if (!running && !hasActivity) return null;

  const feed = <>
    <div className={styles.metrics} role="status">
      <span>{progress && progress.totalSteps > 0 ? `Step ${progress.currentStep} of ${progress.totalSteps}` : `${steps.length} research ${steps.length === 1 ? "step" : "steps"}`}</span>
      <span>{sourceCount} {sourceCount === 1 ? "source" : "sources"} found</span>
      {running && <span className={styles.updating}><LoaderCircle size={12} className="spin" /> Updating live</span>}
    </div>
    {!hasActivity && <p className={styles.waiting}>{status === "queued" ? "Waiting to start. Searches and sources will appear here." : "Working on your question. Searches and sources will appear as they arrive."}</p>}
    {steps.length > 5 && <button className={styles.expand} onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>{showAll ? "Show recent steps" : `Show ${steps.length - 5} earlier steps`}<ChevronDown size={14} /></button>}
    <ol className={styles.timeline}>{visibleSteps.map((step) => (
      <li key={step.id}>
        <span className={`${styles.stepIcon} ${step.status === "running" && running ? styles.active : ""}`}>
          {step.status === "running" && running ? <LoaderCircle size={16} className="spin" /> : step.status === "completed" ? <Check size={16} /> : step.status === "failed" ? <TriangleAlert size={16} /> : <CirclePause size={16} />}
        </span>
        <div className={styles.stepBody}>
          <div className={styles.stepTitle}><b>{step.label}</b><small>{step.status === "completed" ? "Done" : step.status === "failed" ? "Unsuccessful" : step.status === "running" && running ? "In progress" : "Stopped"}</small></div>
          {step.detail && <p>{step.detail}</p>}
          {step.sources.length > 0 && <SourceLinks sources={step.sources} />}
        </div>
      </li>
    ))}</ol>
    {sources.length > 0 && <details className={styles.allSources} open={steps.length === 0 ? true : undefined}><summary>Sources collected <span>{sources.length}</span></summary><SourceLinks sources={sources} /></details>}
    {running && hasActivity && <p className={styles.footnote}>The report keeps working between updates. You can leave this page open or come back later.</p>}
  </>;

  return <section className={styles.activity} aria-label="Research activity">
    {running ? <><h2><Search size={18} />Research activity</h2>{feed}</> : <details><summary className={styles.finished}>Research activity <ChevronDown size={16} /></summary>{feed}</details>}
  </section>;
}
