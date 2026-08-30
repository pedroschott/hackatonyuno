import type { MetadataRoute } from "next";

import { agentPayBaseUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = agentPayBaseUrl();

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/docs", "/connect", "/store", "/.well-known/agentpay.json"],
      disallow: [
        "/api/",
        "/mcp",
        "/oauth/",
        "/dashboard",
        "/developers",
        "/stores/",
        "/activity",
        "/account",
        "/audit",
        "/payment-methods/",
        "/m/",
      ],
    },
    sitemap: new URL("/sitemap.xml", baseUrl).toString(),
  };
}
