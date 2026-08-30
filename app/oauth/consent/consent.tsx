"use client";

import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { Fingerprint, Plug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { Button, Card, Field, Input } from "@/components/ui";
import { platformPasskeyAvailable, registerPasskey } from "@/lib/passkey";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export function OAuthConsent() {
  const supabase = createBrowserSupabase();
  const searchParams = useSearchParams();
  const authorizationId = searchParams.get("authorization_id");
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [platformPasskey, setPlatformPasskey] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!authorizationId) {
      setError("Missing OAuth authorization request");
      return;
    }
    const user = await supabase.auth.getUser();
    setSignedIn(Boolean(user.data.user));
    if (!user.data.user) return;
    const [authorization, account] = await Promise.all([
      supabase.auth.oauth.getAuthorizationDetails(authorizationId),
      fetch("/api/account", { cache: "no-store" }),
    ]);
    if (authorization.error || !authorization.data) {
      setError(authorization.error?.message ?? "Authorization request not found");
      return;
    }
    if ("redirect_url" in authorization.data) {
      window.location.assign(authorization.data.redirect_url);
      return;
    }
    if (account.ok) {
      const data = (await account.json()) as { passkeys?: Array<{ id: string }> };
      setHasPasskey(Boolean(data.passkeys?.length));
    }
    setDetails(authorization.data);
  }, [authorizationId, supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    let active = true;
    void platformPasskeyAvailable().then((available) => {
      if (active) setPlatformPasskey(available);
    });
    return () => {
      active = false;
    };
  }, []);

  async function authenticate() {
    setBusy(true);
    setError(null);
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (!result.data.session) {
      setError("Check your email to confirm the account, then sign in.");
      setMode("signin");
      return;
    }
    await load();
  }

  async function createPasskey() {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      setHasPasskey(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the passkey");
    } finally {
      setBusy(false);
    }
  }

  async function decide(approve: boolean) {
    if (!details) return;
    setBusy(true);
    setError(null);
    const result = approve
      ? await supabase.auth.oauth.approveAuthorization(details.authorization_id, {
          skipBrowserRedirect: true,
        })
      : await supabase.auth.oauth.denyAuthorization(details.authorization_id, {
          skipBrowserRedirect: true,
        });
    setBusy(false);
    if (result.error || !result.data) {
      setError(result.error?.message ?? "Could not save your decision");
      return;
    }
    window.location.assign(result.data.redirect_url);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-8">
      <Card className="w-full max-w-[440px]">
        <div className="border-b border-line px-5 py-5 sm:px-6">
          <Logo />
          <div className="mt-5 flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
            <Plug className="size-5" />
          </div>
          <h1 className="mt-3 text-[21px] font-semibold">
            {!signedIn
              ? mode === "signin"
                ? "Sign in to connect your agent"
                : "Create your AgentPay account"
              : `Connect ${details?.client.name ?? "this agent"}?`}
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {!signedIn
              ? "Your agent returns here after one standard OAuth connection."
              : "The agent can propose mandates, purchase only inside approved terms, and revoke when you say stop."}
          </p>
        </div>

        {!signedIn ? (
          <div className="space-y-4 px-6 py-5">
            <Field label="Email">
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            {error && <p className="rounded bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">{error}</p>}
            <Button
              className="w-full"
              size="lg"
              variant="primary"
              loading={busy}
              disabled={!email || password.length < 8}
              onClick={authenticate}
            >
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <button
              className="w-full text-[12.5px] text-muted hover:text-ink"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Need an account? Create one" : "Already registered? Sign in"}
            </button>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-md border border-line px-3 py-3 text-[13px]">
              <div className="flex justify-between gap-4">
                <span className="text-muted">Account</span>
                <strong>{details?.user.email}</strong>
              </div>
              <div className="mt-2 flex justify-between gap-4">
                <span className="text-muted">Permission</span>
                <strong>AgentPay account</strong>
              </div>
            </div>
            {!hasPasskey && (
              <div className="rounded-md bg-brand-soft px-3 py-3 text-[13px] text-brand-ink">
                <div className="font-medium">One final account step</div>
                <p className="mt-0.5 opacity-80">
                  Create the passkey that will authorize mandates and one-time exceptions.
                </p>
                {platformPasskey === false && (
                  <p className="mt-2 rounded bg-white/60 px-2 py-2 text-[12px]" role="alert">
                    Open this page directly in Safari or Chrome so AgentPay can use Face ID or Touch ID on this device.
                  </p>
                )}
                <Button
                  className="mt-3 w-full"
                  icon={<Fingerprint className="size-4" />}
                  loading={busy}
                  disabled={platformPasskey !== true}
                  onClick={createPasskey}
                >
                  Create authorization passkey
                </Button>
              </div>
            )}
            <p className="text-[12.5px] text-muted">
              The agent never receives card credentials and cannot sign its own mandate.
            </p>
            {error && <p className="rounded bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">{error}</p>}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={() => decide(false)}>
                Cancel
              </Button>
              <Button
                className="flex-[2]"
                variant="primary"
                disabled={busy || !details || !hasPasskey}
                onClick={() => decide(true)}
              >
                Connect agent
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
