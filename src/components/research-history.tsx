"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Check, Clock3, LoaderCircle, RefreshCw, Search } from "lucide-react";
import { ArcLogo } from "@/components/arc-logo";
import { readLocalResearchHistory, type LocalResearchJob } from "@/lib/local-research-history";
import type { ResearchHistoryJob } from "@/lib/research-history";

const working = new Set(["queued", "running", "pending", "in_progress"]);
const statusLabel = (status: string) => {
  if (status === "completed") return "Ready to read";
  if (working.has(status)) return status === "queued" || status === "pending" ? "Queued" : "In progress";
  if (status === "awaiting_input" || status === "paused") return "Paused";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return "Open to check status";
};
const formatDate = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  : "";

export function ResearchHistory({ selfHosted }: { selfHosted: boolean }) {
  const [jobs, setJobs] = useState<Array<ResearchHistoryJob | LocalResearchJob>>([]);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string>();
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(20);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(undefined);
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      if (selfHosted) {
        setJobs(readLocalResearchHistory(window.localStorage));
        return;
      }
      const response = await fetch("/api/deepresearch/history", { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setJobs([]);
        setAuthRequired(true);
        return;
      }
      if (!response.ok) throw new Error(response.status === 429 ? "Too many refreshes. Give it a moment, then try again." : "Your history couldn’t be loaded. Please try again.");
      const data = await response.json();
      if (!Array.isArray(data.jobs)) throw new Error("Your history couldn’t be loaded. Please try again.");
      if (controller.signal.aborted) return;
      setJobs(data.jobs);
      setTruncated(data.truncated === true);
      setAuthRequired(false);
    } catch (cause) {
      if (controllerRef.current !== controller) return;
      setError(controller.signal.aborted ? "Loading took too long. Please try again." : cause instanceof Error && cause.message.startsWith("Too many refreshes") ? cause.message : "Your history couldn’t be loaded. Please try again.");
    } finally {
      window.clearTimeout(timeout);
      if (controllerRef.current === controller) setLoading(false);
    }
  }, [selfHosted]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => {
      window.cancelAnimationFrame(frame);
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [load]);

  const filtered = useMemo(() => jobs.filter((job) => (
    job.title.toLowerCase().includes(query.trim().toLowerCase())
    && (filter === "all" || (filter === "completed" ? job.status === "completed" : working.has(job.status)))
  )), [jobs, query, filter]);
  const readyCount = jobs.filter((job) => job.status === "completed").length;
  const activeCount = jobs.filter((job) => working.has(job.status)).length;

  return (
    <main className="history-page">
      <header className="report-header">
        <Link href="/" className="report-logo" aria-label="Return to ARC-AGI-N"><ArcLogo /></Link>
        <Link href="/" className="history-back"><ArrowLeft size={16} /> Find a problem</Link>
      </header>
      <div className="history-body">
        <section className="history-intro">
          <p className="history-eyebrow">Your workspace</p>
          <h1>Research history<span>.</span></h1>
          <p>Pick up a promising idea. Follow work in progress. Return to the groundwork.</p>
          {selfHosted && <p className="history-privacy">Saved on this browser only. Open a private report link to add it here. Status updates when you open a report.</p>}
        </section>

        {authRequired ? (
          <section className="history-empty">
            <BookOpen size={28} strokeWidth={1.4} />
            <h2>Your research, in one place.</h2>
            <p>Sign in with the Valyu account you use for DeepResearch to see your reports and running jobs. Problem search stays free to use without signing in.</p>
            <a className="history-primary" href="/api/oauth/start?returnTo=%2Fresearch">Continue with Valyu <ArrowRight size={17} /></a>
          </section>
        ) : (
          <>
            <div className="history-toolbar">
              <label className="history-search"><Search size={18} /><span className="sr-only">Find a research report</span><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(20); }} placeholder="Find a report" type="search" /></label>
              <label className="history-filter"><span className="sr-only">Filter research status</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setVisibleCount(20); }}><option value="all">All research</option><option value="completed">Ready to read</option><option value="active">In progress</option></select></label>
              <button className="history-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh research history"><RefreshCw size={17} className={loading ? "spin" : ""} /><span>Refresh</span></button>
            </div>
            <div className="history-summary" role="status">
              {loading ? "Checking your research…" : `${jobs.length} ${jobs.length === 1 ? "report" : "reports"}${readyCount ? ` · ${readyCount} ready to read` : ""}${activeCount ? ` · ${activeCount} in progress` : ""}`}
              {truncated && <span>Showing matching jobs from the latest 100 tasks.</span>}
            </div>
            {error && <div className="history-error" role="alert"><p>{error}</p><button onClick={() => void load()} disabled={loading}>Try again <RefreshCw size={15} /></button></div>}
            {loading && jobs.length === 0 ? (
              <div className="history-loading" aria-hidden="true">{[0, 1, 2].map((index) => <div key={index}><i /><i /></div>)}</div>
            ) : !error && filtered.length === 0 ? (
              <section className="history-empty">
                <BookOpen size={28} strokeWidth={1.4} />
                <h2>{jobs.length ? "No matching reports." : "Your next idea starts here."}</h2>
                <p>{jobs.length ? "Try another title or show all research." : "Choose an open problem, then build a DeepResearch plan. Its history, foundations and possible next steps will be waiting here."}</p>
                {jobs.length ? <button className="history-primary" onClick={() => { setQuery(""); setFilter("all"); }}>Show all research <ArrowRight size={17} /></button> : <Link className="history-primary" href="/">Find an open problem <ArrowRight size={17} /></Link>}
              </section>
            ) : (
              <ul className="history-list">
                {filtered.slice(0, visibleCount).map((job) => (
                  <li key={job.id}>
                    <Link className="history-job" href={"reportPath" in job ? job.reportPath : `/research/${encodeURIComponent(job.id)}`} prefetch={false}>
                      <span className={`history-job-icon${job.status === "completed" ? " is-ready" : ""}`} aria-hidden="true">{job.status === "completed" ? <BookOpen size={22} strokeWidth={1.5} /> : working.has(job.status) ? <LoaderCircle size={22} className="spin" /> : <Clock3 size={22} />}</span>
                      <span className="history-job-copy"><span className="history-job-meta"><span className={job.status === "completed" ? "history-ready" : ""}>{job.status === "completed" && <Check size={13} />}{statusLabel(job.status)}</span>{formatDate(job.createdAt) && <time dateTime={job.createdAt}>{formatDate(job.createdAt)}</time>}</span><h2>{job.title}</h2></span>
                      <span className="history-job-open">{job.status === "completed" ? "Read report" : "View job"} <ArrowRight size={18} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {filtered.length > visibleCount && <button className="history-more" onClick={() => setVisibleCount((count) => count + 20)}>Show more reports <span>{filtered.length - visibleCount} remaining</span></button>}
          </>
        )}
      </div>
    </main>
  );
}
