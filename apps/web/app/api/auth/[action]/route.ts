/**
 * Sign-in, sign-up, sign-out and session, proxied to the Lift API.
 *
 * The API answers sign-in with the session token in a `set-auth-token` header
 * (better-auth's bearer plugin, the same thing the phone reads). It is moved
 * into an httpOnly cookie here and never handed to the page.
 */

import { NextResponse, type NextRequest } from "next/server";

import { clearToken, readToken, storeToken, upstream } from "@/lib/server/upstream";

export const dynamic = "force-dynamic";

interface Credentials {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

function clientIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}

function publicUser(user: Record<string, unknown> | undefined) {
  if (!user) return null;
  return { id: String(user.id), email: String(user.email ?? ""), name: String(user.name ?? "") };
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;

  if (action === "sign-out") {
    const token = await readToken();
    if (token) await upstream("/api/auth/sign-out", { token, body: {} }).catch(() => undefined);
    await clearToken();
    return NextResponse.json({ ok: true });
  }

  if (action !== "sign-in" && action !== "sign-up") {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Credentials;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!email || !password) {
    return NextResponse.json({ message: "Enter your email and password." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await upstream(action === "sign-in" ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email", {
      body: action === "sign-in" ? { email, password } : { email, password, name: name || email.split("@")[0] },
      forwardedFor: clientIp(request),
    });
  } catch {
    return NextResponse.json({ message: "The Lift server could not be reached." }, { status: 502 });
  }

  if (!response.ok) {
    const fallback = action === "sign-in" ? "Wrong email or password." : "Could not create the account.";
    return NextResponse.json({ message: await errorMessage(response, fallback) }, { status: response.status });
  }

  const token = response.headers.get("set-auth-token");
  if (!token) {
    return NextResponse.json({ message: "The server signed you in but sent no session." }, { status: 502 });
  }

  const payload = (await response.json().catch(() => ({}))) as { user?: Record<string, unknown> };
  await storeToken(token);
  return NextResponse.json({ user: publicUser(payload.user) });
}

export async function GET(_request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action !== "session") return NextResponse.json({ message: "Not found" }, { status: 404 });

  const token = await readToken();
  if (!token) return NextResponse.json({ user: null }, { status: 401 });

  let response: Response;
  try {
    response = await upstream("/api/auth/get-session", { method: "GET", token });
  } catch {
    return NextResponse.json({ message: "The Lift server could not be reached." }, { status: 502 });
  }

  const payload = response.ok ? ((await response.json().catch(() => null)) as { user?: Record<string, unknown> } | null) : null;
  const user = publicUser(payload?.user);

  if (!user) {
    await clearToken();
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user });
}
