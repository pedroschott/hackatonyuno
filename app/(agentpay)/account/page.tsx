"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, MapPin, ShieldCheck, Trash2 } from "lucide-react";

import { PageHeader } from "@/components/AppShell";
import { CardBrand } from "@/components/CardBrand";
import { useStore } from "@/lib/store";
import { cardUsageFor } from "@/lib/cards";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
} from "@/components/ui";

type Profile = {
  legal_name: string;
  tax_id: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  region: string;
  postal_code: string;
  country_code: string;
};

type IdentityVerification = {
  session_id: string;
  status: "Not Started" | "In Progress" | "Approved" | "Declined" | "In Review" | "Expired" | "Abandoned" | "Kyc Expired" | "Resubmitted" | "Awaiting User";
  entity_status: "ACTIVE" | "FLAGGED" | "BLOCKED" | null;
  environment: "sandbox" | "live" | null;
  approved_at: string | null;
};

const emptyProfile: Profile = {
  legal_name: "",
  tax_id: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  region: "",
  postal_code: "",
  country_code: "BR",
};

function profileFrom(value?: Partial<Record<keyof Profile, unknown>> | null): Profile {
  return {
    legal_name: typeof value?.legal_name === "string" ? value.legal_name : "",
    tax_id: typeof value?.tax_id === "string" ? value.tax_id : "",
    phone: typeof value?.phone === "string" ? value.phone : "",
    address_line1: typeof value?.address_line1 === "string" ? value.address_line1 : "",
    address_line2: typeof value?.address_line2 === "string" ? value.address_line2 : "",
    city: typeof value?.city === "string" ? value.city : "",
    region: typeof value?.region === "string" ? value.region : "",
    postal_code: typeof value?.postal_code === "string" ? value.postal_code : "",
    country_code: typeof value?.country_code === "string" ? value.country_code : "BR",
  };
}

export default function AccountPage() {
  const cards = useStore((state) => state.cards);
  const mandates = useStore((state) => state.mandates);
  const attempts = useStore((state) => state.attempts);
  const refresh = useStore((state) => state.refresh);
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [identityVerification, setIdentityVerification] = useState<IdentityVerification | null>(null);
  const [verificationConsent, setVerificationConsent] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [brand, setBrand] = useState<"visa" | "mastercard">("visa");
  const [last4, setLast4] = useState("");
  const [label, setLabel] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardMessage, setCardMessage] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/account", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as {
          error?: string;
          user?: { email?: string };
          profile?: Partial<Profile> | null;
          identity_verification?: IdentityVerification | null;
        };
        if (!response.ok) throw new Error(result.error ?? "Could not load the account");
        if (!active) return;
        setEmail(result.user?.email ?? "");
        setProfile(profileFrom(result.profile));
        setIdentityVerification(result.identity_verification ?? null);
        const callbackState = new URLSearchParams(window.location.search).get("verification");
        if (callbackState === "complete") setVerificationMessage("Didit returned your latest verification decision.");
        if (callbackState === "error") setVerificationMessage("We could not reconcile the Didit result. Please try again.");
      })
      .catch((error) => active && setProfileMessage(error instanceof Error ? error.message : "Could not load the account"));
    return () => {
      active = false;
    };
  }, []);

  const complianceReady = Boolean(profile.legal_name && profile.tax_id && profile.phone);
  const fulfillmentReady = Boolean(
    profile.address_line1 && profile.city && profile.region && profile.postal_code && profile.country_code,
  );

  const cardUsage = useMemo(() => {
    return new Map(
      cards.map((card) => {
        return [card.id, cardUsageFor(card.id, mandates, attempts)];
      }),
    );
  }, [attempts, cards, mandates]);

  async function saveProfile() {
    setProfileBusy(true);
    setProfileMessage(null);
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const result = (await response.json()) as { error?: string; profile?: Profile };
      if (!response.ok) throw new Error(result.error ?? "Could not save account details");
      if (result.profile) setProfile(profileFrom(result.profile));
      setProfileMessage("Account details saved.");
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "Could not save account details");
    } finally {
      setProfileBusy(false);
    }
  }

  async function addCard() {
    setCardBusy(true);
    setCardMessage(null);
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand, last4, label, make_default: makeDefault }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save the payment method");
      await refresh();
      setLast4("");
      setLabel("");
      setMakeDefault(false);
      setCardMessage("Payment method saved.");
    } catch (error) {
      setCardMessage(error instanceof Error ? error.message : "Could not save the payment method");
    } finally {
      setCardBusy(false);
    }
  }

  async function startIdentityVerification() {
    setVerificationBusy(true);
    setVerificationMessage(null);
    try {
      const response = await fetch("/api/identity-verification/session", { method: "POST" });
      const result = (await response.json()) as { error?: string; url?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Could not start identity verification");
      window.location.assign(result.url);
    } catch (error) {
      setVerificationMessage(error instanceof Error ? error.message : "Could not start identity verification");
      setVerificationBusy(false);
    }
  }

  async function mutateCard(id: string, method: "PATCH" | "DELETE") {
    setRemoving(method === "DELETE" ? id : null);
    setCardBusy(true);
    setCardMessage(null);
    try {
      const response = await fetch(`/api/cards/${id}`, {
        method,
        headers: method === "PATCH" ? { "content-type": "application/json" } : undefined,
        body: method === "PATCH" ? JSON.stringify({ is_default: true }) : undefined,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not update the payment method");
      await refresh();
      setCardMessage(method === "PATCH" ? "Default payment method updated." : "Payment method removed.");
    } catch (error) {
      setCardMessage(error instanceof Error ? error.message : "Could not update the payment method");
    } finally {
      setCardBusy(false);
      setRemoving(null);
    }
  }

  const setField = (field: keyof Profile, value: string) =>
    setProfile((current) => ({ ...current, [field]: value }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account"
        description="Manage the details your agent needs for compliant orders and choose how each mandate pays."
      />

      <Card>
        <CardHeader
          title="Identity and fraud verification"
          description="Didit verifies your identity, document integrity, liveness, and the risk checks configured in AgentPay's workflow before you can authorize a mandate."
          actions={
            identityVerification?.status === "Approved" && identityVerification.entity_status !== "FLAGGED" && identityVerification.entity_status !== "BLOCKED" ? (
              <Badge tone="success"><ShieldCheck className="size-3" /> Verified</Badge>
            ) : identityVerification?.status === "Declined" || identityVerification?.entity_status === "BLOCKED" ? (
              <Badge tone="danger">Not verified</Badge>
            ) : identityVerification?.entity_status === "FLAGGED" ? (
              <Badge tone="warn">Needs review</Badge>
            ) : identityVerification?.status === "In Review" ? (
              <Badge tone="warn">In review</Badge>
            ) : (
              <Badge tone="neutral">Required</Badge>
            )
          }
        />
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-5 text-ink-2">
            AgentPay stores only the session status. Identity documents, selfies, biometric captures, and the full verification decision remain with Didit.
          </p>
          {identityVerification && (
            <div className="rounded-md border border-line bg-canvas px-3 py-2 text-[12.5px] text-muted">
              Latest result: <span className="font-medium text-ink-2">{identityVerification.status}</span>
              {identityVerification.environment ? ` · ${identityVerification.environment}` : ""}
              {identityVerification.entity_status && identityVerification.entity_status !== "ACTIVE" ? ` · ${identityVerification.entity_status.toLowerCase()}` : ""}
            </div>
          )}
          {identityVerification?.status !== "Approved" && identityVerification?.status !== "In Review" && (
            <label className="flex items-start gap-2 text-[12.5px] leading-5 text-ink-2">
              <input
                type="checkbox"
                checked={verificationConsent}
                onChange={(event) => setVerificationConsent(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
              />
              <span>
                I agree to continue to Didit, where identity documents, selfie or liveness captures, biometrics, device data, and fraud signals may be processed for verification. I have read Didit&apos;s{" "}
                <a className="underline" href="https://didit.me/terms/verification-privacy-notice/" target="_blank" rel="noreferrer">Verification Privacy Notice</a>{" "}
                and <a className="underline" href="https://didit.me/terms/identity-verification/" target="_blank" rel="noreferrer">End User Terms</a>.
              </span>
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          {identityVerification?.status !== "Approved" && identityVerification?.status !== "In Review" && (
            <Button
              variant="primary"
              size="lg"
              loading={verificationBusy}
              disabled={!verificationConsent}
              onClick={startIdentityVerification}
            >
              {identityVerification && ["Not Started", "In Progress", "Resubmitted", "Awaiting User"].includes(identityVerification.status)
                ? "Resume with Didit"
                : "Verify with Didit"}
            </Button>
          )}
          {verificationMessage && <p className="text-[12.5px] text-muted">{verificationMessage}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Order and compliance details"
          description="Kept inside your protected AgentPay account. Agents receive it only through your authenticated connection."
          actions={
            complianceReady ? (
              <Badge tone="success"><Check className="size-3" /> Ready</Badge>
            ) : (
              <Badge tone="warn">Needs details</Badge>
            )
          }
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Account email"><Input value={email} disabled /></Field>
          <Field label="Full legal name"><Input value={profile.legal_name} onChange={(event) => setField("legal_name", event.target.value)} autoComplete="name" /></Field>
          <Field label="Tax ID" hint="For merchant invoicing and jurisdictional compliance."><Input value={profile.tax_id} onChange={(event) => setField("tax_id", event.target.value)} autoComplete="off" /></Field>
          <Field label="Phone"><Input value={profile.phone} onChange={(event) => setField("phone", event.target.value)} autoComplete="tel" /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Delivery address"
          description="Used as your default fulfillment address when an order needs shipping."
          actions={
            fulfillmentReady ? (
              <Badge tone="success"><MapPin className="size-3" /> Ready</Badge>
            ) : (
              <Badge tone="warn">Incomplete</Badge>
            )
          }
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Address line 1" className="sm:col-span-2"><Input value={profile.address_line1} onChange={(event) => setField("address_line1", event.target.value)} autoComplete="address-line1" /></Field>
          <Field label="Address line 2" className="sm:col-span-2"><Input value={profile.address_line2} onChange={(event) => setField("address_line2", event.target.value)} autoComplete="address-line2" /></Field>
          <Field label="City"><Input value={profile.city} onChange={(event) => setField("city", event.target.value)} autoComplete="address-level2" /></Field>
          <Field label="State / region"><Input value={profile.region} onChange={(event) => setField("region", event.target.value)} autoComplete="address-level1" /></Field>
          <Field label="Postal code"><Input value={profile.postal_code} onChange={(event) => setField("postal_code", event.target.value)} autoComplete="postal-code" /></Field>
          <Field label="Country code" hint="Two-letter ISO code, for example BR."><Input value={profile.country_code} maxLength={2} onChange={(event) => setField("country_code", event.target.value.toUpperCase())} autoComplete="country" /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          <Button variant="primary" size="lg" loading={profileBusy} onClick={saveProfile}>Save account details</Button>
          {profileMessage && <p className="text-[12.5px] text-muted">{profileMessage}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Saved payment methods"
          description="The default is used when an agent does not choose a card. You can switch cards before signing every mandate."
          actions={<Badge tone="neutral">{cards.length} saved</Badge>}
        />
        {cards.length === 0 ? (
          <EmptyState title="No payment methods yet" description="Add display-safe mock card metadata below. Never enter a full card number or security code." />
        ) : (
          <ul className="divide-y divide-line-2">
            {cards.map((card) => {
              const usage = cardUsage.get(card.id);
              return (
                <li key={card.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-canvas"><CardBrand brand={card.brand} /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                        <span>{card.label || (card.brand === "visa" ? "Visa" : "Mastercard")} ···· {card.last4}</span>
                        {card.isDefault && <Badge tone="brand">Default</Badge>}
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-muted">
                        {usage?.successfulPurchases ?? 0} successful {(usage?.successfulPurchases ?? 0) === 1 ? "purchase" : "purchases"}
                        {usage?.lastUsedAt ? ` · Last used ${new Date(usage.lastUsedAt).toLocaleDateString()}` : " · Never used"}
                        {(usage?.liveMandates ?? 0) > 0 ? ` · ${usage?.liveMandates} live or pending` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 sm:ml-auto">
                    {!card.isDefault && <Button size="sm" disabled={cardBusy} onClick={() => mutateCard(card.id, "PATCH")}>Make default</Button>}
                    <Button size="sm" variant="danger" loading={removing === card.id} disabled={(usage?.liveMandates ?? 0) > 0 || cardBusy} icon={<Trash2 className="size-3.5" />} onClick={() => mutateCard(card.id, "DELETE")}>Remove</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Add payment method" description="This hackathon build stores only brand, last four digits, a label, and an encrypted mock-vault reference." actions={<CreditCard className="size-4 text-muted" />} />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Brand"><Select value={brand} onChange={(event) => setBrand(event.target.value as "visa" | "mastercard")}><option value="visa">Visa</option><option value="mastercard">Mastercard</option></Select></Field>
          <Field label="Last four digits" hint="Display data only."><Input value={last4} inputMode="numeric" maxLength={4} placeholder="4242" onChange={(event) => setLast4(event.target.value.replace(/\D/g, "").slice(0, 4))} /></Field>
          <Field label="Label"><Input value={label} maxLength={80} placeholder="Personal" onChange={(event) => setLabel(event.target.value)} /></Field>
          <label className="flex items-center gap-2 text-[13px] text-ink-2 sm:col-span-3"><input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} className="size-4 accent-[var(--color-brand)]" /> Make this my default payment method</label>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          <Button variant="primary" size="lg" loading={cardBusy} disabled={!/^\d{4}$/.test(last4)} icon={<ShieldCheck className="size-4" />} onClick={addCard}>Save payment method</Button>
          {cardMessage && <p className="text-[12.5px] text-muted">{cardMessage}</p>}
        </div>
      </Card>
    </div>
  );
}
