#!/usr/bin/env node
/**
 * Build, pack and install @agentpay/merchant-sdk into a merchant project.
 *
 *   npm run sdk:install -- ../my-store
 *
 * The tarball is copied into <target>/vendor so the resulting dependency is a
 * committable relative path rather than a machine-specific absolute one.
 */
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function fail(message) {
  console.error(`\nsdk:install — ${message}\n`);
  process.exit(1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) fail(`\`${command} ${args.join(" ")}\` failed in ${cwd}`);
}

const targetArg = process.argv[2];
if (!targetArg) {
  fail("pass the merchant project directory, for example: npm run sdk:install -- ../my-store");
}

const target = isAbsolute(targetArg) ? targetArg : resolve(process.cwd(), targetArg);
try {
  await stat(join(target, "package.json"));
} catch {
  fail(`no package.json found in ${target}. Point at the root of the merchant project.`);
}

console.log("→ building and packing @agentpay/merchant-sdk");
run("npm", ["run", "sdk:pack"], repoRoot);

const distDir = join(repoRoot, "dist");
const tarballs = (await readdir(distDir)).filter((file) => /^agentpay-merchant-sdk-.*\.tgz$/.test(file)).sort();
const tarball = tarballs.at(-1);
if (!tarball) fail("no packed tarball found in dist/. Run `npm run sdk:pack` and check its output.");

const vendorDir = join(target, "vendor");
await mkdir(vendorDir, { recursive: true });
await copyFile(join(distDir, tarball), join(vendorDir, tarball));
console.log(`→ copied ${tarball} to ${join(basename(target), "vendor")}`);

console.log(`→ installing into ${target}`);
run("npm", ["install", `./vendor/${tarball}`], target);

console.log(`
Installed @agentpay/merchant-sdk in ${target}

Next:
  1. Publish  app/.well-known/agentpay.json/route.ts   (merchantManifest)
  2. Protect  app/api/agentpay/checkout/route.ts       (createAgentPayCheckoutHandler)

Guide: https://agentpay-yuno.vercel.app/docs/quickstart
`);
