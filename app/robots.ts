import type { MetadataRoute } from "next";

import { agentPayBaseUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = agentPayBaseUrl();

  return {
    rules: {
      userAgent: "*",
      allow: ["/connect", "/store", "/.well-known/agentpay.json"],
      disallow: [
        "/api/",
        "/mcp",
        "/oauth/",
        "/dashboard",
        "/activity",
        "/audit",
        "/payment-methods/",
        "/m/",
      ],
    },
    sitemap: new URL("/sitemap.xml", baseUrl).toString(),
  };
}
