"use client";

import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ArcLogo } from "@/components/arc-logo";
import { AuthDialog } from "@/components/auth-dialog";
import { BreakthroughsPanel } from "@/components/breakthroughs-panel";
import { ProblemDrawer } from "@/components/problem-drawer";
import { SourceFavicon, sourceHost } from "@/components/source-favicon";
import { fieldColors, fields, problems } from "@/lib/problems";
import type { AuthUser } from "@/lib/oauth";
import type { DiscoveredProblem, Field, OpenProblem, SearchLead } from "@/lib/types";

const FrontierMap = dynamic(
  () => import("@/components/frontier-map").then((module) => module.FrontierMap),
  { ssr: false, loading: () => <div className="map-loading" role="status">Loading the problem atlas…</div> },
);

const fitDescription = (problem: OpenProblem) => {
  if (problem.scale === "monument") return "Long-horizon programme";
  if (problem.agentFit >= 90) return "Strong computational foothold";
  if (problem.agentFit >= 82) return "Promising bounded route";
  return "Exploratory research route";
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

type SearchStreamEvent =
  | { type: "status"; message: string }
  | { type: "source"; lead: SearchLead }
  | { type: "problem"; problem: DiscoveredProblem }
  | { type: "done"; message?: string }
  | { type: "error"; message: string };

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
  const [searchPhase, setSearchPhase] = useState("Opening research and web indexes");
  const [searchError, setSearchError] = useState<string>();
  const [authOpen, setAuthOpen] = useState(false);
  const [authReturnTo, setAuthReturnTo] = useState<string>();
  const [user, setUser] = useState<AuthUser>();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [nearbyProblems, setNearbyProblems] = useState<OpenProblem[]>([]);
  const [resumeResearch, setResumeResearch] = useState(false);
  const [breakthroughsOpen, setBreakthroughsOpen] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const resultsScroll = useRef<HTMLDivElement>(null);
  const isValyuMode = process.env.NEXT_PUBLIC_APP_MODE === "valyu";
  const closeProblem = useCallback(() => { setResumeResearch(false); setSelected(undefined); }, []);
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

  const search = async (nextQuery: string, nextField: Field | "All" = "All") => {
    searchController.current?.abort();
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
    setSearchPhase("Opening research and web indexes");
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
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Search failed");
      }
      if (!response.body) throw new Error("Search stream unavailable");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamComplete = false;
      const handleEvent = (event: SearchStreamEvent) => {
        if (controller.signal.aborted || searchController.current !== controller) return;
        if (event.type === "status") setSearchPhase(event.message);
        if (event.type === "source") {
          setLeads((current) => current.some((lead) => lead.url === event.lead.url) ? current : [...current, event.lead]);
        }
        if (event.type === "problem") {
          setDiscoveredProblems((current) => current.some((problem) => problem.title === event.problem.title) ? current : [...current, event.problem]);
        }
        if (event.type === "done") {
          if (event.message) setSearchPhase(event.message);
          streamComplete = true;
        }
        if (event.type === "error") {
          throw new Error(event.message);
        }
      };

      while (!streamComplete) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = done ? "" : lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          handleEvent(JSON.parse(line) as SearchStreamEvent);
          if (streamComplete) break;
        }
        if (done) break;
      }
      if (streamComplete) await reader.cancel();
    } catch (error) {
      if (controller.signal.aborted || searchController.current !== controller) return;
      setSearchError(error instanceof Error ? error.message : "Search failed");
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
          setSelected(resumedProblem);
          setResumeResearch(params.get("research") === "1" && Boolean(data.user));
          window.history.replaceState({}, "", "/");
        }
      })
      .catch(() => undefined);
  }, []);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length >= 2) void search(query.trim());
  };

  const surprise = () => {
    const candidates = field === "All" ? problems : problems.filter((item) => item.field === field);
    setNearbyProblems([]);
    setSelected(candidates[Math.floor(Math.random() * candidates.length)]);
    setMobileMenu(false);
  };

  const openBreakthroughs = () => {
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
  const browseAtlas = () => clearSearch(true);

  const stopSearch = () => {
    searchController.current?.abort();
    searchController.current = null;
    setLoading(false);
    setSearchStopped(true);
    setSearchPhase("Search stopped. The sources and questions found so far are saved here.");
  };

  const changeField = (nextField: Field | "All") => {
    if (nextField === field) return;
    setField(nextField);
  };

  const logOut = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    setUser(undefined);
  };

  const requireResearchAuth = () => {
    if (!selected) return;
    if (selected.provisional) savePendingProblem(selected);
    setAuthReturnTo(`/?problem=${encodeURIComponent(selected.id)}&research=1`);
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
          style={{ "--field-color": fieldColors[item] } as React.CSSProperties}
        >
          <i aria-hidden="true" />{item}
        </button>
      ))}
    </nav>
  );

  return (
    <main className="arc-shell" id="atlas">
      <header className="arc-header">
        <button className="arc-wordmark" aria-label="Return to the ARC-AGI-N globe" onClick={() => { resetSearch(); setSelected(undefined); }}>
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
          {isValyuMode && (user ? (
            <button onClick={logOut}>{user.name || user.email.split("@")[0]} · Sign out</button>
          ) : (
            <button onClick={() => { setAuthReturnTo(undefined); setAuthOpen(true); }}>Sign in for DeepResearch</button>
          ))}
        </nav>
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
              <p className="hero-copy">Search <span className="open-problems">open problems</span> across mathematics and science. See the evidence, find the first credible move, and hand it to your agent.</p>
              <button className="hero-proof" onClick={openBreakthroughs}>Fermat, formalized in 11 days. <span>Explore the breakthroughs <ArrowRight size={13} /></span></button>
            </div>

            <form className="arc-search" onSubmit={submitSearch}>
              <input
                id="frontier-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={500}
                placeholder='Try “Open problems in climate science”'
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
                <button key={example} onClick={() => { setQuery(example); void search(example); }}>{example}</button>
              ))}
            </div>

            {fieldNavigation}
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
              <p>{browsing ? "Explore the atlas" : "Search the frontier"}</p>
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
                  : `${visibleDiscoveredProblems.length} new source-backed questions and ${visibleProblems.length} open atlas matches.`}
              </p>
              {!browsing && <section className="live-results" aria-label="Live search results">
                <header>
                  <h3>Live research scan</h3>
                  <span>{loading
                    ? `${leads.length} ${leads.length === 1 ? "source" : "sources"}`
                    : visibleDiscoveredProblems.length === 0
                      ? `${leads.length} ${leads.length === 1 ? "source" : "sources"} scanned`
                      : `${visibleDiscoveredProblems.length} new ${visibleDiscoveredProblems.length === 1 ? "question" : "questions"}`}</span>
                </header>
                <p className="lead-disclaimer">Searching papers and the web for open questions and ways to start. Sources appear as we find them.</p>
                {loading && <div className="search-activity"><span aria-hidden="true"><i /></span><p role="status">{searchPhase}</p><button onClick={stopSearch}>Stop search</button></div>}
                {searchStopped && <p className="search-notice" role="status">{searchPhase} <button onClick={() => void search(submittedQuery)}>Run again</button></p>}
                {searchError && <div className="search-error" role="alert">{searchError} <button onClick={() => void search(submittedQuery)}>Retry search</button></div>}
                {leads.length > 0 && (
                  <div className="source-stream">
                    <div className="source-stream-head"><span>{loading ? "Sources arriving" : "Sources scanned"}</span><span>{leads.length}</span></div>
                    <div className="source-track">
                      <AnimatePresence initial={false}>
                        {leads.map((lead, index) => (
                          <motion.a
                            href={lead.url}
                            target="_blank"
                            rel="noreferrer"
                            key={lead.url}
                            className="source-card"
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
                      <span className={`evidence-${problem.evidenceStrength || "provisional"}`}>{problem.evidenceStrength === "strong" ? "Multiple source leads" : "One source lead - verify status"}</span>
                    </div>
                    <h4>{problem.title}</h4>
                    <p className="discovered-question">{problem.question}</p>
                    {problem.evidenceNote && <p className="evidence-note">{problem.evidenceNote}</p>}
                    <dl>
                      <div><dt>Why open</dt><dd>{problem.whyOpen}</dd></div>
                      <div><dt>First move</dt><dd>{problem.firstStep}</dd></div>
                      <div><dt>Suggested run</dt><dd>{problem.executionResources}</dd></div>
                      <div><dt>Success</dt><dd>{problem.successCriterion}</dd></div>
                    </dl>
                    <div className="discovered-actions">
                      <div className="discovered-sources">
                        {problem.sourceEvidence.slice(0, 3).map((evidence) => {
                          const lead = leads.find((candidate) => candidate.url === evidence.url);
                          return (
                            <a href={evidence.url} target="_blank" rel="noreferrer" key={evidence.url}>
                              <SourceFavicon url={evidence.url} />
                              <span>
                                <small>{lead?.sourceType || sourceHost(evidence.url)}{lead?.publishedAt ? ` · ${lead.publishedAt.slice(0, 10)}` : ""}</small>
                                <b>{lead?.title || sourceHost(evidence.url)}</b>
                                <q>{evidence.passage}</q>
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
                  <p className="empty-curated">No verified atlas record matches this query yet. Use the live sources above to identify a candidate, then verify that it remains open.</p>
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
        <div className="map-guide" aria-hidden="true"><i /> Drag to explore · choose a problem</div>
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

      {selected && <ProblemDrawer key={selected.id} problem={selected} signedIn={Boolean(user)} isValyuMode={isValyuMode} autoStartResearch={resumeResearch} onClose={closeProblem} onRequireAuth={requireResearchAuth} />}
      <AnimatePresence>
        {breakthroughsOpen && <BreakthroughsPanel onClose={closeBreakthroughs} />}
      </AnimatePresence>
      <AuthDialog open={authOpen} onClose={closeAuth} returnTo={authReturnTo} />
    </main>
  );
}
