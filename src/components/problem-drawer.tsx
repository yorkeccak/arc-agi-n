"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, ArrowRight, ArrowUpRight, LoaderCircle } from "lucide-react";
import { ArcLogo } from "@/components/arc-logo";
import { PromptHandoff } from "@/components/prompt-handoff";
import { SourceFavicon, sourceHost } from "@/components/source-favicon";
import { buildSolverBrief } from "@/lib/solver-brief";
import type { OpenProblem } from "@/lib/types";

interface ProblemDrawerProps {
  problem: OpenProblem;
  signedIn: boolean;
  isValyuMode: boolean;
  autoStartResearch?: boolean;
  onClose: () => void;
  onRequireAuth: () => void;
}

const exactTools = ["Lean", "Z3", "SAT/SMT", "SageMath", "ILP"];
export function ProblemDrawer({
  problem,
  signedIn,
  isValyuMode,
  autoStartResearch = false,
  onClose,
  onRequireAuth,
}: ProblemDrawerProps) {
  const router = useRouter();
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
      onRequireAuth();
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
        body: JSON.stringify({ problem }),
        signal: timeout,
      });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status === 401) {
          setStartingResearch(false);
          onRequireAuth();
          return;
        }
        throw new Error(data.error || "Could not start research");
      }
      if (typeof data.taskId === "string") {
        try {
          window.localStorage.setItem(`arc-agi-n:report:${data.taskId}`, JSON.stringify({
            title: problem.title,
            notified: data.notified === true,
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
    ? "A bounded result could be meaningful"
    : problem.scale === "frontier"
      ? "Partial progress is the realistic target"
      : "Treat as a long-horizon programme";

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
          <ArcLogo title="ARC-AGI-N problem dossier" />
          <button ref={closeButtonRef} onClick={onClose} aria-label="Return to previous view"><ArrowLeft size={15} /> Back</button>
        </header>

        <div className="drawer-title-block">
          <p className="problem-kicker">{problem.field} · {problem.subfield}</p>
          <h2 id="problem-drawer-title">{problem.title}</h2>
          <p className="problem-summary">{problem.summary}</p>
          {problem.provisional ? (
            <p className="problem-meta-row">Synthesized from current research sources<br />Status and novelty require independent verification</p>
          ) : (
            <p className="problem-meta-row">
              First posed {problem.introduced} · {problem.location.name}<br />
              Status last checked {problem.verified}
            </p>
          )}
        </div>

        <section className="tractability-block">
          <h3>Research fit</h3>
          <dl>
            <div><dt>Verification</dt><dd>{problem.provisional ? "Confirm the exact question remains open" : hasExactVerifier ? "An exact or formal checker is available" : "Independent review is still required"}</dd></div>
            <div><dt>Research horizon</dt><dd>{researchHorizon}</dd></div>
            <div><dt>Suggested methods</dt><dd>{problem.tools.slice(0, 3).join(", ")}</dd></div>
          </dl>
          <p>{problem.provisional ? "This is a live discovery candidate, not a verified atlas record. The first research task is a primary-source status check." : "This describes the quality of the research loop, not the probability of solving the full problem."}</p>
        </section>

        {!repeatsSummary && (
          <section className="drawer-section exact-question">
            <h3>Exact question</h3>
            <p>{problem.statement}</p>
          </section>
        )}

        <div className="drawer-pair">
          <section className="drawer-section">
            <h3>Why it remains open</h3>
            <p>{problem.whyOpen}</p>
          </section>
          <section className="drawer-section credible-step">
            <h3>Smallest credible step</h3>
            <p>{problem.smallestStep}</p>
          </section>
        </div>

        <section className="drawer-section">
          <h3>What you need</h3>
          <dl className="tool-groups">
            <div><dt>Methods and tools</dt><dd>{problem.tools.join(" · ")}</dd></div>
            <div><dt>Prerequisites and constraints</dt><dd>{problem.tags.join(" · ")}</dd></div>
          </dl>
        </section>

        <section className="drawer-section source-section">
          <h3>Where to begin reading</h3>
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

      <footer className="drawer-actions">
        {error && <div className="drawer-action-error" role="alert">{error}</div>}
        <PromptHandoff key={problem.id} prompt={buildSolverBrief(problem)} />
        <div className="research-action-group">
          <p>Get the groundwork done first.</p>
          <button className="primary-action" aria-label="Build a DeepResearch plan for this problem" onClick={startResearch} disabled={startingResearch || researchUncertain}>
            {startingResearch ? <LoaderCircle className="spin" size={19} /> : null}
            <span>
              <b>{startingResearch ? "Starting DeepResearch…" : "Build a DeepResearch plan"}</b>
              <small>History, foundations, prior attempts and avenues to explore, with sources and a 72-hour starting plan.</small>
            </span>
            {!startingResearch && <ArrowRight size={18} />}
          </button>
          <a className="research-powered-by" href="https://valyu.ai" target="_blank" rel="noreferrer">DeepResearch powered by <Image src="/valyu.svg" alt="Valyu" width={42} height={16} /></a>
        </div>
      </footer>
    </aside>
  );
}
