import { Building2, Store } from "lucide-react";

import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, Cards, CodeBlock, Lead, LinkCard, P, Steps, Step } from "@/components/docs/prose";

const HREF = "/docs/stores";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <>
          <Lead>
            AgentPay Developers is the control plane for merchant identity. It assigns the merchant ID that buyers put
            into mandates, creates hosted mock stores for end-to-end testing, and verifies live stores before they may
            appear in the public supported-store registry.
          </Lead>
          <Cards>
            <LinkCard href="/developers" icon={<Building2 className="size-4" />} title="Open merchant console" description="Create merchants, products, API keys, and inspect checkout activity." />
            <LinkCard href="/developers/merchants/new" icon={<Store className="size-4" />} title="Create a test store" description="Get a working catalog, manifest, and checkout endpoint immediately." />
          </Cards>
        </>
      }
      sections={[
        {
          id: "merchant-onboarding",
          title: "Merchant onboarding",
          body: (
            <Steps>
              <Step n={1} title="Sign in with Supabase Auth">
                <P>The same AgentPay identity can own buyer data and one or more developer merchants. A developer account does not require a buyer passkey.</P>
              </Step>
              <Step n={2} title="Choose test or live">
                <P>A hosted test merchant is immediately agent-ready. A live merchant remains inactive until its public HTTPS discovery document passes verification.</P>
              </Step>
              <Step n={3} title="Receive the immutable merchant ID">
                <P>AgentPay generates the <C>mrc_…</C> identifier. It cannot be edited because signed mandates may refer to it.</P>
              </Step>
              <Step n={4} title="Integrate and test" last>
                <P>Add products in the UI or with a one-time-revealed server API key, then use the displayed manifest and checkout URLs for a complete agent purchase.</P>
              </Step>
            </Steps>
          ),
        },
        {
          id: "supported-stores",
          title: "Supported live stores",
          body: (
            <>
              <Callout tone="note" title="There are no public live stores yet">
                <p>
                  The list is intentionally empty until a real merchant verifies its domain and opts into public
                  listing. Seed merchants and hosted developer stores are test fixtures and are never presented as
                  third-party support.
                </p>
              </Callout>
              <P>
                The human view is at <A href="/developers/stores">/developers/stores</A>. Agents and other clients can
                read the same URLs from the public endpoint:
              </P>
              <CodeBlock lang="bash" code="curl https://agentpay-yuno.vercel.app/api/stores" />
              <P>
                Each result contains the merchant ID, store URL, and exact discovery URL. Product research still
                happens on the merchant&apos;s own site; AgentPay neither mirrors catalogs nor chooses products.
              </P>
            </>
          ),
        },
        {
          id: "hosted-test-store",
          title: "Hosted test-store URLs",
          body: (
            <>
              <P>For a merchant ID such as <C>mrc_abc123</C>, the console creates these shareable test surfaces:</P>
              <CodeBlock
                lang="text"
                code={`Storefront  https://agentpay-yuno.vercel.app/stores/mrc_abc123
Manifest    https://agentpay-yuno.vercel.app/api/stores/mrc_abc123/agentpay.json
Checkout    https://agentpay-yuno.vercel.app/api/stores/mrc_abc123/checkout
Catalog API https://agentpay-yuno.vercel.app/api/v1/merchants/mrc_abc123/products`}
              />
              <Callout tone="warn" title="Test stores are unlisted">
                <p>The URLs work when shared, but they do not enter the public supported-store list and should never be represented as production merchants.</p>
              </Callout>
            </>
          ),
        },
      ]}
    />
  );
}
