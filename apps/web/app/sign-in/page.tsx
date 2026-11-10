"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { LiftMark } from "@/components/shell/lift-mark";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

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

  const signIn = mode === "sign-in";
  const switchMode = () => {
    setMode(signIn ? "sign-up" : "sign-in");
    setError(null);
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <main className="flex min-h-dvh flex-col px-6 py-6 sm:px-12 sm:py-10 lg:px-16">
        <div className="flex items-center gap-2.5">
          <LiftMark className="h-6" />
          <span className="text-[15px] font-semibold tracking-tight">Lift</span>
        </div>

        <div className="flex flex-1 flex-col justify-center py-12">
          <div className="w-full max-w-[360px]">
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">{signIn ? "Sign in" : "Create an account"}</h1>
            <p className="mt-2 text-sm text-fg-3">Same account as the app on your phone.</p>

            <form onSubmit={submit} className="mt-8 space-y-4">
              {signIn ? null : (
                <Field label="Name" className="transition-[opacity,transform] duration-200 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0">
                  <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Your name" />
                </Field>
              )}
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
              <Field label="Password" hint={signIn ? undefined : "At least 8 characters."}>
                <Input
                  type="password"
                  required
                  minLength={signIn ? undefined : 8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={signIn ? "current-password" : "new-password"}
                />
              </Field>
              {error ? (
                <p role="alert" className="rounded-lg border border-alarm/25 bg-alarm/10 px-3 py-2 text-[13px] text-alarm">
                  {error}
                </p>
              ) : null}
              <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
                {busy ? "One moment…" : signIn ? "Sign in" : "Create account"}
              </Button>
            </form>

            <p className="mt-6 text-[13px] text-fg-3">
              {signIn ? "No account yet? " : "Already have one? "}
              <button type="button" onClick={switchMode} className="font-medium text-fg-2 underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:text-fg hover:decoration-fg-3">
                {signIn ? "Create one" : "Sign in"}
              </button>
            </p>
          </div>
        </div>

        <p className="text-xs text-fg-3">Workouts, routines and measurements sync both ways.</p>
      </main>

      <LogPage />
    </div>
  );
}

/*
 * The right half is a page from a training log, set the way the app sets it:
 * a session, its sets in tabular figures, the record marked. It says what Lift
 * is without a slogan, and it is static, so it costs nothing on a page people
 * only pass through.
 */
const SAMPLE = [
  { label: "W", set: "45 kg × 8", note: "" },
  { label: "W", set: "65 kg × 5", note: "" },
  { label: "1", set: "87.5 kg × 5", note: "1RM 98.4 kg" },
  { label: "2", set: "87.5 kg × 5", note: "1RM 98.4 kg" },
  { label: "3", set: "92.5 kg × 4", note: "1RM 100.9 kg", record: true },
  { label: "4", set: "75 kg × 8", note: "1RM 93.1 kg" },
];

function LogPage() {
  return (
    <aside aria-hidden className="relative hidden overflow-hidden border-l border-line bg-surface lg:flex lg:flex-col lg:justify-end">
      {/* Faint ruled lines, like the page it imitates. */}
      <div className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_39px,var(--line)_39px,var(--line)_40px)] opacity-50" />
      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/70 to-transparent" />

      <div className="relative px-16 pb-16">
        <div className="flex items-baseline justify-between text-[13px] text-fg-3">
          <span>Push A</span>
          <span className="tabular">Mon 2 Nov</span>
        </div>
        <div className="mt-1 text-[44px] leading-none font-semibold tracking-[-0.03em] text-fg">Barbell Bench Press</div>

        <ol className="mt-8 border-t border-line-strong/60">
          {SAMPLE.map((row, index) => (
            <li key={index} className="flex items-baseline gap-5 border-b border-line py-3 text-[15px]">
              <span className={row.label === "W" ? "w-4 text-xs font-medium text-warn" : "tabular w-4 text-xs font-medium text-fg-3"}>{row.label}</span>
              <span className={row.record ? "tabular font-semibold text-volt" : "tabular text-fg"}>{row.set}</span>
              <span className="tabular flex-1 text-right text-[13px] text-fg-3">
                {row.record ? <span className="mr-3 text-volt">Est. 1RM record</span> : null}
                {row.note}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex gap-12">
          <div>
            <div className="text-[13px] text-fg-3">Volume</div>
            <div className="tabular mt-1 text-2xl font-semibold tracking-[-0.02em]">
              2,530 <span className="text-sm font-normal text-fg-3">kg</span>
            </div>
          </div>
          <div>
            <div className="text-[13px] text-fg-3">Best est. 1RM</div>
            <div className="tabular mt-1 text-2xl font-semibold tracking-[-0.02em]">
              100.9 <span className="text-sm font-normal text-fg-3">kg</span>
            </div>
          </div>
          <div>
            <div className="text-[13px] text-fg-3">Sessions</div>
            <div className="tabular mt-1 text-2xl font-semibold tracking-[-0.02em]">46</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
