"use client";

import { Children, isValidElement, memo, type ReactNode, useMemo, useState } from "react";
import { ArrowUpRight, Check, Copy, ImageIcon } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CitationLink } from "@/components/citation-link";

export interface ResearchSource {
  title: string;
  url: string;
  sourceId?: number;
  snippet?: string;
}

export interface ReportSection {
  id: string;
  title: string;
}

const textFromNode = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return "";
};

const slugify = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 80);

const reportHeadings = (content: string) => {
  const slugCounts = new Map<string, number>();
  const byLine = new Map<number, string>();
  const sections: ReportSection[] = [];

  content.split(/\r?\n/).forEach((line, index) => {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) return;

    const title = match[2].replace(/[*_`]/g, "").trim();
    const base = slugify(title) || "section";
    const occurrence = (slugCounts.get(base) || 0) + 1;
    const id = occurrence === 1 ? base : `${base}-${occurrence}`;
    slugCounts.set(base, occurrence);
    byLine.set(index + 1, id);
    if (match[1] === "##") sections.push({ id, title });
  });

  return { byLine, sections };
};

const normalizeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
};

const normalizeEquation = (expression: string) => expression
  .trim()
  .replace(/_([A-Za-z]+)/g, "_{$1}")
  .replace(/₂ₓ/g, "_{2x}")
  .replace(/₂/g, "_{2}")
  .replace(/ₓ/g, "_{x}")
  .replace(/⁻²/g, "^{-2}")
  .replace(/⁻¹/g, "^{-1}")
  .replace(/−/g, "-")
  .replace(/·/g, "\\cdot ");

const wrapStandaloneEquations = (content: string) => {
  let inCodeFence = false;
  let inMathFence = false;

  return content.split(/\r?\n/).flatMap((line) => {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      return [line];
    }
    if (inCodeFence) return [line];
    if (line.trim() === "$$") {
      inMathFence = !inMathFence;
      return [line];
    }
    if (inMathFence) return [line];

    const bold = /^\*\*((?=[^\n*]*(?:=|≈|∝))(?=[^\n*]*(?:Δ|λ|σ|±|\/|_|⁻|₂|ₓ))[^\n*]+)\*\*\s*$/.exec(line);
    const plain = /^((?:ECS|TCR|[λσΔ])[A-Za-z0-9_]*(?:\s*[=≈∝]\s*)[^\n]{1,180})$/.exec(line);
    const expression = bold?.[1] || plain?.[1];
    return expression ? ["", "$$", normalizeEquation(expression), "$$", ""] : [line];
  }).join("\n");
};

export const prepareReportMarkdown = (content: string) => wrapStandaloneEquations(content
  .replace(/^Content:\s*/i, "")
  .replace(/^\s*#\s+[^\n]+\n+/, "")
  .replace(/<math>([\s\S]*?)<\/math>/gi, (_, expression: string) => `\n\n$$\n${expression.trim()}\n$$\n\n`)
  .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression: string) => `\n\n$$\n${expression.trim()}\n$$\n\n`)
  .replace(/\\\((.*?)\\\)/g, (_, expression: string) => `$${expression.trim()}$`)
  .replace(/\$\$([^\n]+?)\$\$/g, (_, expression: string) => `\n\n$$\n${expression.trim()}\n$$\n\n`));

const stripTerminalSources = (content: string) => content.replace(/\n##\s+Sources\s*\n[\s\S]*$/i, "").trimEnd();

const citationIdentifiers = (group: string) => {
  const identifiers = new Set<number>();
  for (const token of group.match(/\d+\s*-\s*\d+|\d+/g) || []) {
    const [start, end = start] = token.split("-").map((value) => Number(value.trim()));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end - start > 100) continue;
    for (let identifier = start; identifier <= end; identifier += 1) identifiers.add(identifier);
  }
  return [...identifiers];
};

const replaceBareCitations = (content: string, sources: ResearchSource[]) => {
  const sourceById = new Map(sources.flatMap((source) => source.sourceId ? [[source.sourceId, source] as const] : []));
  let inFence = false;

  return content.split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    return line.replace(/\[\[([\d,\s-]+)\]\](?!\()/g, (_, group: string) => {
      const identifiers = citationIdentifiers(group);
      if (identifiers.length > 0 && identifiers.every((identifier) => sourceById.has(identifier))) {
        return identifiers.map((identifier) => `[${identifier}](${sourceById.get(identifier)!.url})`).join(" ");
      }
      return `[\\[${group.trim()}\\]†](#citation-integrity)`;
    });
  }).join("\n");
};

export const countUnresolvedCitations = (content: string, sources: ResearchSource[] = []) => {
  const sourceIds = new Set(sources.flatMap((source) => source.sourceId ? [source.sourceId] : []));
  let count = 0;
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(/\[\[([\d,\s-]+)\]\](?!\()/g)) {
      const identifiers = citationIdentifiers(match[1]);
      if (!identifiers.length || identifiers.some((identifier) => !sourceIds.has(identifier))) count += 1;
    }
  }
  return count;
};

export const extractReportSections = (content: string): ReportSection[] => {
  return reportHeadings(stripTerminalSources(prepareReportMarkdown(content))).sections;
};

function ReportCodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeElement = Children.toArray(children).find((child) => isValidElement(child));
  const className = isValidElement<{ className?: string }>(codeElement) ? codeElement.props.className : undefined;
  const language = className?.match(/language-([\w-]+)/)?.[1];
  const code = textFromNode(codeElement).replace(/\n$/, "");

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="report-code-block">
      <div className="report-code-head">
        <span>{language || "code"}</span>
        <button type="button" onClick={copyCode} aria-label="Copy code block">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export const ResearchDocument = memo(function ResearchDocument({ content, sources = [] }: { content: string; sources?: ResearchSource[] }) {
  const prepared = useMemo(() => replaceBareCitations(stripTerminalSources(prepareReportMarkdown(content)), sources), [content, sources]);
  const headingIds = useMemo(() => reportHeadings(prepared).byLine, [prepared]);
  const sourceMap = useMemo(() => new Map(sources.flatMap((source) => [
    [source.url, source] as const,
    [normalizeUrl(source.url), source] as const,
  ])), [sources]);

  const components = useMemo<Components>(() => ({
    h2: ({ children, node }) => {
      const title = textFromNode(children);
      return <h2 id={headingIds.get(node?.position?.start.line || 0) || slugify(title)}>{children}</h2>;
    },
    h3: ({ children, node }) => {
      const title = textFromNode(children);
      return <h3 id={headingIds.get(node?.position?.start.line || 0) || slugify(title)}>{children}</h3>;
    },
    a: ({ href = "", children }) => {
      const label = textFromNode(children).trim();
      const isCitation = /^\[?[\d,\s-]+\]?$/.test(label);
      const source = sourceMap.get(href) || sourceMap.get(normalizeUrl(href));

      if (href === "#citation-integrity") {
        return <a href={href} className="unresolved-citation" aria-label={`${label}. Source URL was not returned.`} title="Source URL was not returned for this citation.">{children}</a>;
      }

      if (isCitation && href.startsWith("http")) {
        return (
          <CitationLink
            href={href}
            label={label.replace(/^\[|\]$/g, "")}
            title={source?.title}
            snippet={source?.snippet}
          />
        );
      }

      return (
        <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>
          {children}
        </a>
      );
    },
    table: ({ node, children }) => {
      const line = node?.position?.start.line || 1;
      const precedingHeading = prepared
        .split(/\r?\n/)
        .slice(0, Math.max(0, line - 1))
        .reverse()
        .find((value) => /^#{2,4}\s+/.test(value))
        ?.replace(/^#{2,4}\s+/, "")
        .replace(/[*_`]/g, "") || "Research data";
      const label = `${precedingHeading} table, report line ${line}`;
      return (
        <div className="report-table-scroll" tabIndex={0} role="region" aria-label={label}>
          <table>{children}</table>
        </div>
      );
    },
    pre: ({ children }) => <ReportCodeBlock>{children}</ReportCodeBlock>,
    img: ({ src, alt = "" }) => {
      if (!src || typeof src !== "string") return null;
      if (!src.startsWith("/") && !src.startsWith("data:image/") && !/^https:\/\//i.test(src)) return null;
      return (
        <figure className="report-figure">
          <a href={src} target={src.startsWith("https://") ? "_blank" : undefined} rel={src.startsWith("https://") ? "noopener noreferrer" : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />
          </a>
          {alt ? <figcaption><ImageIcon size={14} />{alt}<ArrowUpRight size={14} /></figcaption> : null}
        </figure>
      );
    },
  }), [headingIds, prepared, sourceMap]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: "ignore", throwOnError: false }]]}
      components={components}
    >
      {prepared}
    </ReactMarkdown>
  );
});
