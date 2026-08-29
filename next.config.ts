import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server may be reached from 127.0.0.1, the LAN (phone) and a cloudflared tunnel.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.*.*", "10.*.*.*", "*.trycloudflare.com"],
};

export default nextConfig;
