/**
 * `/api/nutrition/*`, forwarded to the Lift API with the session token.
 *
 * The food tracker is not synced like training data: the page reads and writes
 * the diary on the server directly, through here. Every method and the query
 * string pass through untouched; the API validates the rest.
 */

import { NextResponse, type NextRequest } from "next/server";

import { readToken, upstream } from "@/lib/server/upstream";

export const dynamic = "force-dynamic";

/** Path segments the API can answer. Anything else stops here rather than reaching it. */
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.length === 0 || path.length > 4 || !path.every((segment) => SEGMENT.test(segment))) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const token = await readToken();
  if (!token) return NextResponse.json({ message: "Sign in to use the food diary." }, { status: 401 });

  const method = request.method;
  const body = method === "GET" || method === "DELETE" ? undefined : await request.json().catch(() => undefined);

  let response: Response;
  try {
    response = await upstream(`/api/nutrition/${path.join("/")}${request.nextUrl.search}`, { method, token, body });
  } catch {
    return NextResponse.json({ message: "The Lift server could not be reached." }, { status: 502 });
  }

  return new NextResponse(response.status === 204 ? null : response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
