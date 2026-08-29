import { serve } from '@hono/node-server';

import { createDemoMerchantMocksApp } from './test-harness.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The test-harness launcher must not run in production.');
}

const expectedAgentProof = process.env.DEMO_AGENT_REQUEST_PROOF;
if (!expectedAgentProof) {
  throw new Error('DEMO_AGENT_REQUEST_PROOF is required for the local demo launcher.');
}

const port = Number.parseInt(process.env.PORT ?? '3003', 10);
const app = createDemoMerchantMocksApp({
  expectedAgentProof,
  demoScenarioControl: process.env.DEMO_ADMIN_SECRET
    ? { secret: process.env.DEMO_ADMIN_SECRET }
    : undefined,
});

serve({ fetch: app.fetch, port });
