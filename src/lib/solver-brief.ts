import type { OpenProblem } from "./types";

export function buildSolverBrief(problem: OpenProblem): string {
  const sourceLedger = problem.sources.map((source, index) => [
    `${index + 1}. ${source.title}`,
    source.url,
    source.passage ? `Open-status passage: “${source.passage}”` : undefined,
  ].filter(Boolean).join("\n")).join("\n\n");
  const resources = problem.executionResources ? `\n\nAvailable execution resources: ${problem.executionResources}` : "";
  const success = problem.successCriterion ? `\n\nSuccess or falsification criterion: ${problem.successCriterion}` : "";
  const sourcesAlreadyIncluded = problem.sources.length > 0 && problem.sources.every((source) => problem.starterPrompt.includes(source.url));

  return `Take a stab at this problem: ${problem.title}

Be ambitious, curious and persistent. A hard problem is an invitation to investigate, not a reason to give up before trying. Look for a useful new connection, a sharper bound, a counterexample or a small result worth building on. If an approach fails, record why, change direction and keep going within the time and compute budget we agree. Believe meaningful progress is possible, while letting the evidence decide what is true.

${problem.starterPrompt}${resources}${success}${sourcesAlreadyIncluded ? "" : `\n\nSource ledger:\n${sourceLedger}`}

Provenance rules: verify that the exact question remains open before attempting it; attach a URL to every literature-derived claim; distinguish theorem, reproduced computation, experimental result and speculation; do not present a numerical search as proof.

Start with a concrete plan, then take the first verifiable step. Report what worked, what failed, and the strongest next move. Honest partial progress counts.`;
}

export function buildAgentLinks(prompt: string) {
  const encoded = encodeURIComponent(prompt);
  const cursorUrl = `https://cursor.com/link/prompt?text=${encoded}`;
  return [
    { name: "Claude Code", href: prompt.length <= 13000 ? `claude://code/new?q=${encoded}` : "claude://code/new", prefilled: prompt.length <= 13000 },
    { name: "Codex", href: encoded.length <= 7900 ? `codex://new?prompt=${encoded}` : "codex://new", prefilled: encoded.length <= 7900 },
    { name: "Cursor", href: cursorUrl.length <= 8000 ? cursorUrl : "https://cursor.com/link/prompt", prefilled: cursorUrl.length <= 8000 },
    { name: "ChatGPT", href: "https://chatgpt.com/", prefilled: false },
  ];
}
