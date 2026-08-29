"use client";

import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Logo } from "@/components/Logo";
import { Button, Card, Field, Input } from "@/components/ui";
import { registerPasskey } from "@/lib/passkey";
import { useStore } from "@/lib/store";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Account = {
  user: { id: string; email?: string };
  passkeys: Array<{ id: string }>;
};

export function AuthGate({ children }: { children: React.ReactNode }) {
  const supabase = createBrowserSupabase();
  const refresh = useStore((state) => state.refresh);
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadAccount = useCallback(async (nextUser: User | null) => {
    setUser(nextUser);
    if (!nextUser) {
      setAccount(null);
      setLoading(false);
      return;
    }
    const response = await fetch("/api/account", { cache: "no-store" });
    if (response.ok) setAccount((await response.json()) as Account);
    setLoading(false);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then((result: { data: { user: User | null } }) => {
      if (active) void loadAccount(result.data.user);
    });
    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (active) void loadAccount(session?.user ?? null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [loadAccount, supabase]);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (!result.data.session) {
      setMessage("Check your email to confirm the account, then sign in.");
      setMode("signin");
      return;
    }
    await loadAccount(result.data.user);
  }

  async function createPasskey() {
    setBusy(true);
    setMessage(null);
    try {
      await registerPasskey();
      await loadAccount(user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the passkey");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-canvas" />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <Card className="w-full max-w-[420px]">
          <div className="border-b border-line px-6 py-5">
            <Logo />
            <h1 className="mt-5 text-[21px] font-semibold">
              {mode === "signin" ? "Sign in to AgentPay" : "Create your AgentPay account"}
            </h1>
            <p className="mt-1 text-[13.5px] text-muted">
              One account, your saved payment methods, and one passkey for purchase approvals.
            </p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <Field label="Email">
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <Input
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            {message && <p className="rounded-md bg-warn-soft px-3 py-2 text-[12.5px] text-warn-ink">{message}</p>}
            <Button
              className="w-full"
              size="lg"
              variant="primary"
              loading={busy}
              disabled={!email || password.length < 8}
              onClick={submit}
            >
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <button
              className="w-full text-center text-[12.5px] text-muted hover:text-ink"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setMessage(null);
              }}
            >
              {mode === "signin" ? "New to AgentPay? Create an account" : "Already have an account? Sign in"}
            </button>
          </div>
        </Card>
      </div>
    );
  }

  if (!account) {
    return <div className="min-h-screen bg-canvas" />;
  }

  if (account.passkeys.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <Card className="w-full max-w-[440px]">
          <div className="px-6 py-6 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Fingerprint className="size-7" />
            </div>
            <h1 className="mt-4 text-[20px] font-semibold">Create your authorization passkey</h1>
            <p className="mt-1 text-[13.5px] text-muted">
              This is the only approval credential AgentPay needs. Your device verifies every mandate and exception.
            </p>
            {message && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger-ink">{message}</p>}
            <Button
              className="mt-5 w-full"
              size="lg"
              variant="primary"
              icon={<Fingerprint className="size-4" />}
              loading={busy}
              onClick={createPasskey}
            >
              Create passkey
            </Button>
            <p className="mt-3 text-[12px] text-muted">
              <ShieldCheck className="mr-1 inline size-3.5 align-[-2px]" />
              The registry stores only the public credential.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return children;
}
