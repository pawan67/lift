/** `/api/sync/{push,pull,status}`, forwarded to the Lift API with the session token. */

import { NextResponse, type NextRequest } from "next/server";

import { readToken, upstream } from "@/lib/server/upstream";

export const dynamic = "force-dynamic";

const OPS = new Set(["push", "pull", "status"]);

async function forward(request: NextRequest, op: string, method: "GET" | "POST") {
  if (!OPS.has(op)) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const token = await readToken();
  if (!token) return NextResponse.json({ message: "Sign in to sync." }, { status: 401 });

  const body = method === "POST" ? await request.json().catch(() => null) : undefined;

  let response: Response;
  try {
    response = await upstream(`/api/sync/${op}`, { method, token, body: body ?? undefined });
  } catch {
    return NextResponse.json({ message: "The Lift server could not be reached." }, { status: 502 });
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ op: string }> }) {
  return forward(request, (await context.params).op, "POST");
}

export async function GET(request: NextRequest, context: { params: Promise<{ op: string }> }) {
  return forward(request, (await context.params).op, "GET");
}
