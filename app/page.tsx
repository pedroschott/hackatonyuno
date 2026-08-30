import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Fingerprint, ListChecks, Plug, ShieldOff } from "lucide-react";

import { Mark } from "@/components/Logo";

/**
 * Public landing page. It is static: no account state, no store polling.
 * Everything it claims is a behaviour the running product already has.
 */

export const metadata: Metadata = {
  title: "AgentPay — let your agent pay, on your terms",
  description:
    "Give your AI assistant a signed mandate instead of your card. Set the limit, approve it with a passkey, see every attempt, and revoke in one tap.",
};

const STEPS = [
  {
    icon: Plug,
    title: "Connect your assistant",
    body: "Paste one link into Claude, ChatGPT, Gemini or any MCP client and sign in to AgentPay once.",
  },
  {
    icon: ListChecks,
    title: "Your agent asks for a mandate",
    body: "It proposes exactly what it needs: an amount per purchase, a monthly cap, a store, a number of uses, an expiry.",
  },
  {
    icon: Fingerprint,
    title: "You sign it with a passkey",
    body: "Face ID or your security key, on your phone. Nothing can be charged until that signature exists.",
  },
  {
    icon: ShieldOff,
    title: "Revoke whenever you want",
    body: "One tap ends the mandate. A purchase already in flight is refused too, not settled quietly.",
  },
];

const FEATURES = [
  {
    title: "Limits that actually hold",
    body: "Every attempt is checked against the amount, merchant, use count and expiry you signed. Anything outside is refused, with a reason code the store can show.",
  },
  {
    title: "Nothing happens in the dark",
    body: "Approved or refused, every purchase attempt lands in your activity feed next to the mandate decision that produced it.",
  },
  {
    title: "Your card stays yours",
    body: "The agent never sees a card number. A verified checkout returns a single-use token for the one purchase it was authorized to make.",
  },
];

const CHECKOUT_SNIPPET = `import { createAgentPayCheckoutHandler } from "@agentpay/merchant-sdk";

const checkout = createAgentPayCheckoutHandler({
  merchantId: "merchant_example",
  registryUrl: "https://agentpay-yuno.vercel.app",
  resolveProduct: async (productId) => database.products.find(productId),
});

export async function POST(request: Request) {
  return checkout(request);
}`;

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <SiteHeader />

      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <Features />
        <ForDevelopers />
      </main>

      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1080px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="AgentPay home">
          <Mark />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">AgentPay</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Link href="/docs" className="rounded-md px-2.5 py-1.5 text-[13.5px] text-muted hover:bg-line-2 hover:text-ink">
            Docs
          </Link>
          <Link href="/store" className="hidden rounded-md px-2.5 py-1.5 text-[13.5px] text-muted hover:bg-line-2 hover:text-ink sm:inline-block">
            Demo store
          </Link>
          <Link
            href="/dashboard"
            className="ml-1 inline-flex h-8 items-center rounded-md bg-brand px-3 text-[13px] font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,.08),inset_0_1px_0_rgba(255,255,255,.15)] transition-colors hover:bg-brand-hover"
          >
            Open app
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="bg-[radial-gradient(110%_70%_at_50%_-10%,var(--color-brand-soft)_0%,var(--color-surface)_55%)]">
      <div className="mx-auto grid max-w-[1080px] gap-14 px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-brand-ink shadow-[var(--shadow-card)]">
            <span className="relative inline-flex size-1.5 rounded-full bg-brand text-brand ap-dot" />
            Payments for AI agents
          </span>

          <h1 className="mt-5 text-[38px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[52px]">
            Let your agent pay.
            <br />
            On your terms.
          </h1>

          <p className="mt-5 max-w-[560px] text-[17px] leading-[1.6] text-ink-2 sm:text-[19px]">
            AgentPay gives your assistant a narrow, signed mandate instead of your card. You set the limit, approve it
            with a passkey, watch every attempt it makes, and revoke it in one tap.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-brand px-5 text-[15px] font-medium text-white shadow-[0_1px_2px_rgba(26,31,54,.2),inset_0_1px_0_rgba(255,255,255,.15)] transition-colors hover:bg-brand-hover"
            >
              Open AgentPay <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/docs"
              className="inline-flex h-11 items-center rounded-md bg-white px-5 text-[15px] font-medium text-ink shadow-[var(--shadow-card)] transition-colors hover:bg-canvas"
            >
              Merchant docs
            </Link>
          </div>

          <p className="mt-4 text-[13px] text-muted">
            Works with Claude, ChatGPT, Gemini and any MCP client. The payment rail is mocked for this build.
          </p>
        </div>

        <MandatePreview />
      </div>
    </section>
  );
}

/**
 * A still of the real mandate card the app renders once an agent has asked for
 * one and the user has signed it. Static markup: the landing page reads no account state.
 */
function MandatePreview() {
  return (
    <div className="w-full rounded-xl bg-surface shadow-[var(--shadow-pop)]">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <span className="text-[16px] font-semibold text-ink">Claude</span>
        <span className="inline-flex items-center gap-1 rounded bg-success-soft px-1.5 py-0.5 text-[11.5px] font-medium leading-4 text-success-ink">
          <span className="size-1.5 rounded-full bg-current" />
          Active
        </span>
        <span className="font-mono text-[11.5px] text-faint sm:ml-auto">mnd_4f2a</span>
      </div>

      <p className="px-5 pt-1 text-[14px] text-ink-2">
        Authorized to charge up to <b className="text-ink">R$ 450,00</b> per purchase at AutoParts.
      </p>

      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
          <span className="text-muted">Left this month</span>
          <span className="tabular font-semibold text-ink">
            R$ 1.200,00 <span className="font-normal text-muted">of R$ 1.800,00</span>
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line-2">
          <div className="h-full w-1/3 rounded-full bg-brand" />
        </div>
        <div className="mt-2 flex justify-between text-[12.5px] text-muted">
          <span>2 of 5 purchases used</span>
          <span>Expires in 6d 4h</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <span className="text-[12.5px] text-muted">Signed with a passkey on 12 Aug</span>
        <span className="inline-flex h-8 items-center rounded-md bg-white px-3 text-[13px] font-medium text-danger-ink shadow-[var(--shadow-card)]">
          Revoke
        </span>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="border-y border-line bg-canvas">
      <div className="mx-auto max-w-[1080px] px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="max-w-[560px] text-[28px] font-semibold tracking-[-0.02em] text-ink sm:text-[34px]">
          Four steps, and the agent never holds your card
        </h2>

        <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <li key={title}>
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-md bg-brand-soft text-brand-ink">
                  <Icon className="size-4" />
                </span>
                <span className="font-mono text-[12px] text-faint">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="mt-3.5 text-[15px] font-semibold text-ink">{title}</h3>
              <p className="mt-1.5 text-[14px] leading-[1.6] text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="mx-auto max-w-[1080px] px-4 py-16 sm:px-6 sm:py-20">
      <h2 className="max-w-[560px] text-[28px] font-semibold tracking-[-0.02em] text-ink sm:text-[34px]">
        A mandate is a boundary, not a promise
      </h2>
      <p className="mt-3 max-w-[560px] text-[16px] leading-[1.6] text-muted">
        The limits you sign are enforced at the moment of purchase, by the store, against live mandate state.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {FEATURES.map(({ title, body }) => (
          <div key={title} className="rounded-lg bg-surface p-5 shadow-[var(--shadow-card)]">
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            <p className="mt-2 text-[14px] leading-[1.6] text-muted">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ForDevelopers() {
  return (
    <section className="mx-auto max-w-[1080px] px-4 pb-20 sm:px-6 sm:pb-24">
      <div className="overflow-hidden rounded-2xl bg-ink text-white">
        <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:items-center lg:gap-12">
          <div>
            <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-white/45">For developers</span>
            <h2 className="mt-3 text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[32px]">
              Accept agent purchases in two routes
            </h2>
            <p className="mt-4 text-[15px] leading-[1.65] text-white/65">
              Your store publishes <code className="font-mono text-[13.5px] text-white/85">/.well-known/agentpay.json</code>{" "}
              and protects one checkout endpoint. The SDK verifies the agent signature, the mandate signature, live
              mandate status, the nonce and every policy limit before you charge anything.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/quickstart"
                className="inline-flex h-10 items-center gap-1.5 rounded-md bg-white px-4 text-[14px] font-medium text-ink transition-colors hover:bg-white/90"
              >
                Read the quickstart <ArrowRight className="size-4" />
              </Link>
              <Link href="/docs/reference" className="text-[14px] text-white/65 transition-colors hover:text-white">
                SDK reference
              </Link>
            </div>
          </div>

          <pre className="overflow-x-auto rounded-lg bg-white/[0.06] p-4 font-mono text-[12.5px] leading-[1.7] text-white/80 sm:p-5 sm:text-[13px]">
            <code>{CHECKOUT_SNIPPET}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-[13px] text-muted sm:px-6">
        <span className="inline-flex items-center gap-2 font-medium text-ink">
          <Mark size={18} /> AgentPay
        </span>
        <Link href="/docs" className="hover:text-ink">
          Merchant docs
        </Link>
        <Link href="/store" className="hover:text-ink">
          Demo store
        </Link>
        <Link href="/connect" className="hover:text-ink">
          Connect an agent
        </Link>
        <Link href="/privacy" className="hover:text-ink">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-ink">
          Terms
        </Link>
        <a
          href="https://github.com/pedroschott/hackatonyuno"
          target="_blank"
          rel="noreferrer"
          className="hover:text-ink"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
