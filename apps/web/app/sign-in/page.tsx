"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { LiftMark } from "@/components/shell/lift-mark";
import { Button, Field, Input, Segmented } from "@/components/ui/primitives";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("expired") ? "Your session expired. Sign in again." : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(body.message ?? "Something went wrong.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LiftMark className="h-12 w-12" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            {mode === "sign-in" ? "Sign in to Lift" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-fg-3">
            Use the same account as the app on your phone. Your workouts, routines and measurements sync both ways.
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6">
          <Segmented
            className="mb-6 w-full [&>button]:flex-1"
            value={mode}
            onChange={(value) => {
              setMode(value);
              setError(null);
            }}
            options={[
              { value: "sign-in", label: "Sign in" },
              { value: "sign-up", label: "Create account" },
            ]}
          />
          <form onSubmit={submit} className="space-y-4">
            {mode === "sign-up" ? (
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" />
              </Field>
            ) : null}
            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Password" hint={mode === "sign-up" ? "At least 8 characters." : undefined}>
              <Input
                type="password"
                required
                minLength={mode === "sign-up" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              />
            </Field>
            {error ? <p className="rounded-lg bg-alarm/10 px-3 py-2 text-sm text-alarm">{error}</p> : null}
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
