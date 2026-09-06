"use client";

import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { oauthConfigured } from "@/lib/oauth";
import { trackEvent } from "@/lib/analytics";

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  returnTo?: string;
}

export function AuthDialog({ open, onClose, returnTo }: AuthDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.querySelectorAll<HTMLElement>(
      ".arc-header, .arc-hero, .search-console, .map-stage, .problem-drawer, .report-page",
    ));
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
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
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
      returnFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const configured = oauthConfigured();
  const resumesResearch = returnTo?.includes("research=1") === true;
  const signInPath = returnTo ? `/api/oauth/start?returnTo=${encodeURIComponent(returnTo)}` : "/api/oauth/start";

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title" aria-describedby="auth-dialog-description" onClick={(event) => event.stopPropagation()}>
        <button ref={closeButtonRef} className="dialog-close" onClick={onClose} aria-label="Close sign in">Close</button>
        <p>Valyu account</p>
        <h2 id="auth-dialog-title">{resumesResearch ? "Sign in to research this problem." : "Sign in for DeepResearch."}</h2>
        <span id="auth-dialog-description">
          {resumesResearch
            ? "DeepResearch will read the papers, review previous attempts and put together a plan for getting started. You will get an email when it is ready."
            : "Search without an account. Sign in with Valyu for a research plan covering what is known, what has been tried and what to try next."}
        </span>
        {configured ? (
          <a className="primary-action auth-action" href={signInPath} onClick={() => trackEvent("sign_in_started", { resumes_research: resumesResearch })}>
            Continue with Valyu <ArrowRight size={17} />
          </a>
        ) : (
          <button className="primary-action auth-action" disabled>Continue with Valyu <ArrowRight size={17} /></button>
        )}
        {!configured && <small>OAuth is not configured on this local instance. Use self-hosted mode or add the OAuth environment variables.</small>}
      </div>
    </div>
  );
}
