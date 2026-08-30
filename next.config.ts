import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server may be reached from 127.0.0.1, the LAN (phone) and a cloudflared tunnel.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.*.*", "10.*.*.*", "*.trycloudflare.com"],
  // Keep build-time tsconfig loading in the TypeScript compiler API rather than
  // the CLI parser, which is not reliable in the current build environment.
  experimental: { useTypeScriptCli: false },
};

export default nextConfig;
