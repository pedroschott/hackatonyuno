import type { Metadata } from "next";
import { Suspense } from "react";

import { OAuthConsent } from "./consent";

export const metadata: Metadata = { title: "Connect agent" };

export default function ConsentPage() {
  return <Suspense fallback={<div className="min-h-screen bg-canvas" />}><OAuthConsent /></Suspense>;
}
