/**
 * Single source of truth for the documentation site: sidebar order, page
 * titles, search index and previous/next links all read from here, so adding a
 * page means adding one entry.
 */

export type DocPageMeta = {
  href: string;
  title: string;
  description: string;
  /** Extra terms the search box should match beyond the title and description. */
  keywords?: string[];
};

export type DocGroup = {
  label: string;
  pages: DocPageMeta[];
};

export const DOC_GROUPS: DocGroup[] = [
  {
    label: "Get started",
    pages: [
      {
        href: "/docs",
        title: "Introduction",
        description: "What the AgentPay merchant SDK does for your store, and the shortest path to a working integration.",
        keywords: ["overview", "agentpay", "merchant", "sdk", "start"],
      },
      {
        href: "/docs/quickstart",
        title: "Quickstart",
        description: "Accept agent purchases from a new store in five minutes with two copy-paste routes.",
        keywords: ["5 minutes", "copy paste", "first integration", "hello world"],
      },
      {
        href: "/docs/installation",
        title: "Install the SDK",
        description: "Requirements, the one-command installer, and the manual tarball install for @agentpay/merchant-sdk.",
        keywords: ["npm", "install", "tarball", "pack", "node", "requirements"],
      },
      {
        href: "/docs/stores",
        title: "Merchant console and stores",
        description: "Create a merchant ID and hosted test store, then see which verified live stores AgentPay supports.",
        keywords: ["merchant id", "developer dashboard", "console", "supported stores", "mock store", "api key"],
      },
    ],
  },
  {
    label: "Integrate",
    pages: [
      {
        href: "/docs/discovery",
        title: "Publish discovery",
        description: "Serve /.well-known/agentpay.json so an agent that lands on your product page can find your checkout.",
        keywords: ["well-known", "manifest", "agentpay.json", "discovery"],
      },
      {
        href: "/docs/checkout",
        title: "Protect checkout",
        description: "Wrap your checkout route with the verifying handler and act on approved, escalated and refused decisions.",
        keywords: ["handler", "verify", "charge", "policy", "decision"],
      },
      {
        href: "/docs/frameworks",
        title: "Framework recipes",
        description: "Working route code for Next.js, Hono, Express, Fastify and Cloudflare Workers.",
        keywords: ["next.js", "express", "hono", "fastify", "cloudflare", "workers", "vercel"],
      },
      {
        href: "/docs/testing",
        title: "Test the integration",
        description: "Sign a request locally, replay the attack suite, and rehearse a live revocation before you demo.",
        keywords: ["test", "attack suite", "revocation", "curl", "vitest"],
      },
    ],
  },
  {
    label: "Agents",
    pages: [
      {
        href: "/docs/agents",
        title: "Agent integration",
        description: "The MCP tool order, what each result means, and how an agent acts on every decision without guessing.",
        keywords: ["mcp", "find_products", "create_mandate", "check_purchase", "amend_mandate", "purchase", "agent", "tools"],
      },
    ],
  },
  {
    label: "Reference",
    pages: [
      {
        href: "/docs/reference",
        title: "SDK reference",
        description: "Every exported function and type in @agentpay/merchant-sdk.",
        keywords: ["api", "merchantManifest", "createAgentPayCheckoutHandler", "signAgentPayRequest", "types"],
      },
      {
        href: "/docs/reference/protocol",
        title: "Protocol and registry",
        description: "The signed request format and the four registry endpoints the handler calls on every purchase.",
        keywords: ["ed25519", "signature", "nonce", "registry", "headers", "canonical"],
      },
      {
        href: "/docs/reference/decisions",
        title: "Decisions and reason codes",
        description: "Every decision the policy engine can return and what your store should do about it.",
        keywords: ["reason code", "refused", "escalated", "approved", "errors"],
      },
      {
        href: "/docs/troubleshooting",
        title: "Troubleshooting",
        description: "The failures merchants actually hit, with the one-line cause and fix for each.",
        keywords: ["401", "clock skew", "body parser", "nonce", "debug", "errors"],
      },
    ],
  },
];

export const DOC_PAGES: DocPageMeta[] = DOC_GROUPS.flatMap((group) => group.pages);

export function docMeta(href: string): DocPageMeta {
  const page = DOC_PAGES.find((candidate) => candidate.href === href);
  if (!page) throw new Error(`Unknown documentation page: ${href}`);
  return page;
}

export function docGroupLabel(href: string): string {
  return DOC_GROUPS.find((group) => group.pages.some((page) => page.href === href))?.label ?? "Docs";
}

export function docNeighbors(href: string): { previous: DocPageMeta | null; next: DocPageMeta | null } {
  const index = DOC_PAGES.findIndex((page) => page.href === href);
  return {
    previous: index > 0 ? DOC_PAGES[index - 1] : null,
    next: index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : null,
  };
}
