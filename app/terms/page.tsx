import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | AgentPay",
  description: "The terms that govern use of AgentPay.",
};

const EFFECTIVE_DATE = "August 30, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <Link href="/" className="text-sm text-muted hover:text-ink">
        ← Back to AgentPay
      </Link>
      <article className="mt-8 text-[15px] leading-7 text-muted">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Terms of Service</h1>
        <p className="mt-2 text-sm">Effective date: {EFFECTIVE_DATE}</p>
        <p className="mt-8">By using AgentPay, you agree to these Terms of Service.</p>

        <Section title="The Service">
          <p>
            AgentPay lets you give an AI agent a narrowly scoped mandate, approve that mandate with a passkey, and revoke it.
            A mandate is not a blank authorization: it is limited to the merchant, product or category, amount, frequency, and
            other limits shown to you when you approve it.
          </p>
        </Section>

        <Section title="Your responsibilities">
          <p>
            You must provide accurate information, keep control of your account and devices, review every mandate before
            approving it, and revoke a mandate when you no longer want it to be usable. Do not use the Service for unlawful,
            fraudulent, abusive, or security-testing activity without authorization.
          </p>
        </Section>

        <Section title="Agents, merchants, and purchases">
          <p>
            You choose whether to connect an agent and whether to approve a mandate. AgentPay does not select products,
            merchants, or purchases for you. Merchants remain responsible for their products, prices, fulfilment, refunds,
            and customer support. Their terms and policies apply to your transaction with them.
          </p>
        </Section>

        <Section title="Challenge implementation">
          <p>
            AgentPay is a hackathon project and its payment rail is mocked. It is not a bank, card network, payment processor,
            or custodial wallet. Do not rely on the Service to move real money or to make production payment decisions.
          </p>
        </Section>

        <Section title="Availability and changes">
          <p>
            We may change, suspend, or discontinue the Service or these Terms. We do not guarantee uninterrupted or error-free
            operation. We may suspend access when reasonably necessary to protect users, merchants, or the Service.
          </p>
        </Section>

        <Section title="Disclaimers and liability">
          <p>
            To the extent permitted by law, the Service is provided “as is” and “as available,” without warranties of any kind.
            AgentPay is not responsible for an agent’s choices, merchant conduct, product quality, fulfilment, or indirect,
            incidental, special, consequential, or punitive damages arising from use of the Service.
          </p>
        </Section>

        <Section title="Privacy and contact">
          <p>
            Our <Link className="underline hover:text-ink" href="/privacy">Privacy Policy</Link> explains how we handle
            personal information. For questions about these Terms, use the{" "}
            <a className="underline hover:text-ink" href="https://github.com/pedroschott/hackatonyuno/issues">project support channel</a>.
          </p>
        </Section>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
