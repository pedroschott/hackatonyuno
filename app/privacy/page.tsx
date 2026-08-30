import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | AgentPay",
  description: "How AgentPay collects, uses, and protects personal information.",
};

const EFFECTIVE_DATE = "August 30, 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <Link href="/" className="text-sm text-muted hover:text-ink">
        ← Back to AgentPay
      </Link>
      <article className="mt-8 text-[15px] leading-7 text-muted">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Privacy Policy</h1>
        <p className="mt-2 text-sm">Effective date: {EFFECTIVE_DATE}</p>
        <p className="mt-8">
          This policy explains how AgentPay handles information when you use the website, account, merchant console, and
          agent connection services (collectively, the “Service”). AgentPay is an authorization layer for agent purchases;
          it is not a card processor or a marketplace.
        </p>

        <Section title="Information we collect">
          <p>
            We collect account and profile information you provide, such as your email address, legal name, contact details,
            delivery address, and compliance details. We also process passkey credential metadata, connected-agent details,
            mandate and approval records, purchase-attempt records, merchant-console information, and security and audit logs.
          </p>
          <p>
            For saved payment methods, AgentPay stores only non-sensitive display metadata and an opaque mock-vault reference.
            It does not store raw card numbers, CVCs, PINs, or banking passwords.
          </p>
        </Section>

        <Section title="Identity verification">
          <p>
            Identity and fraud verification are provided through Didit. AgentPay retains only the minimum session and status
            information needed to decide whether a mandate or one-time approval can proceed. Identity documents, images,
            biometrics, provider tokens, and the full verification decision remain with Didit. Didit’s own notices and terms
            govern its service.
          </p>
        </Section>

        <Section title="How we use information">
          <p>
            We use information to operate the Service; authenticate accounts; create, display, authorize, enforce, and revoke
            mandates; prevent fraud and replay; maintain security logs; provide support; and comply with applicable law. We do
            not sell personal information or use it for targeted advertising.
          </p>
        </Section>

        <Section title="How information is shared">
          <p>
            We share information only as needed to provide the Service: with infrastructure and authentication providers,
            Didit for verification, and a merchant involved in a requested purchase. A merchant receives only the information
            necessary to verify a signed request and fulfil an approved order. Each merchant’s privacy practices apply to its
            own handling of that information.
          </p>
        </Section>

        <Section title="Security and retention">
          <p>
            We use technical and organizational measures designed to protect information, including authenticated sessions,
            passkey ceremonies, signed requests, replay protection, and audit logging. No system is perfectly secure. We keep
            information only as long as reasonably necessary for the purposes above, including security, dispute, and legal
            recordkeeping needs.
          </p>
        </Section>

        <Section title="Your choices and rights">
          <p>
            You can update account information, revoke active mandates, and remove eligible saved payment methods from your
            account. Depending on where you live, you may have rights to request access, correction, deletion, or portability
            of your personal information, or to object to certain processing. We may need to verify your identity before
            responding and may retain information where required for security or legal obligations.
          </p>
        </Section>

        <Section title="Children and changes">
          <p>
            The Service is not directed to children. We may update this policy as the Service changes; we will post the new
            effective date on this page.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            For privacy questions or requests, contact the AgentPay team through the{" "}
            <a className="underline hover:text-ink" href="https://github.com/pedroschott/hackatonyuno/issues">
              project support channel
            </a>
            . Your use of the Service is also governed by our <Link className="underline hover:text-ink" href="/terms">Terms of Service</Link>.
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
