"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Copy, X } from "lucide-react";
import { siClaude, siCursor } from "simple-icons";
import { buildAgentLinks } from "@/lib/solver-brief";
import { trackEvent } from "@/lib/analytics";

function AgentMark({ name }: { name: string }) {
  const icon = name === "Claude Code" ? siClaude : name === "Cursor" ? siCursor : undefined;
  return icon ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon.path} /></svg> : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="https://www.google.com/s2/favicons?domain=chatgpt.com&sz=64" alt="" />
  );
}

export function PromptHandoff({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const targets = buildAgentLinks(prompt);

  useEffect(() => {
    if (!expanded) return;
    const dialog = dialogRef.current;
    dialog?.showModal();
    previewRef.current?.focus();
    return () => dialog?.close();
  }, [expanded]);

  const closePreview = () => {
    dialogRef.current?.close();
    setExpanded(false);
    optionsButtonRef.current?.focus();
  };

  const copy = async (method = "button") => {
    try {
      await navigator.clipboard.writeText(prompt);
      trackEvent("prompt_copied", { method });
      setCopied(true);
      setError(false);
    } catch {
      trackEvent("prompt_copy_failed");
      setError(true);
      setExpanded(true);
    }
  };

  return (
    <div className="prompt-handoff" onKeyDown={(event) => {
      if (expanded && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePreview();
      }
    }}>
      <div className="prompt-handoff-heading"><strong>Take a stab at it.</strong><span>Copy into your agent</span></div>
      <div className="prompt-handoff-controls">
        <button className="copy-prompt-button" onClick={() => void copy()}>
          <span className="agent-logo-stack" aria-hidden="true">{targets.slice(0, 3).map((target) => <span key={target.name}><AgentMark name={target.name} /></span>)}</span>
          <span>{copied ? "Prompt copied" : "Copy prompt"}</span>
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
        <button ref={optionsButtonRef} className="prompt-options-button" aria-expanded={expanded} aria-controls="prompt-options" onClick={() => { if (!expanded) trackEvent("prompt_preview_opened"); setExpanded(!expanded); }}>
          Preview & open in an app <ChevronDown size={15} />
        </button>
      </div>
      <p className="copy-feedback" role="status">{error ? "Clipboard unavailable. Select and copy the prompt in the preview." : copied ? "Ready to paste. Or open an app with the options above." : "The question, sources and a suggested first step, ready to paste."}</p>
      {expanded && <dialog ref={dialogRef} id="prompt-options" className="prompt-options" aria-label="Prompt preview and app links" onCancel={(event) => { event.preventDefault(); closePreview(); }} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closePreview();
      }}>
        <header><strong>Your starting prompt</strong><button aria-label="Close prompt preview" onClick={closePreview}><X size={18} /></button></header>
        <textarea ref={previewRef} aria-label="Starting prompt" readOnly value={prompt} onFocus={(event) => event.target.select()} />
        <p>Desktop apps must be installed. Nothing is submitted automatically. If an app does not open, paste the copied prompt yourself.</p>
        <div className="agent-launch-links">{targets.map((target) => (
          <a key={target.name} href={target.href} target={target.href.startsWith("https:") ? "_blank" : undefined} rel="noreferrer" onClick={() => { trackEvent("agent_open_clicked", { target: target.analyticsId, prefilled: target.prefilled }); void copy("app_link"); }}>
            <AgentMark name={target.name} /><span><b>Open in {target.name}</b><small>{target.prefilled ? "Prompt prefilled" : target.name === "ChatGPT" ? "Paste your copied prompt" : "Long prompt: paste after opening"}</small></span><ArrowUpRight size={16} />
          </a>
        ))}</div>
        <p className="prompt-inspiration">Inspired by <a href="https://www.anthropic.com/research/riemann-zeta" target="_blank" rel="noreferrer">the prompt behind a new Riemann zeta bound <ArrowUpRight size={12} /></a>. The hypothesis itself remains open.</p>
      </dialog>}
    </div>
  );
}
