"use client";

import { DiditSdk } from "@didit-protocol/sdk-web";
import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge, Button, Card, CardHeader } from "@/components/ui";

type VerificationStatus =
  | "Not Started"
  | "In Progress"
  | "Awaiting User"
  | "In Review"
  | "Approved"
  | "Declined"
  | "Resubmitted"
  | "Abandoned"
  | "Expired"
  | "Kyc Expired";

type Verification = {
  status: VerificationStatus;
  approved_at: string | null;
  updated_at: string;
};

type VerificationResponse = {
  verification: Verification | null;
  error?: string;
};

const pendingStatuses = new Set<VerificationStatus>([
  "Not Started",
  "In Progress",
  "Awaiting User",
  "In Review",
  "Resubmitted",
]);

function verificationLabel(status?: VerificationStatus): string {
  if (!status) return "Not verified";
  if (status === "Approved") return "Verified";
  if (pendingStatuses.has(status)) return "Pending";
  if (status === "Kyc Expired") return "Reverification required";
  return status;
}

function verificationTone(status?: VerificationStatus): "success" | "warn" | "danger" | "neutral" {
  if (status === "Approved") return "success";
  if (!status || pendingStatuses.has(status)) return "warn";
  if (status === "Declined") return "danger";
  return "neutral";
}

export function IdentityVerification() {
  const [verification, setVerification] = useState<Verification | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshVerification() {
    const response = await fetch("/api/identity-verification", { cache: "no-store" });
    const result = (await response.json()) as VerificationResponse;
    if (!response.ok) throw new Error(result.error ?? "Could not load identity verification status");
    setVerification(result.verification);
  }

  useEffect(() => {
    // Run after the first paint so the account page renders before this optional
    // status request resolves.
    const timer = window.setTimeout(() => {
      void refreshVerification().catch((error) => {
        setMessage(error instanceof Error ? error.message : "Could not load identity verification status");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function startVerification() {
    if (!consent) {
      setMessage("Read and accept the identity verification disclosure before continuing.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/identity-verification", { method: "POST" });
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.url) {
        throw new Error(result.error ?? "Could not start identity verification");
      }

      DiditSdk.shared.onComplete = (completion) => {
        if (completion.type === "completed") {
          setMessage("Verification submitted. Your status updates only after Didit confirms the decision.");
          void refreshVerification().catch(() => undefined);
          return;
        }
        if (completion.type === "cancelled") {
          setMessage("Verification was closed. You can continue when you are ready.");
          return;
        }
        setMessage(completion.error?.message ?? "The verification flow could not be completed.");
      };
      await DiditSdk.shared.startVerification({ url: result.url });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start identity verification");
    } finally {
      setBusy(false);
    }
  }

  const isVerified = verification?.status === "Approved";
  const actionLabel = isVerified ? "Verify again" : "Verify identity";

  return (
    <Card>
      <CardHeader
        title="Identity verification"
        description="Verify the holder of this AgentPay account before using it for higher-trust purchases."
        actions={
          <Badge tone={verificationTone(verification?.status)}>
            {isVerified && <Check className="size-3" />}
            {verificationLabel(verification?.status)}
          </Badge>
        }
      />
      <div className="space-y-4 p-5">
        {isVerified ? (
          <p className="text-[13px] text-muted">
            Approved {verification?.approved_at ? new Date(verification.approved_at).toLocaleDateString() : ""}. AgentPay stores only this decision and its timestamps.
          </p>
        ) : (
          <p className="text-[13px] text-muted">
            AgentPay opens Didit&apos;s hosted identity flow. Your government ID, selfie, biometric data, and detailed decision stay with Didit; AgentPay stores only the resulting status and timestamps.
          </p>
        )}
        <label className="flex items-start gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span>I understand that Didit will process my identity verification and that AgentPay uses the verified result to protect my account.</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
        <Button
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!consent || verification?.status === "In Review"}
          icon={<ShieldCheck className="size-4" />}
          onClick={startVerification}
        >
          {actionLabel}
        </Button>
        {verification?.status === "In Review" && <p className="text-[12.5px] text-muted">Didit is reviewing this verification.</p>}
        {message && <p className="text-[12.5px] text-muted" role="status">{message}</p>}
      </div>
    </Card>
  );
}
