"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ArrowUpRight, LoaderCircle } from "lucide-react";
import { ArcLogo } from "@/components/arc-logo";
import { PromptHandoff } from "@/components/prompt-handoff";
import { SourceFavicon, sourceHost } from "@/components/source-favicon";
import { buildSolverBrief } from "@/lib/solver-brief";
import { researchEfforts, type ResearchEffort } from "@/lib/research-effort";
import type { OpenProblem } from "@/lib/types";

interface ProblemDrawerProps {
  problem: OpenProblem;
  signedIn: boolean;
  isValyuMode: boolean;
  autoStartResearch?: boolean;
  initialEffort?: ResearchEffort;
  onClose: () => void;
  onRequireAuth: (effort: ResearchEffort) => void;
}

const exactTools = ["Lean", "Z3", "SAT/SMT", "SageMath", "ILP"];
export function ProblemDrawer({
  problem,
  signedIn,
  isValyuMode,
  autoStartResearch = false,
  initialEffort = "fast",
  onClose,
  onRequireAuth,
}: ProblemDrawerProps) {
  const router = useRouter();
  const [effort, setEffort] = useState<ResearchEffort>(initialEffort);
  const [startingResearch, setStartingResearch] = useState(false);
  const [researchUncertain, setResearchUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resumedResearchRef = useRef(false);
  const researchInFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.querySelectorAll<HTMLElement>(".arc-header, .arc-hero, .search-console, .map-stage"));
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
      if (document.querySelector(".auth-dialog")) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) {
          returnTarget.focus();
          return;
        }
        const problemMarker = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-label]"))
          .find((button) => button.getAttribute("aria-label") === `Open ${problem.title}`);
        (problemMarker || document.querySelector<HTMLButtonElement>(".arc-wordmark"))?.focus();
      });
    };
  }, [onClose, problem.title]);

  const startResearch = async () => {
    if (researchInFlight.current || researchUncertain) return;
    if (isValyuMode && !signedIn) {
      onRequireAuth(effort);
      return;
    }
    setError(undefined);
    setStartingResearch(true);
    researchInFlight.current = true;
    const timeout = AbortSignal.timeout(45_000);
    try {
      const response = await fetch("/api/deepresearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem, effort }),
        signal: timeout,
      });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status === 401) {
          setStartingResearch(false);
          onRequireAuth(effort);
          return;
        }
        throw new Error(data.error || "Could not start research");
      }
      if (typeof data.taskId === "string") {
        try {
          window.localStorage.setItem(`arc-agi-n:report:${data.taskId}`, JSON.stringify({
            title: problem.title,
            notified: data.notified === true,
            effort: data.effort ?? effort,
            ...(!isValyuMode ? { reportPath: data.reportPath, status: data.status || "queued", createdAt: new Date().toISOString() } : {}),
          }));
        } catch {
          // The report still works without local display context.
        }
      }
      router.push(data.reportPath || `/research/${data.taskId}`);
    } catch (researchError) {
      if (!mounted.current) return;
      if (timeout.aborted || researchError instanceof TypeError || (researchError instanceof Error && /timed out/i.test(researchError.message))) {
        setResearchUncertain(true);
        setError("We lost contact while creating your report. It may still be running. Check your Valyu research history or completion email before starting another report.");
      } else {
        setError(researchError instanceof Error ? researchError.message : "Could not start research");
      }
      setStartingResearch(false);
    } finally {
      researchInFlight.current = false;
    }
  };

  useEffect(() => {
    if (!autoStartResearch || resumedResearchRef.current) return;
    resumedResearchRef.current = true;
    void startResearch();
  // Resuming is a one-shot continuation of the user's pre-login action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartResearch]);
  const hasExactVerifier = problem.tools.some((tool) => exactTools.includes(tool));
  const repeatsSummary = problem.statement.trim().toLowerCase() === problem.summary.trim().toLowerCase();
  const researchHorizon = problem.scale === "foothold"
    ? "Try a specific case or computation"
    : problem.scale === "frontier"
      ? "Start with one part of the problem"
      : "Start with a smaller related question";

  return (
    <aside
      ref={drawerRef}
      className="problem-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="problem-drawer-title"
    >
      <div className="drawer-scroll">
        <header className="drawer-header">
          <ArcLogo title="ARC-AGI-N problem details" />
          <button ref={closeButtonRef} onClick={onClose} aria-label="Return to previous view"><ArrowLeft size={15} /> Back</button>
          <button className="drawer-actions-jump" onClick={() => document.getElementById("problem-actions")?.scrollIntoView({ block: "start" })} aria-label="Jump to prompt and research actions">Start here</button>
        </header>

        <div className="drawer-title-block">
          <p className="problem-kicker">{problem.field} · {problem.subfield}</p>
          <h2 id="problem-drawer-title">{problem.title}</h2>
          <p className="problem-summary">{problem.summary}</p>
          {problem.provisional ? (
            <p className="problem-meta-row">Found in papers and web sources<br />Check that it is still open before starting</p>
          ) : (
            <p className="problem-meta-row">
              First posed {problem.introduced} · {problem.location.name}<br />
              Status last checked {problem.verified}
            </p>
          )}
        </div>

        <section className="tractability-block">
          <h3>Before you start</h3>
          <dl>
            <div><dt>Checking your work</dt><dd>{problem.provisional ? "Confirm the question is still open" : hasExactVerifier ? "Use a solver or proof checker" : "Have the result independently reviewed"}</dd></div>
            <div><dt>Where to focus</dt><dd>{researchHorizon}</dd></div>
            <div><dt>Suggested methods</dt><dd>{problem.tools.slice(0, 3).join(", ")}</dd></div>
          </dl>
          <p>{problem.provisional ? "This result has not been reviewed. Read the original papers and check for newer work first." : "Check for newer papers before starting. Someone may have already tried your approach."}</p>
        </section>

        {!repeatsSummary && (
          <section className="drawer-section exact-question">
            <h3>The question</h3>
            <p>{problem.statement}</p>
          </section>
        )}

        <div className="drawer-pair">
          <section className="drawer-section">
            <h3>Why it remains open</h3>
            <p>{problem.whyOpen}</p>
          </section>
          <section className="drawer-section credible-step">
            <h3>Try this first</h3>
            <p>{problem.smallestStep}</p>
          </section>
        </div>

        <section className="drawer-section">
          <h3>What you need</h3>
          <dl className="tool-groups">
            <div><dt>Methods and tools</dt><dd>{problem.tools.join(" · ")}</dd></div>
            <div><dt>Background</dt><dd>{problem.tags.join(" · ")}</dd></div>
          </dl>
        </section>

        <section className="drawer-section source-section">
          <h3>Start reading here</h3>
          <div className="source-list">
            {problem.sources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                <SourceFavicon url={source.url} />
                <div>
                  <b>{source.title}</b>
                  <small>{source.sourceType || source.kind} · {sourceHost(source.url)}{source.publishedAt ? ` · ${source.publishedAt.slice(0, 10)}` : ""}</small>
                  {source.passage && <q>{source.passage}</q>}
                </div>
                <ArrowUpRight size={17} />
              </a>
            ))}
          </div>
        </section>

      </div>

      <footer className="drawer-actions" id="problem-actions">
        {error && <div className="drawer-action-error" role="alert">{error}</div>}
        <PromptHandoff key={problem.id} prompt={buildSolverBrief(problem)} />
        <div className="research-action-group">
          <p>Want a research plan first?</p>
          <fieldset className="research-effort" disabled={startingResearch || researchUncertain} aria-describedby="research-effort-note">
            <legend>Research effort</legend>
            <div className="research-effort-options">
              {researchEfforts.map((option, index) => (
                <label key={option.value} title={option.description}>
                  <input type="radio" name="research-effort" value={option.value} checked={effort === option.value} onChange={() => setEffort(option.value)} />
                  <span className="research-effort-option" data-level={index + 1}>
                    <span className="effort-bars" aria-hidden="true"><i /><i /><i /></span>
                    <b>{option.label}</b>
                    <small>{option.estimate}</small>
                  </span>
                </label>
              ))}
            </div>
            <p id="research-effort-note">More depth takes more time and credits.</p>
          </fieldset>
          <button className="primary-action" aria-label="Build a DeepResearch plan for this problem" onClick={startResearch} disabled={startingResearch || researchUncertain}>
            {startingResearch ? <LoaderCircle className="spin" size={19} /> : null}
            <span>
              <b>{startingResearch ? "Starting DeepResearch…" : "Build a DeepResearch plan"}</b>
              <small>What is known, what has been tried, and what to try next. Includes papers and a plan for your first 72 hours.</small>
            </span>
            {!startingResearch && <ArrowRight size={18} />}
          </button>
          <a className="research-powered-by" href="https://valyu.ai" target="_blank" rel="noreferrer">DeepResearch powered by <Image src="/valyu.svg" alt="Valyu" width={42} height={16} /></a>
        </div>
      </footer>
    </aside>
  );
}
