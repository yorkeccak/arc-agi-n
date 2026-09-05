"use client";

import { useState } from "react";

interface SourceFaviconProps {
  url: string;
  className?: string;
}

export const sourceHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "research source";
  }
};

const faviconCandidates = (url: string) => {
  const host = sourceHost(url);
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
  ];
};

export function SourceFavicon({ url, className = "" }: SourceFaviconProps) {
  const [candidate, setCandidate] = useState({ url, index: 0 });
  const candidateIndex = candidate.url === url ? candidate.index : 0;
  const candidates = faviconCandidates(url);
  const host = sourceHost(url);
  const failed = candidateIndex >= candidates.length;

  return (
    <span
      className={`source-favicon${failed ? " is-fallback" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {failed ? host.charAt(0).toUpperCase() : (
        // Third-party publication icons are intentionally loaded without image optimisation.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={candidates[candidateIndex]}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setCandidate({ url, index: candidateIndex + 1 })}
        />
      )}
    </span>
  );
}
