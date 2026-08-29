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
    <div
      className={cn("flex aspect-square max-w-full items-center justify-center rounded-lg bg-white p-2 shadow-[var(--shadow-card)]", className)}
      style={{ width: size + 16, height: "auto" }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} width={size} height={size} alt={`QR for ${value}`} className="h-auto w-full" />
      ) : (
        <div className="aspect-square w-full animate-pulse rounded bg-line-2" />
      )}
    </div>
  );
}
