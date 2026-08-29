"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Check, ShieldCheck, AlertCircle } from "lucide-react";
import { Button, Modal, Mono } from "./ui";
import { biometricName, passkeyAuthorize, platformPasskeyAvailable, type PasskeyResult } from "@/lib/passkey";
import { cn } from "@/lib/cn";

type Phase = "review" | "prompt" | "signed" | "cosign" | "done" | "error";

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: PasskeyResult) => void | Promise<void>;
  challenge: string;
  endpoint: string;
  title: React.ReactNode;
  facts: { label: string; value: React.ReactNode }[];
  cta?: string;
  successTitle?: string;
  cosignLabel?: string;
  user?: { id: string; name: string; displayName: string };
};

export function PasskeyCeremony(props: Props) {
  // Mount the body only while open: all ceremony state resets naturally on close.
  if (!props.open) return null;
  return <CeremonyBody {...props} />;
}

function CeremonyBody({
  open,
  onClose,
  onComplete,
  challenge,
  endpoint,
  title,
  facts,
  cta = "Authorize with passkey",
  successTitle = "Authorized",
  cosignLabel = "Registry co-signing…",
  user = { id: "u_cfo", name: "cfo@atlas.example", displayName: "CFO — Locadora Atlas" },
}: Props) {
  const [phase, setPhase] = useState<Phase>("review");
  const [real, setReal] = useState<boolean | null>(null);
  const [bio] = useState(() => biometricName());
  const [result, setResult] = useState<PasskeyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    platformPasskeyAvailable().then((v) => alive && setReal(v));
    return () => {
      alive = false;
    };
  }, []);

  async function run() {
    setPhase("prompt");
    setError(null);
    try {
      const r = await passkeyAuthorize(challenge, { user, endpoint });
      setResult(r);
      setPhase("signed");
      await new Promise((res) => setTimeout(res, 700));
      setPhase("cosign");
      await new Promise((res) => setTimeout(res, 650));
      setPhase("done");
      await onComplete(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey ceremony failed");
      setPhase("error");
    }
  }

  const busy = phase === "prompt" || phase === "signed" || phase === "cosign";

  return (
    <Modal open={open} onClose={onClose} dismissible={!busy} width="max-w-[440px]">
      <div className="px-6 pt-6 pb-5">
        {/* Icon stage */}
        <div className="flex flex-col items-center text-center">
          <div
            className={cn(
              "flex size-16 items-center justify-center rounded-full transition-colors duration-300",
              phase === "prompt" && "ap-ring bg-brand-soft text-brand",
              (phase === "signed" || phase === "cosign" || phase === "done") && "bg-success-soft text-success",
              phase === "review" && "bg-canvas text-ink-2",
              phase === "error" && "ap-shake bg-danger-soft text-danger",
            )}
          >
            {phase === "review" && <Fingerprint className="size-8" strokeWidth={1.6} />}
            {phase === "prompt" && <Fingerprint className="size-8" strokeWidth={1.6} />}
            {phase === "signed" && <Check className="size-8" strokeWidth={2.2} />}
            {(phase === "cosign" || phase === "done") && <ShieldCheck className="size-8" strokeWidth={1.8} />}
            {phase === "error" && <AlertCircle className="size-8" strokeWidth={1.8} />}
          </div>
          <h3 className="mt-4 text-[17px] font-semibold text-ink">
            {phase === "review" && title}
            {phase === "prompt" && `Confirm with ${bio}`}
            {phase === "signed" && "Signed"}
            {phase === "cosign" && cosignLabel}
            {phase === "done" && successTitle}
            {phase === "error" && "Couldn’t complete"}
          </h3>
          <p className="mt-1 text-[13px] text-muted">
            {phase === "review" && "Your device signs the mandate hash. The card never leaves the vault."}
            {phase === "prompt" && `Use ${bio} to sign this on this device.`}
            {phase === "signed" && "Assertion captured over the mandate hash."}
            {phase === "cosign" && "Registry verifies the assertion and co-signs."}
            {phase === "done" && "Status flipped to active in the registry."}
            {phase === "error" && error}
          </p>
        </div>

        {/* Facts */}
        {phase === "review" && (
          <dl className="mt-5 divide-y divide-line rounded-md border border-line">
            {facts.map((f) => (
              <div key={f.label} className="flex items-baseline justify-between gap-4 px-3 py-2 text-[13px]">
                <dt className="text-muted">{f.label}</dt>
                <dd className="text-right font-medium text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Challenge / assertion */}
        <div className="mt-4 rounded-md bg-canvas px-3 py-2.5 text-[12px]">
          <div className="flex items-center justify-between">
            <span className="text-muted">challenge = sha256(mandate)</span>
            <Mono>{challenge.slice(0, 16)}…</Mono>
          </div>
          {result && (
            <div className="mt-1.5 flex items-center justify-between ap-in">
              <span className="text-muted">assertion · {result.method}</span>
              <Mono className="text-success-ink">{result.assertion.slice(0, 16)}…</Mono>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 flex items-center justify-between gap-2">
          {phase === "review" && (
            <>
              <span className="text-[12px] text-muted">Verified by the AgentPay registry</span>
              <div className="flex gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="primary" icon={<Fingerprint className="size-4" />} onClick={run} disabled={real === null || real === false}>
                  {cta}
                </Button>
              </div>
            </>
          )}
          {phase === "error" && (
            <>
              <span className="text-[12px] text-muted">A registered passkey is required</span>
              <div className="flex gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={run}>Try again</Button>
              </div>
            </>
          )}
          {busy && <div className="h-8 w-full" />}
          {phase === "done" && (
            <div className="flex w-full justify-end">
              <Button variant="primary" onClick={onClose}>Done</Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
