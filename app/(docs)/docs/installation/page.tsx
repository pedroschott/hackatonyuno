import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, DataTable, LI, Lead, List, P } from "@/components/docs/prose";

const HREF = "/docs/installation";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <Lead>
          <C>@agentpay/merchant-sdk</C> is built from the AgentPay repository rather than pulled from the public npm
          registry. Pick the one-command path if you just want it working, or the manual path if you want to see every
          step.
        </Lead>
      }
      sections={[
        {
          id: "requirements",
          title: "Requirements",
          body: (
            <DataTable
              head={["Requirement", "Why"]}
              rows={[
                ["Node.js 22 or newer", "The package declares engines >= 22 and verification uses node:crypto."],
                ["zod 4", "The SDK validates every registry response. npm installs it for you as a dependency."],
                [
                  "Web Request / Response",
                  "The handler takes a Request and returns a Response, so any modern framework works.",
                ],
                [
                  "A public HTTPS origin",
                  "Agents call your manifest and checkout from the internet. Use a tunnel while developing.",
                ],
              ]}
            />
          ),
        },
        {
          id: "one-command",
          title: "Option A — one command (recommended)",
          body: (
            <>
              <P>
                From a clone of the AgentPay repository, point the installer at your store. It builds the package, packs
                a tarball, copies it into <C>vendor/</C> inside your project, and installs it there.
              </P>
              <CodeBlock
                lang="bash"
                code={`git clone https://github.com/pedroschott/hackatonyuno.git
cd hackatonyuno
npm install
npm run sdk:install -- ~/code/my-store`}
              />
              <P>Your store&apos;s manifest gains a relative, committable dependency:</P>
              <CodeBlock
                lang="json"
                filename="my-store/package.json"
                code={`{
  "dependencies": {
    "@agentpay/merchant-sdk": "file:vendor/agentpay-merchant-sdk-0.1.0.tgz"
  }
}`}
              />
              <Callout tone="tip" title="Commit the tarball">
                <p>
                  Committing <C>vendor/agentpay-merchant-sdk-0.1.0.tgz</C> makes your build reproducible on CI and on a
                  teammate&apos;s machine without cloning AgentPay. It is about 20 KB.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "manual",
          title: "Option B — pack and install manually",
          body: (
            <>
              <P>Same result, one step at a time:</P>
              <CodeBlock
                lang="bash"
                code={`# in the AgentPay repository
npm run sdk:pack          # writes dist/agentpay-merchant-sdk-0.1.0.tgz

# in your store
mkdir -p vendor
cp ../hackatonyuno/dist/agentpay-merchant-sdk-0.1.0.tgz vendor/
npm install ./vendor/agentpay-merchant-sdk-0.1.0.tgz`}
              />
              <P>
                <C>sdk:pack</C> runs <C>sdk:build</C> first, which compiles ESM, CJS and type declarations with tsup and
                writes the release <C>package.json</C>. Both module formats and the <C>.d.ts</C> ship in the tarball.
              </P>
            </>
          ),
        },
        {
          id: "monorepo",
          title: "Option C — inside this repository",
          body: (
            <>
              <P>
                If your store lives in this repository, skip packaging entirely and import the source through the path
                alias, the way the AutoParts demo store does:
              </P>
              <CodeBlock lang="ts" code={`import { createAgentPayCheckoutHandler, merchantManifest } from "@/sdk";`} />
              <P>
                See <C>app/api/store/checkout/route.ts</C> and <C>app/.well-known/agentpay.json/route.ts</C> for the two
                routes exactly as a merchant would write them.
              </P>
            </>
          ),
        },
        {
          id: "verify",
          title: "Verify the install",
          body: (
            <>
              <CodeBlock
                lang="bash"
                code={`node --input-type=module -e "
import { merchantManifest } from '@agentpay/merchant-sdk';
console.log(merchantManifest({
  origin: 'https://my-store.example',
  merchantId: 'mrc_demo_store',
  merchantName: 'Demo Store',
}));
"`}
              />
              <P>
                A manifest object printed to your terminal means resolution, module format and types are all correct. If
                you get <C>ERR_MODULE_NOT_FOUND</C>, the tarball path in <C>package.json</C> is wrong; re-run the
                installer.
              </P>
            </>
          ),
        },
        {
          id: "configure",
          title: "Configure your store",
          body: (
            <>
              <P>Two values, both non-secret. The SDK needs no API key: every check is cryptographic or public.</P>
              <CodeBlock
                lang="bash"
                filename=".env.local"
                code={`AGENTPAY_MERCHANT_ID=mrc_demo_store
AGENTPAY_REGISTRY_URL=https://agentpay-yuno.vercel.app`}
              />
              <List>
                <LI>
                  <C>AGENTPAY_MERCHANT_ID</C> — your stable slug. Mandates are scoped to it, so treat it as permanent.
                </LI>
                <LI>
                  <C>AGENTPAY_REGISTRY_URL</C> — the AgentPay deployment your buyers use. Point it at{" "}
                  <C>http://localhost:3210</C> to run against a local AgentPay.
                </LI>
              </List>
              <Callout tone="warn" title="There is no merchant secret">
                <p>
                  If a checkout request verifies, it is because the agent and the registry signed it — not because a
                  shared key was presented. Never add a bypass header or an allowlist that skips the handler.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "upgrading",
          title: "Upgrading",
          body: (
            <>
              <P>
                Re-run the installer. It rebuilds from the current checkout, overwrites the vendored tarball and
                reinstalls:
              </P>
              <CodeBlock lang="bash" code={`git -C ../hackatonyuno pull && npm run sdk:install -- ~/code/my-store`} />
              <P>
                The verification protocol is versioned by <C>protocol: &quot;agentpay/1.0&quot;</C> in the manifest. A
                breaking change to the signed request format will change that string, and both sides refuse a version
                they do not understand. Track changes in{" "}
                <A href="https://github.com/pedroschott/hackatonyuno/blob/main/docs/decisions.md">the decision log</A>.
              </P>
            </>
          ),
        },
        {
          id: "agentpay-operator",
          title: "AgentPay operator configuration",
          body: (
            <>
              <P>
                Merchants do not need email-provider or identity-provider credentials. AgentPay&apos;s hosted Supabase
                Auth service sends its own transactional email through Resend. Only contributors running the local
                Supabase stack need to set the server-only <C>RESEND_API_KEY</C> value before starting Supabase.
              </P>
              <CodeBlock lang="bash" code={`export RESEND_API_KEY=re_your_resend_api_key\nsupabase start`} />
              <Callout tone="warn" title="Keep provider credentials server-only">
                <p>
                  Never prefix these values with <C>NEXT_PUBLIC_</C> or commit them. Supabase reads the Resend key
                  directly from the operator environment for local Auth email delivery; do not add that key to Vercel.
                </p>
              </Callout>
              <P>
                These values configure the AgentPay deployment, not a merchant store. Didit credentials and the
                Supabase secret key stay server-only and must never use a <C>NEXT_PUBLIC_</C> prefix.
              </P>
              <CodeBlock
                lang="bash"
                filename=".env.local"
                code={`SUPABASE_SECRET_KEY=your-supabase-secret-key
DIDIT_API_KEY=your-didit-api-key
DIDIT_WORKFLOW_ID=00000000-0000-0000-0000-000000000000
DIDIT_WEBHOOK_SECRET=your-webhook-destination-secret`}
              />
              <P>
                Configure the Didit v3 destination at <C>https://your-agentpay-host/api/webhooks/didit</C> for
                <C>status.updated</C>, <C>data.updated</C>, <C>user.status.updated</C>, and <C>user.data.updated</C>.
                The selected workflow controls which document, liveness, AML, IP, and fraud checks run.
              </P>
            </>
          ),
        },
      ]}
    />
  );
}
