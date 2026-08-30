import type { MetadataRoute } from "next";

import { DOC_PAGES } from "@/components/docs/nav";
import { agentPayBaseUrl } from "@/lib/env";

/**
 * Only include public, canonical HTML surfaces here. Authenticated screens,
 * OAuth callbacks and machine endpoints are described in docs/routes.md but
 * must never be suggested to search crawlers as content pages.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = agentPayBaseUrl();

  return [
    ...DOC_PAGES.map((page) => ({
      url: new URL(page.href, baseUrl).toString(),
      changeFrequency: "weekly" as const,
      priority: page.href === "/docs" ? 0.9 : 0.7,
    })),
    {
      url: new URL("/connect", baseUrl).toString(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: new URL("/store", baseUrl).toString(),
      changeFrequency: "weekly",
      priority: 0.6,
    },
  ];
}
