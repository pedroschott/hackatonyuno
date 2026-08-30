"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Check, ShieldCheck, AlertCircle } from "lucide-react";
import { Button, Modal } from "./ui";
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
  subtitle?: string;
  facts: { label: string; value: React.ReactNode }[];
  cta?: string;
  successTitle?: string;
  successBody?: string;
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
  subtitle = "Only you can approve this. Your card details are never shared.",
  facts,
  cta = "Confirm",
  successTitle = "Done",
  successBody = "This is active right away.",
}: Props) {
  const [phase, setPhase] = useState<Phase>("review");
  const [real, setReal] = useState<boolean | null>(null);
  const [bio] = useState(() => biometricName());
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
      const r = await passkeyAuthorize(challenge, { endpoint });
      setPhase("signed");
      await new Promise((res) => setTimeout(res, 500));
      setPhase("cosign");
      await new Promise((res) => setTimeout(res, 500));
      setPhase("done");
      await onComplete(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through. Please try again.");
      setPhase("error");
    }
  }

  const busy = phase === "prompt" || phase === "signed" || phase === "cosign";
  const platformUnavailable = real === false;

  return (
    <Modal open={open} onClose={onClose} dismissible={!busy} width="max-w-[420px]">
      <div className="px-5 pt-6 pb-5 sm:px-6">
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
            {(phase === "review" || phase === "prompt") && <Fingerprint className="size-8" strokeWidth={1.6} />}
            {phase === "signed" && <Check className="size-8" strokeWidth={2.2} />}
            {(phase === "cosign" || phase === "done") && <ShieldCheck className="size-8" strokeWidth={1.8} />}
            {phase === "error" && <AlertCircle className="size-8" strokeWidth={1.8} />}
          </div>
          <h3 className="mt-4 text-[17px] font-semibold text-ink">
            {phase === "review" && title}
            {phase === "prompt" && `Confirm with ${bio}`}
            {(phase === "signed" || phase === "cosign") && "Confirming…"}
            {phase === "done" && successTitle}
            {phase === "error" && "That didn’t work"}
          </h3>
          <p className="mt-1 text-[13px] text-muted">
            {phase === "review" && subtitle}
            {phase === "prompt" && `Use ${bio} on this device.`}
            {(phase === "signed" || phase === "cosign") && "One moment."}
            {phase === "done" && successBody}
            {phase === "error" && error}
          </p>
        </div>

        {phase === "review" && (
          <>
            {platformUnavailable && (
              <p className="mt-5 rounded-md bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink" role="alert">
                This browser cannot use the passkey on this device. Open AgentPay directly in Safari or Chrome, then confirm
                with Face ID or Touch ID.
              </p>
            )}
            <dl className="mt-5 divide-y divide-line rounded-md border border-line">
              {facts.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-4 px-3 py-2 text-[13px]">
                  <dt className="text-muted">{f.label}</dt>
                  <dd className="text-right font-medium text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {phase === "review" && (
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" icon={<Fingerprint className="size-4" />} onClick={run} disabled={real !== true}>
                {cta}
              </Button>
            </>
          )}
          {phase === "error" && (
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={run} disabled={platformUnavailable}>
                Try again
              </Button>
            </>
          )}
          {busy && <div className="h-8 w-full" />}
          {phase === "done" && (
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
