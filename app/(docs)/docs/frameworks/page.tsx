import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { A, C, Callout, CodeBlock, LI, Lead, List, P } from "@/components/docs/prose";

const HREF = "/docs/frameworks";

export const metadata = docMetadata(HREF);

export default function Page() {
  return (
    <DocPage
      href={HREF}
      intro={
        <>
          <Lead>
            The handler takes a Web <C>Request</C> and returns a Web <C>Response</C>. Frameworks that speak that natively
            need one line; the rest need a small adapter that preserves two things: the <strong>raw body bytes</strong>{" "}
            and the <strong>request path</strong>.
          </Lead>
          <Callout tone="warn" title="Why raw bytes matter">
            <p>
              The agent signs <C>sha256(body)</C> over the exact bytes it sent. A JSON body parser that re-serializes —
              reordering keys, changing spacing — produces a different hash and every request fails with{" "}
              <C>AGENT_SIGNATURE_INVALID</C>.
            </p>
          </Callout>
        </>
      }
      sections={[
        {
          id: "nextjs",
          title: "Next.js (App Router)",
          body: (
            <>
              <P>Native. Hand the request straight to the handler.</P>
              <CodeBlock
                lang="ts"
                filename="app/api/agentpay/checkout/route.ts"
                code={`import { checkout } from "@/lib/agentpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return checkout(request);
}`}
              />
              <P>
                <C>dynamic = &quot;force-dynamic&quot;</C> keeps the route out of any static or data cache;{" "}
                <C>runtime = &quot;nodejs&quot;</C> guarantees <C>node:crypto</C>.
              </P>
            </>
          ),
        },
        {
          id: "hono",
          title: "Hono",
          body: (
            <>
              <P>Also native — Hono hands you the same Request object.</P>
              <CodeBlock
                lang="ts"
                filename="src/checkout.ts"
                code={`import { Hono } from "hono";
import { checkout } from "./agentpay";

export const routes = new Hono().post("/api/agentpay/checkout", (c) => checkout(c.req.raw));`}
              />
              <P>
                Use <C>c.req.raw</C>, not <C>c.req.json()</C>. Reading the body first consumes it and breaks
                verification.
              </P>
            </>
          ),
        },
        {
          id: "express",
          title: "Express",
          body: (
            <>
              <P>
                Mount <C>express.raw</C> on this route only, then translate both directions. Do not let a global{" "}
                <C>express.json()</C> run first.
              </P>
              <CodeBlock
                lang="ts"
                filename="src/server.ts"
                code={`import express from "express";
import { checkout } from "./agentpay";

const app = express();

app.post("/api/agentpay/checkout", express.raw({ type: "*/*" }), async (req, res) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }

  const request = new Request(new URL(req.originalUrl, \`\${req.protocol}://\${req.get("host")}\`), {
    method: "POST",
    headers,
    body: req.body,
  });

  const response = await checkout(request);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
});`}
              />
              <Callout tone="note" title="Register the raw parser before any global JSON parser">
                <p>
                  If <C>app.use(express.json())</C> runs earlier in the chain, <C>req.body</C> is already an object and{" "}
                  <C>express.raw</C> has nothing left to read.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "fastify",
          title: "Fastify",
          body: (
            <>
              <P>Tell Fastify to keep JSON as a string for this route, then adapt as above.</P>
              <CodeBlock
                lang="ts"
                filename="src/server.ts"
                code={`import Fastify from "fastify";
import { checkout } from "./agentpay";

const app = Fastify();

// Keep the exact bytes the agent signed.
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

app.post("/api/agentpay/checkout", async (request, reply) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }

  const response = await checkout(
    new Request(new URL(request.url, \`\${request.protocol}://\${request.hostname}\`), {
      method: "POST",
      headers,
      body: request.body as string,
    }),
  );

  reply.status(response.status);
  response.headers.forEach((value, key) => reply.header(key, value));
  return Buffer.from(await response.arrayBuffer());
});`}
              />
            </>
          ),
        },
        {
          id: "edge",
          title: "Cloudflare Workers, Deno and edge runtimes",
          body: (
            <>
              <P>
                Request and Response are native, but signature verification calls <C>node:crypto</C>. Before deploying a
                checkout route to an edge runtime, confirm Ed25519 verification actually works there — on Workers that
                means <C>nodejs_compat</C>, and you should prove it with a signed request rather than assume it.
              </P>
              <List>
                <LI>
                  <strong>Deno and Bun</strong> implement <C>node:crypto</C> Ed25519 and work today.
                </LI>
                <LI>
                  <strong>Cloudflare Workers</strong>: enable <C>nodejs_compat</C> and run the signed-request test from{" "}
                  <A href="/docs/testing">Test the integration</A> against a deployed preview.
                </LI>
                <LI>
                  <strong>Vercel Edge Functions</strong>: keep this route on the Node runtime. Everything else in your
                  store can stay on the edge.
                </LI>
              </List>
              <Callout tone="tip" title="A safe fallback">
                <p>
                  If your storefront must be edge-only, host just the checkout route on a small Node service and point{" "}
                  <C>checkout_endpoint</C> at it. The manifest is the only thing that needs to agree.
                </p>
              </Callout>
            </>
          ),
        },
        {
          id: "proxies",
          title: "Proxies, rewrites and gateways",
          body: (
            <>
              <P>
                The signature covers the <strong>path</strong> the agent called. Anything that rewrites the path between
                the agent and your handler invalidates it.
              </P>
              <List>
                <LI>
                  A rewrite from <C>/api/agentpay/checkout</C> to <C>/internal/checkout</C> breaks verification. Proxy
                  the path unchanged instead.
                </LI>
                <LI>
                  A gateway that strips or normalizes headers must preserve <C>x-agent-id</C>, <C>x-timestamp</C>,{" "}
                  <C>x-nonce</C> and <C>x-signature</C>.
                </LI>
                <LI>
                  Compression or body transformation middleware must not touch the request body on this route.
                </LI>
                <LI>
                  Keep the host in <C>checkout_endpoint</C> equal to the host agents actually reach; the path is what is
                  signed, but a redirect chain usually drops the body.
                </LI>
              </List>
            </>
          ),
        },
        {
          id: "checklist",
          title: "Adapter checklist",
          body: (
            <List>
              <LI>The handler receives the untouched body bytes.</LI>
              <LI>
                <C>new URL(request.url).pathname</C> inside the handler equals the path the agent posted to.
              </LI>
              <LI>All four signature headers survive the hop.</LI>
              <LI>The status code from the handler is what your framework returns — do not flatten refusals into 200 or 500.</LI>
              <LI>The route runs on a runtime with working Ed25519 verification.</LI>
            </List>
          ),
        },
      ]}
    />
  );
}
