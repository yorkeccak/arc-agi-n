"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import type { AuthUser } from "@/lib/oauth";

export function AccountMenu({ user, onSignIn, onSignOut }: {
  user?: AuthUser;
  onSignIn: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState(false);
  const [failedPicture, setFailedPicture] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const name = user?.name || user?.email.split("@")[0] || "Account";
  const picture = user?.picture?.startsWith("https://") && failedPicture !== user.picture ? user.picture : undefined;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    setError(false);
    try {
      await onSignOut();
      setOpen(false);
      buttonRef.current?.focus();
    } catch {
      setError(true);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div ref={rootRef} className="account-menu" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (open && event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }}>
      <button ref={buttonRef} className="account-avatar" aria-label={user ? `Account: ${name}` : "Sign in for DeepResearch"} title={user ? name : "Sign in for DeepResearch"} aria-expanded={user ? open : undefined} aria-controls={user ? "account-options" : undefined} onClick={() => user ? setOpen(!open) : onSignIn()}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailedPicture(picture)} />
        ) : user ? <span>{name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span> : <UserRound size={19} />}
      </button>
      {open && user && <div id="account-options" className="account-options">
        <strong>{name}</strong>
        <p>{user.email}</p>
        <button onClick={() => void signOut()} disabled={signingOut}><LogOut size={16} />{signingOut ? "Signing out…" : "Sign out"}</button>
        {error && <p role="alert">Could not sign out. Try again.</p>}
      </div>}
    </div>
  );
}
