"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, CirclePause, Copy, Download, LogIn, LoaderCircle, RefreshCw } from "lucide-react";
import { ArcLogo } from "@/components/arc-logo";
import { AuthDialog } from "@/components/auth-dialog";
import { ResearchDocument, countUnresolvedCitations, extractReportSections } from "@/components/research-document";
import { SourceFavicon, sourceHost } from "@/components/source-favicon";
import { parseResearchEffort, researchEfforts, type ResearchEffort } from "@/lib/research-effort";
import { rememberLocalResearch } from "@/lib/local-research-history";

interface ResearchResult {
  taskId: string;
  effort?: ResearchEffort;
  status: string;
  progress?: { currentStep: number; totalSteps: number };
  output?: string;
  sources?: Array<{ title: string; url: string; sourceId?: number; snippet?: string }>;
  pdfUrl?: string;
  title?: string;
  createdAt?: string;
  completedAt?: string;
  error?: string;
}

interface ResearchReportProps {
  taskId: string;
  access?: string;
  selfHosted: boolean;
}

const activeStatuses = new Set(["queued", "running", "unknown", "awaiting_input", "paused"]);
const subscribeToLocalReportContext = () => () => undefined;

const readLocalReportContext = (taskId: string) => {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(`arc-agi-n:report:${taskId}`) || "";
  } catch {
    return "";
  }
};

const statusLabel = (status: string) => {
  if (status === "completed") return "DeepResearch report complete";
  if (status === "failed" || status === "cancelled") return "DeepResearch report stopped";
  if (status === "awaiting_input" || status === "paused") return "DeepResearch report paused";
  if (status === "auth-required") return "Sign in to continue";
  if (status === "running") return "Building the DeepResearch report";
  return "DeepResearch report queued";
};

const compactResearchTitle = (value?: string) => {
  if (!value) return undefined;
  const withoutPrefix = value.replace(/^(?:Research\s+)?(?:Expedition\s+)?Brief:\s*/i, "").trim();
  const [primary] = withoutPrefix.split(/\s+[—–-]\s+(?=Status|Methods|History|Foundations|Evidence)/i);
  return primary.length > 140 ? `${primary.slice(0, 137).trim()}…` : primary;
};

export function ResearchReport({ taskId, access, selfHosted }: ResearchReportProps) {
  const [research, setResearch] = useState<ResearchResult>({ taskId, status: "queued" });
  const [requestError, setRequestError] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const statusRef = useRef("queued");
  const localContextRaw = useSyncExternalStore(
    subscribeToLocalReportContext,
    () => readLocalReportContext(taskId),
    () => "",
  );
  const localContext = useMemo(() => {
    try {
      const parsed = JSON.parse(localContextRaw) as { title?: unknown; notified?: unknown; effort?: unknown };
      return {
        title: typeof parsed.title === "string" && parsed.title.trim().length > 0 && parsed.title.length <= 180 ? parsed.title.trim() : undefined,
        notified: parsed.notified === true,
        effort: parsed.effort === undefined ? undefined : parseResearchEffort(parsed.effort),
      };
    } catch {
      return { title: undefined, notified: false, effort: undefined };
    }
  }, [localContextRaw]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let consecutiveFailures = 0;
    let polls = 0;
    let activeRequest: AbortController | undefined;

    const schedule = (delay: number) => {
      timer = window.setTimeout(poll, document.hidden ? Math.max(delay, 30_000) : delay);
    };

    const poll = async () => {
      if (activeRequest) return;
      const controller = new AbortController();
      activeRequest = controller;
      const requestTimer = window.setTimeout(() => {
        if (!disposed) controller.abort();
      }, 20_000);
      try {
        const query = access ? `?access=${encodeURIComponent(access)}` : "";
        const response = await fetch(`/api/deepresearch/${encodeURIComponent(taskId)}${query}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as ResearchResult;
        if (!response.ok) {
          const message = data.error || "Could not load this research task.";
          if (response.status === 401) {
            if (!disposed) {
              setRequestError(undefined);
              statusRef.current = "auth-required";
              setResearch((current) => ({ ...current, status: "auth-required", error: message }));
            }
            return;
          }
          if ([400, 404].includes(response.status)) {
            if (!disposed) {
              statusRef.current = "failed";
              setResearch((current) => ({ ...current, status: "failed", error: message }));
            }
            return;
          }
          throw new Error(message);
        }
        if (disposed) return;
        consecutiveFailures = 0;
        polls += 1;
        statusRef.current = data.status;
        setResearch(data);
        if (selfHosted && access) {
          rememberLocalResearch({
            id: taskId,
            title: data.title || localContext.title || "Research report",
            status: data.status,
            createdAt: data.createdAt,
            completedAt: data.completedAt,
            reportPath: `/research/${encodeURIComponent(taskId)}?access=${encodeURIComponent(access)}`,
          });
        }
        setRequestError(undefined);
        if (activeStatuses.has(data.status)) schedule(Math.min(20_000, 5_000 + Math.floor(polls / 4) * 5_000));
      } catch (error) {
        if (disposed) return;
        consecutiveFailures += 1;
        setRequestError(error instanceof Error ? error.message : "Could not load this research task.");
        schedule(Math.min(30_000, 7_000 * consecutiveFailures));
      } finally {
        window.clearTimeout(requestTimer);
        if (activeRequest === controller) activeRequest = undefined;
      }
    };

    const resumeWhenVisible = () => {
      if (document.hidden || disposed || !activeStatuses.has(statusRef.current)) return;
      if (timer) window.clearTimeout(timer);
      void poll();
    };

    void poll();
    document.addEventListener("visibilitychange", resumeWhenVisible);
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      activeRequest?.abort();
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [access, taskId, retryKey, selfHosted, localContext.title]);

  const progress = useMemo(() => {
    const current = research.progress?.currentStep;
    const total = research.progress?.totalSteps;
    if (!current || !total) return undefined;
    return Math.min(100, Math.max(1, Math.round((current / total) * 100)));
  }, [research.progress]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyError(undefined);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError("The report link could not be copied. Copy it from the browser address bar instead.");
    }
  };

  const isComplete = research.status === "completed";
  const hasStopped = research.status === "failed" || research.status === "cancelled";
  const isPaused = research.status === "awaiting_input" || research.status === "paused";
  const authRequired = research.status === "auth-required";
  const title = compactResearchTitle(research.title) || localContext.title || "Your DeepResearch report";
  const reportEffort = (research.effort === undefined ? undefined : parseResearchEffort(research.effort)) ?? localContext.effort;
  const effortDetails = researchEfforts.find((option) => option.value === reportEffort);
  const sections = useMemo(() => research.output ? extractReportSections(research.output).filter((section) => section.title.toLowerCase() !== "sources") : [], [research.output]);
  const unresolvedCitations = useMemo(() => research.output ? countUnresolvedCitations(research.output, research.sources) : 0, [research.output, research.sources]);

  return (
    <>
    <main className={`report-page${isComplete ? " is-complete" : ""}`}>
      <header className="report-header">
        <Link href="/#atlas" className="report-logo" aria-label="Return to ARC-AGI-N">
          <ArcLogo />
        </Link>
        <Link href="/research" className="history-back"><ArrowLeft size={16} /> Research history</Link>
      </header>

      <div className="report-body">
        <section className="report-intro">
          <p className="report-route">DeepResearch / {taskId.slice(0, 8)}</p>
          <h1>{title}</h1>
          {isComplete && <p className="report-subtitle">Your starting plan: foundations, prior work, promising avenues and next steps, with sources.</p>}
          <div className="report-state">
            <div className="report-state-title" role="status" aria-live="polite">
              {isComplete ? <Check size={19} /> : isPaused ? <CirclePause size={19} /> : authRequired ? <LogIn size={19} /> : <LoaderCircle className={hasStopped ? "" : "spin"} size={19} />}
              <b>{statusLabel(research.status)}</b>
            </div>
            {!isComplete && !hasStopped && !isPaused && !authRequired && (
              <p>DeepResearch is reading the literature to map the history, foundations and strongest prior attempts. Your report will identify promising avenues and lay out a 72-hour starting plan you can give to your agent. {effortDetails ? `${effortDetails.label} effort: ${effortDetails.estimate}.` : "Duration depends on the selected effort."}</p>
            )}
            {isPaused && <p>Your research is paused. Its progress is saved; this page will update when it resumes.</p>}
            {authRequired && <p>Sign in with your Valyu account to view this DeepResearch report.</p>}
            {hasStopped && <p>{research.error || "This task did not finish. Return to the atlas to start a new report."}</p>}
            {authRequired && <button className="report-inline-action" onClick={() => setAuthOpen(true)}><LogIn size={15} /> Sign in to continue</button>}
            {requestError && <button className="report-inline-action" onClick={() => setRetryKey((key) => key + 1)}><RefreshCw size={15} /> Retry now</button>}
            {progress !== undefined && !isComplete && !hasStopped && !isPaused && !authRequired && (
              <div className="report-progress" role="progressbar" aria-label="DeepResearch report progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
            )}
            {progress === undefined && !isComplete && !hasStopped && !isPaused && !authRequired && <div className="report-progress is-indeterminate" role="progressbar" aria-label="DeepResearch report in progress"><i /></div>}
          </div>

          {!isComplete && !hasStopped && !authRequired && (
            <div className="report-return-note">
              <p>{localContext.notified
                ? "You can close this page. Valyu will email you a link when the report is ready."
                : selfHosted
                  ? "You can close this page. Copy this private report link to return when it is ready."
                  : "You can close this page. Copy the report link to return when it is ready."}</p>
              <button onClick={copyUrl}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Link copied" : "Copy report link"}</button>
            </div>
          )}

          {requestError && <p className="report-error">{requestError}</p>}
          {copyError && <p className="report-error" role="alert">{copyError}</p>}
        </section>

        {isComplete && research.output && (
          <section className="completed-report">
            <aside className="report-sidebar" aria-label="Report navigation and actions">
              <div className="report-sidebar-meta">
                <p>Research report</p>
                {research.completedAt && <span>Completed {new Date(research.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>}
                <span>{sections.length} sections · {research.sources?.length || 0} sources</span>
                {unresolvedCitations > 0 && <span className="report-citation-warning">{unresolvedCitations} unlinked citation {unresolvedCitations === 1 ? "group" : "groups"} marked †</span>}
              </div>
              {sections.length > 0 && (
                <nav className="report-contents" aria-label="Report contents">
                  <p>On this page</p>
                  {sections.map((section, index) => (
                    <a key={section.id} href={`#${section.id}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      {section.title}
                    </a>
                  ))}
                </nav>
              )}
              <div className="report-sidebar-actions">
                {research.pdfUrl && <a href={`/api/deepresearch/${encodeURIComponent(taskId)}/pdf${access ? `?access=${encodeURIComponent(access)}` : ""}`} download><Download size={16} /> Download PDF</a>}
                <button onClick={copyUrl} aria-live="polite">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Link copied" : "Copy report link"}</button>
              </div>
            </aside>
            <article className="report-markdown markdown">
              {unresolvedCitations > 0 && (
                <p className="report-citation-note" id="citation-integrity"><b>Citation integrity</b> {unresolvedCitations} citation {unresolvedCitations === 1 ? "group has" : "groups have"} no returned source URL and {unresolvedCitations === 1 ? "is" : "are"} marked †.</p>
              )}
              {sections.length > 0 && (
                <details className="report-mobile-contents">
                  <summary>Contents <span>{sections.length} sections</span></summary>
                  <nav aria-label="Report contents">
                    {sections.map((section, index) => <a key={section.id} href={`#${section.id}`}><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</a>)}
                  </nav>
                </details>
              )}
              <ResearchDocument content={research.output} sources={research.sources} />
            </article>
          </section>
        )}

        {isComplete && research.sources && research.sources.length > 0 && (
          <section className="report-sources">
            <h2>Sources used</h2>
            <div>
              {research.sources.map((source, index) => (
                <a key={`${source.url}-${index}`} href={source.url} target="_blank" rel="noreferrer">
                  <span className="report-source-index">{String(index + 1).padStart(2, "0")}</span>
                  <SourceFavicon url={source.url} />
                  <span className="report-source-copy">
                    <small>{sourceHost(source.url)}</small>
                    <b>{source.title}</b>
                    {source.snippet && <p>{source.snippet}</p>}
                  </span>
                  <ArrowUpRight size={17} />
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
    <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} returnTo={typeof window === "undefined" ? undefined : `${window.location.pathname}${window.location.search}`} />
    </>
  );
}
