import { siGithub } from "simple-icons";

export function RepositoryLink() {
  return (
    <div className="repository-footer">
      <a href="https://github.com/yorkeccak/arc-agi-n" target="_blank" rel="noopener noreferrer" aria-label="View ARC-AGI-N on GitHub (opens in a new tab)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={siGithub.path} /></svg>
        <span>GitHub</span>
      </a>
    </div>
  );
}
