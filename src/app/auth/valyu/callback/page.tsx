"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { safeReturnPath } from "@/lib/oauth";
import { rememberSignIn, trackEvent } from "@/lib/analytics";

export default function OAuthCallbackPage() {
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    const finish = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");

        if (!code || !state) {
          if (active) { trackEvent("sign_in_failed"); setError("This sign-in link is invalid or expired."); }
          return;
        }

        const response = await fetch("/api/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state }),
        });
        if (!response.ok) {
          if (active) { trackEvent("sign_in_failed"); setError("Valyu sign-in could not be completed."); }
          return;
        }
        const data = await response.json() as { returnTo?: string };
        if (!active) return;
        rememberSignIn();
        window.location.replace(safeReturnPath(data.returnTo, window.location.origin));
      } catch {
        if (active) { trackEvent("sign_in_failed"); setError("Valyu sign-in could not be completed."); }
      }
    };
    void finish();
    return () => { active = false; };
  }, []);

  return <main className="callback-page">{error ? <><b>Sign-in failed</b><p>{error}</p><Link href="/">Return to the atlas</Link></> : <><LoaderCircle className="spin" /><span>Connecting to Valyu</span></>}</main>;
}
