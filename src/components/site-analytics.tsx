"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { useEffect } from "react";
import { analyticsEnabled, analyticsUrl, trackRememberedSignIn } from "@/lib/analytics";

function beforeSend(event: BeforeSendEvent) {
  const url = analyticsUrl(event.url);
  return url ? { ...event, url } : null;
}

export function SiteAnalytics() {
  useEffect(() => { trackRememberedSignIn(); }, []);
  return analyticsEnabled ? <Analytics beforeSend={beforeSend} debug={false} /> : null;
}
