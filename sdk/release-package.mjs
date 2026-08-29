import { writeFile } from "node:fs/promises";

const packageJson = {
  name: "@agentpay/merchant-sdk",
  version: "0.1.0",
  description: "Store-owned discovery and cryptographic checkout verification for AgentPay",
  license: "MIT",
  main: "./index.js",
  module: "./index.mjs",
  types: "./index.d.ts",
  exports: {
    ".": {
      types: "./index.d.ts",
      import: "./index.mjs",
      require: "./index.js",
    },
  },
  files: ["index.js", "index.mjs", "index.d.ts", "index.d.mts", "README.md"],
  dependencies: { zod: "^4.5.4" },
  engines: { node: ">=22" },
};

const readme = `# @agentpay/merchant-sdk

Publish store-owned AgentPay discovery metadata and protect a checkout route with request, registry-signature, live-status, replay, and deterministic policy verification.

See the complete integration guide at https://github.com/pedroschott/hackatonyuno/blob/main/docs/merchant-sdk.md.
`;

await Promise.all([
  writeFile(new URL("../dist/sdk/package.json", import.meta.url), `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(new URL("../dist/sdk/README.md", import.meta.url), readme),
]);
