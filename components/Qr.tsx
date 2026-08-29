"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/cn";

export function Qr({ value, size = 160, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!value) return;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: "#1a1f36", light: "#ffffff" } }).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return (
    <div className={cn("flex items-center justify-center rounded-lg bg-white p-2 shadow-[var(--shadow-card)]", className)} style={{ width: size + 16, height: size + 16 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} width={size} height={size} alt={`QR for ${value}`} /> : <div className="animate-pulse rounded bg-line-2" style={{ width: size, height: size }} />}
    </div>
  );
}
