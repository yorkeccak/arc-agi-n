"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ArcLogo } from "@/components/arc-logo";
import { RepositoryLink } from "@/components/repository-link";
import { AuthDialog } from "@/components/auth-dialog";
import { AccountMenu } from "@/components/account-menu";
import { BreakthroughsPanel } from "@/components/breakthroughs-panel";
import { ProblemDrawer } from "@/components/problem-drawer";
import { SourceFavicon, sourceHost } from "@/components/source-favicon";
import { fieldColors, fields, problems } from "@/lib/problems";
import { reportSearchFailure, trackEvent } from "@/lib/analytics";
import { searchRequestId } from "@/lib/search-diagnostics";
import { readSearchResponse, SearchResponseError } from "@/lib/search-stream";
import { parseResearchEffort, type ResearchEffort } from "@/lib/research-effort";
import type { AuthUser } from "@/lib/oauth";
import type { DiscoveredProblem, Field, OpenProblem, SearchLead } from "@/lib/types";

const FrontierMap = dynamic(
  () => import("@/components/frontier-map").then((module) => module.FrontierMap),
  { ssr: false, loading: () => <div className="map-loading" role="status">Loading the problem atlas…</div> },
);

const fitDescription = (problem: OpenProblem) => {
  if (problem.scale === "monument") return "Start with a smaller related question";
  if (problem.agentFit >= 90) return "Try a computation";
  if (problem.agentFit >= 82) return "Try a specific case";
  return "Start by reading the papers";
};

const ignoredSearchTerms = new Set([
  "a", "about", "an", "and", "are", "for", "find", "in", "me", "of", "on",
  "open", "pen", "problem", "problems", "research", "science", "sciences", "show", "some", "the", "to", "with",
]);

const meaningfulTerms = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9+\-]+/g, " ")
  .split(/\s+/)
  .filter((term) => term.length > 1 && !ignoredSearchTerms.has(term));

const pendingProblemKey = "arc-agi-n:pending-problem";

const savePendingProblem = (problem: OpenProblem) => {
  try {
    window.sessionStorage.setItem(pendingProblemKey, JSON.stringify(problem));
  } catch {
    // OAuth can still resume curated problems when browser storage is unavailable.
  }
};

const readPendingProblem = (id: string | null) => {
  if (!id?.startsWith("live-")) return undefined;
  try {
    const raw = window.sessionStorage.getItem(pendingProblemKey);
    const candidate = raw ? JSON.parse(raw) as Partial<OpenProblem> : undefined;
    const validSources = Array.isArray(candidate?.sources) && candidate.sources.every((source) => {
      try {
        return typeof source?.url === "string" && new URL(source.url).protocol === "https:";
      } catch {
        return false;
      }
    });
    if (candidate?.id !== id || candidate.provisional !== true || typeof candidate.researchToken !== "string" || !validSources) return undefined;
    window.sessionStorage.removeItem(pendingProblemKey);
    return candidate as OpenProblem;
  } catch {
    return undefined;
  }
};

const asOpenProblem = (problem: DiscoveredProblem, index: number, leads: SearchLead[]): OpenProblem => {
  const sources = problem.sourceEvidence.map((evidence) => {
    const lead = leads.find((candidate) => candidate.url === evidence.url);
    return {
      title: lead?.title || sourceHost(evidence.url),
      url: evidence.url,
      kind: "primary" as const,
      passage: evidence.passage,
      publishedAt: lead?.publishedAt,
      sourceType: lead?.sourceType,
      doi: lead?.doi,
    };
  });
  const sourceLedger = sources.map((source, sourceIndex) => (
    `${sourceIndex + 1}. ${source.title}\n${source.url}\nOpen-status passage: “${source.passage}”`
  )).join("\n\n");

  return {
    id: `live-${index}-${problem.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
    title: problem.title,
    field: problem.field,
    subfield: problem.subfield,
    summary: problem.question,
    statement: problem.question,
    whyOpen: problem.whyOpen,
    smallestStep: problem.firstStep,
    agentFit: problem.agentReadiness === "agent-ready" ? 92 : 68,
    scale: "foothold",
    introduced: new Date().getFullYear(),
    location: { name: "Live search", longitude: 0, latitude: 0 },
    tags: ["Live discovery", problem.agentReadiness === "agent-ready" ? "Agent-ready" : "Hybrid workflow", "Status check required"],
    tools: ["Literature search", "Code execution", "Independent verification"],
    sources,
    starterPrompt: `Begin a rigorous research attempt on: ${problem.title}.\n\nExact question: ${problem.question}\n\nWhy it appears open: ${problem.whyOpen}\n\nFirst bounded move: ${problem.firstStep}\n\nAvailable execution resources: ${problem.executionResources}\n\nSuccess or falsification criterion: ${problem.successCriterion}\n\nSource ledger:\n${sourceLedger}\n\nFirst confirm from these passages and newer primary literature that the exact question remains open. Separate proven facts, reproduced results, experimental evidence and speculation. Preserve source URLs in every claim ledger entry. Return reproducible code or formal artifacts, falsification criteria and the smallest result that would constitute credible progress.`,
    verified: "Passage checked · current status not independently reviewed",
    provisional: true,
    researchToken: problem.researchToken,
    agentReadiness: problem.agentReadiness,
    executionResources: problem.executionResources,
    successCriterion: problem.successCriterion,
  };
};

export function AtlasApp() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<OpenProblem>();
  const [field, setField] = useState<Field | "All">("All");
  const [leads, setLeads] = useState<SearchLead[]>([]);
  const [discoveredProblems, setDiscoveredProblems] = useState<DiscoveredProblem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchStopped, setSearchStopped] = useState(false);
  const [searchPhase, setSearchPhase] = useState("Searching papers and the web…");
  const [searchError, setSearchError] = useState<string>();
  const [authOpen, setAuthOpen] = useState(false);
  const [authReturnTo, setAuthReturnTo] = useState<string>();
  const [user, setUser] = useState<AuthUser>();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [nearbyProblems, setNearbyProblems] = useState<OpenProblem[]>([]);
  const [resumeResearch, setResumeResearch] = useState(false);
  const [initialResearchEffort, setInitialResearchEffort] = useState<ResearchEffort>("fast");
  const [breakthroughsOpen, setBreakthroughsOpen] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const resultsScroll = useRef<HTMLDivElement>(null);
  const isValyuMode = process.env.NEXT_PUBLIC_APP_MODE === "valyu";
  const closeProblem = useCallback(() => { setResumeResearch(false); setInitialResearchEffort("fast"); setSelected(undefined); }, []);
  const closeBreakthroughs = useCallback(() => setBreakthroughsOpen(false), []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);

  useEffect(() => {
    if (!mobileMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenu(false);
        mobileMenuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenu]);

  useEffect(() => () => searchController.current?.abort(), []);

  const visibleProblems = useMemo(() => {
    const filtered = field === "All" ? problems : problems.filter((item) => item.field === field);
    if (!submittedQuery) return filtered;
    const terms = meaningfulTerms(submittedQuery);
    if (terms.length === 0) return filtered;
    return filtered.filter((problem) => {
      const text = [problem.title, problem.field, problem.subfield, problem.summary, ...problem.tags, ...problem.tools].join(" ").toLowerCase();
      const matchCount = terms.filter((term) => text.includes(term)).length;
      const requiredMatches = terms.length === 1 ? 1 : Math.ceil(terms.length * 0.6);
      return matchCount >= requiredMatches;
    });
  }, [field, submittedQuery]);

  const visibleDiscoveredProblems = useMemo(() => (
    field === "All"
      ? discoveredProblems
      : discoveredProblems.filter((problem) => problem.field === field)
  ), [discoveredProblems, field]);

  const search = async (nextQuery: string, nextField: Field | "All" = "All", origin = "typed") => {
    searchController.current?.abort();
    const startedAt = performance.now();
    const foundSources = new Set<string>();
    const foundProblems = new Set<string>();
    let requestId: string | undefined;
    let httpStatus = 0;
    trackEvent("search_started", { field: nextField, origin });
    const controller = new AbortController();
    searchController.current = controller;
    setField(nextField);
    setQuery(nextQuery);
    setSubmittedQuery(nextQuery);
    setBrowsing(false);
    setLoading(true);
    setSearchStopped(false);
    setNearbyProblems([]);
    resultsScroll.current?.scrollTo({ top: 0 });
    setSearchPhase("Searching papers and the web…");
    setSearchError(undefined);
    setLeads([]);
    setDiscoveredProblems([]);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: nextQuery, field: nextField === "All" ? undefined : nextField }),
        signal: controller.signal,
      });
      requestId = searchRequestId(response.headers.get("x-search-request-id"));
      httpStatus = response.status;
      await readSearchResponse(response, (event) => {
        if (controller.signal.aborted || searchController.current !== controller) return;
        if (event.type === "status") setSearchPhase(event.message);
        if (event.type === "source") {
          foundSources.add(event.lead.url);
          setLeads((current) => current.some((lead) => lead.url === event.lead.url) ? current : [...current, event.lead]);
        }
        if (event.type === "problem") {
          foundProblems.add(event.problem.title);
          setDiscoveredProblems((current) => current.some((problem) => problem.title === event.problem.title) ? current : [...current, event.problem]);
        }
        if (event.type === "done") {
          if (event.message) setSearchPhase(event.message);
        }
      });
      if (!controller.signal.aborted && searchController.current === controller) {
        trackEvent("search_completed", { source_count: foundSources.size, problem_count: foundProblems.size, duration_ms: Math.round(performance.now() - startedAt) });
      }
    } catch (error) {
      if (controller.signal.aborted || searchController.current !== controller) return;
      reportSearchFailure({
        reason: error instanceof SearchResponseError ? error.reason : error instanceof TypeError ? "network_error" : "unknown",
        request_id: requestId,
        http_status: httpStatus,
        duration_ms: Math.min(3_600_000, Math.round(performance.now() - startedAt)),
        source_count: foundSources.size,
        problem_count: foundProblems.size,
        online: navigator.onLine,
      });
      setSearchError(error instanceof SearchResponseError ? error.message : "The search connection was interrupted. Please try again.");
      controller.abort();
    } finally {
      if (searchController.current === controller) setLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/auth/session")
      .then((response) => response.json())
      .then((data) => {
        setUser(data.user || undefined);
        const params = new URLSearchParams(window.location.search);
        const problemId = params.get("problem");
        const resumedProblem = problems.find((problem) => problem.id === problemId) || readPendingProblem(problemId);
        if (resumedProblem) {
          setInitialResearchEffort(parseResearchEffort(params.get("effort") ?? undefined) ?? "fast");
          setSelected(resumedProblem);
          setResumeResearch(params.get("research") === "1" && Boolean(data.user));
          window.history.replaceState({}, "", "/");
        }
      })
      .catch(() => undefined);
  }, []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length >= 2) void search(query.trim(), "All", submittedQuery ? "refine" : "typed");
  };

  const surprise = () => {
    trackEvent("surprise_clicked");
    const candidates = field === "All" ? problems : problems.filter((item) => item.field === field);
    setNearbyProblems([]);
    setSelected(candidates[Math.floor(Math.random() * candidates.length)]);
    setMobileMenu(false);
  };

  const openBreakthroughs = () => {
    trackEvent("breakthroughs_opened");
    setMobileMenu(false);
    setBreakthroughsOpen(true);
  };

  const clearSearch = (browse: boolean) => {
    searchController.current?.abort();
    searchController.current = null;
    setSubmittedQuery("");
    setBrowsing(browse);
    setLeads([]);
    setDiscoveredProblems([]);
    setSearchError(undefined);
    setLoading(false);
    setSearchStopped(false);
    setNearbyProblems([]);
    if (browse) setMobileMenu(false);
  };

  const resetSearch = () => clearSearch(false);
  const goHome = () => {
    resetSearch();
    closeProblem();
    closeBreakthroughs();
    setMobileMenu(false);
  };
  const browseAtlas = () => { trackEvent("atlas_browsed"); clearSearch(true); };

  const stopSearch = () => {
    trackEvent("search_stopped");
    searchController.current?.abort();
    searchController.current = null;
    setLoading(false);
    setSearchStopped(true);
    setSearchPhase("Search stopped. The sources and questions found so far are saved here.");
  };

  const changeField = (nextField: Field | "All") => {
    if (nextField === field) return;
    trackEvent("field_selected", { field: nextField });
    setField(nextField);
  };

  const logOut = async () => {
    const response = await fetch("/api/auth/session", { method: "DELETE" });
    if (!response.ok) throw new Error("Could not sign out");
    trackEvent("sign_out_completed");
    setUser(undefined);
  };

  const requireResearchAuth = (effort: ResearchEffort) => {
    if (!selected) return;
    if (selected.provisional) savePendingProblem(selected);
    setAuthReturnTo(`/?problem=${encodeURIComponent(selected.id)}&research=1&effort=${encodeURIComponent(effort)}`);
    setAuthOpen(true);
  };

  const fieldNavigation = (
    <nav className="field-switcher" aria-label="Filter by field">
      <select value={field} onChange={(event) => changeField(event.target.value as Field | "All")} aria-label="Choose a field">
        <option value="All">All fields</option>
        {fields.map((item) => <option value={item} key={item}>{item}</option>)}
      </select>
      <button className={field === "All" ? "active" : ""} aria-pressed={field === "All"} onClick={() => changeField("All")}>All fields</button>
      {fields.map((item) => (
        <button
          className={field === item ? "active" : ""}
          key={item}
          aria-pressed={field === item}
          onClick={() => changeField(item)}
        >
          {item}
        </button>
      ))}
    </nav>
  );

  return (
    <main className={`arc-shell${!submittedQuery && !browsing ? " is-landing" : ""}`} id="atlas">
      <header className="arc-header">
        <button className="arc-wordmark" aria-label="Return to the ARC-AGI-N globe" onClick={goHome}>
          <ArcLogo />
        </button>
        <button
          ref={mobileMenuButton}
          className="mobile-menu"
          onClick={() => setMobileMenu(!mobileMenu)}
          aria-label="Toggle navigation"
          aria-controls="primary-navigation"
          aria-expanded={mobileMenu}
        >
          {mobileMenu ? "Close" : "Menu"}
        </button>
        <nav id="primary-navigation" className={mobileMenu ? "is-open" : ""}>
          <button onClick={openBreakthroughs}>What AI solved</button>
          <button aria-label="Surprise me with a problem" onClick={surprise}>Surprise me</button>
          <button onClick={browseAtlas}>Browse the atlas</button>
          <Link href="/research">Research history</Link>
        </nav>
        {isValyuMode && <AccountMenu user={user} onSignOut={logOut} onSignIn={() => { setMobileMenu(false); setAuthReturnTo(undefined); setAuthOpen(true); }} />}
      </header>

      <AnimatePresence mode="wait">
        {!submittedQuery && !browsing && (
          <motion.section
            className="arc-hero"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="hero-copy-block">
              <h1>AI solved the benchmarks.<br /><span>Now find more problems to solve.</span></h1>
              <p className="hero-copy">Find <span className="open-problems">open problems</span> in mathematics and science. Pick one, read the papers, and give your agent a place to start.</p>
              <button className="hero-proof" onClick={openBreakthroughs}>Fermat, formalized in 11 days. <span>See what else <ArrowRight size={13} /></span></button>
            </div>

            <form className="arc-search" onSubmit={submitSearch}>
              <input
                id="frontier-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={500}
                placeholder="Find open problems…"
                aria-label="Search open problems by field, method, dataset, or time budget"
              />
              <button type="submit" aria-label="Find open problems" disabled={query.trim().length < 2}><ArrowRight size={22} strokeWidth={1.5} /></button>
            </form>

            <div className="query-prompts">
              {[
                "Open problems in number theory",
                "Open problems in quantum physics",
                "Open problems in climate science",
              ].map((example) => (
                <button key={example} onClick={() => { setQuery(example); void search(example, "All", "example"); }}>{example}</button>
              ))}
            </div>

            {fieldNavigation}
            <RepositoryLink />
          </motion.section>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(submittedQuery || browsing) && (
          <motion.section
            className="search-console"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="console-head">
              <button className="back-button" onClick={resetSearch}><ArrowLeft size={17} /> Back to the globe</button>
              <p>{browsing ? "Browse problems" : "Search problems"}</p>
              <h1>{browsing ? `${visibleProblems.length} open problems` : "Find your next problem."}</h1>
              <form className="results-search" onSubmit={submitSearch} role="search">
                <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={500} aria-label="Search or refine open problems" placeholder="Open problems in…" />
                <button type="submit" disabled={query.trim().length < 2} aria-label="Search again"><ArrowRight size={20} /></button>
              </form>
              {!browsing && <p className="results-query">Results for <strong>{submittedQuery}</strong></p>}
              {fieldNavigation}
            </div>
            <div className="console-scroll" ref={resultsScroll}>
              <p className="sr-only" role="status" aria-live="polite">
                {loading
                  ? `${searchPhase}. ${leads.length} sources found.`
                  : `${visibleDiscoveredProblems.length} questions found in sources and ${visibleProblems.length} matches from our collection.`}
              </p>
              {!browsing && <section className="live-results" aria-label="Live search results">
                <header>
                  <h3>Search results</h3>
                  <span>{loading
                    ? `${leads.length} ${leads.length === 1 ? "source" : "sources"}`
                    : visibleDiscoveredProblems.length === 0
                      ? `${leads.length} ${leads.length === 1 ? "source" : "sources"} scanned`
                      : `${visibleDiscoveredProblems.length} new ${visibleDiscoveredProblems.length === 1 ? "question" : "questions"}`}</span>
                </header>
                <p className="lead-disclaimer">Searching papers and the web for open questions and ways to start. Sources appear as we find them.</p>
                {loading && <div className="search-activity"><span aria-hidden="true"><i /></span><p role="status">{searchPhase}</p><button onClick={stopSearch}>Stop search</button></div>}
                {searchStopped && <p className="search-notice" role="status">{searchPhase} <button onClick={() => void search(submittedQuery, field, "retry")}>Run again</button></p>}
                {searchError && <div className="search-error" role="alert">{searchError} <button onClick={() => void search(submittedQuery, field, "retry")}>Retry search</button></div>}
                {leads.length > 0 && (
                  <div className="source-stream">
                    <div className="source-stream-head"><span>{loading ? "Sources arriving" : "Sources found"}</span><span>{leads.length}</span></div>
                    <div className="source-track">
                      <AnimatePresence initial={false}>
                        {leads.map((lead, index) => (
                          <motion.a
                            href={lead.url}
                            target="_blank"
                            rel="noreferrer"
                            key={lead.url}
                            className="source-card"
                            onClick={() => trackEvent("source_opened", { surface: "search" })}
                            initial={{ opacity: 0, x: 16 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.28, delay: Math.min(index * 0.035, 0.2) }}
                          >
                            <SourceFavicon url={lead.url} />
                            <div><small>{sourceHost(lead.url)}</small><b>{lead.title}</b></div>
                            <ArrowRight size={13} />
                          </motion.a>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
                {visibleDiscoveredProblems.map((problem, index) => (
                  <motion.article
                    className="discovered-problem"
                    key={`${problem.title}-${index}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.32, delay: Math.min(index * 0.045, 0.25) }}
                  >
                    <div className="discovered-meta">
                      <span>{problem.field}</span>
                      <span>{problem.subfield}</span>
                      <span className={`evidence-${problem.evidenceStrength || "provisional"}`}>{problem.sourceUrls.length} {problem.sourceUrls.length === 1 ? "source" : "sources"} · Check latest status</span>
                    </div>
                    <h4>{problem.title}</h4>
                    <p className="discovered-question">{problem.question}</p>
                    {problem.evidenceNote && <p className="evidence-note">{problem.evidenceNote}</p>}
                    <dl>
                      <div><dt>What is still unknown</dt><dd>{problem.whyOpen}</dd></div>
                      <div><dt>Try this first</dt><dd>{problem.firstStep}</dd></div>
                      <div><dt>Tools and data</dt><dd>{problem.executionResources}</dd></div>
                      <div><dt>What would count as progress</dt><dd>{problem.successCriterion}</dd></div>
                    </dl>
                    <div className="discovered-actions">
                      <div className="discovered-sources">
                        {problem.sourceEvidence.slice(0, 3).map((evidence) => {
                          const lead = leads.find((candidate) => candidate.url === evidence.url);
                          return (
                            <a href={evidence.url} target="_blank" rel="noreferrer" key={evidence.url} onClick={() => trackEvent("source_opened", { surface: "search" })}>
                              <SourceFavicon url={evidence.url} />
                              <span>
                                <small>{lead?.sourceType || sourceHost(evidence.url)}{lead?.publishedAt ? ` · ${lead.publishedAt.slice(0, 10)}` : ""}</small>
                                <b>{lead?.title || sourceHost(evidence.url)}</b>
                                {evidence.passage && <q>{evidence.passage}</q>}
                              </span>
                              <ArrowRight size={13} />
                            </a>
                          );
                        })}
                      </div>
                      <button aria-label={`Open ${problem.title}`} onClick={() => setSelected(asOpenProblem(problem, index, leads))}>Open problem<ArrowRight size={14} /></button>
                    </div>
                  </motion.article>
                ))}
                {!loading && !searchError && !searchStopped && visibleDiscoveredProblems.length === 0 && (
                  <p className="empty-curated">
                    {discoveredProblems.length > 0
                      ? <>No new questions in {field}. <button onClick={() => changeField("All")}>Show all {discoveredProblems.length} questions</button></>
                      : visibleProblems.length > 0
                      ? `${searchPhase}. The atlas matches below are relevant to this search.`
                      : `${searchPhase}. Try a narrower field, method, dataset, or time budget.`}
                  </p>
                )}
              </section>}

              <section className="mapped-results">
                <header>
                  <h3>{browsing ? "Curated open problems" : "Open problems matching your search"}</h3>
                  <span>{visibleProblems.length} problems</span>
                </header>
                {visibleProblems.length === 0 && (
                  <p className="empty-curated">No problems in our collection match this search. Check the papers and web results above.</p>
                )}
                {visibleProblems.map((problem) => (
                  <button key={problem.id} onClick={() => setSelected(problem)}>
                    <span className="result-field">{problem.field}<br />{problem.subfield}</span>
                    <div>
                      <h4>{problem.title}</h4>
                      <p>{problem.summary}</p>
                      <small>Checked {problem.verified} · {fitDescription(problem)}</small>
                    </div>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </section>
              <RepositoryLink />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="map-stage" role="region" aria-label="Interactive globe of open problems" aria-describedby="map-instructions">
        <p className="sr-only" id="map-instructions">Use Tab to move through visible problems. Browse the atlas for the complete list.</p>
        <FrontierMap
          problems={visibleProblems}
          selectedId={selected?.id}
          onSelect={(problem) => { setNearbyProblems([]); setSelected(problem); }}
          onCluster={setNearbyProblems}
        />
      </div>
      <div className="map-shade" />

      {!submittedQuery && !browsing && nearbyProblems.length === 0 && (
        <div className="map-guide" aria-hidden="true">Drag to rotate · click a problem</div>
      )}

      {nearbyProblems.length > 0 && !selected && (
        <section className="map-cluster" aria-label="Choose a nearby open problem">
          <header><span>{nearbyProblems.length} nearby open problems</span><button onClick={() => setNearbyProblems([])}>Close</button></header>
          {nearbyProblems.map((problem) => (
            <button key={problem.id} onClick={() => { setNearbyProblems([]); setSelected(problem); }}>
              <i style={{ background: fieldColors[problem.field] }} />
              <span><small>{problem.field} · {problem.subfield}</small><b>{problem.title}</b></span>
              <ArrowRight size={15} />
            </button>
          ))}
        </section>
      )}

      {selected && <ProblemDrawer key={selected.id} problem={selected} signedIn={Boolean(user)} isValyuMode={isValyuMode} autoStartResearch={resumeResearch} initialEffort={initialResearchEffort} onClose={closeProblem} onHome={goHome} onRequireAuth={requireResearchAuth} />}
      <AnimatePresence>
        {breakthroughsOpen && <BreakthroughsPanel onClose={closeBreakthroughs} onHome={goHome} />}
      </AnimatePresence>
      <AuthDialog open={authOpen} onClose={closeAuth} returnTo={authReturnTo} />
    </main>
  );
}
