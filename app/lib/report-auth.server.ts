import { createCookieSessionStorage, redirect } from "react-router";
import crypto from "crypto";
import prisma from "../db.server";

const shopifyAppUrl = process.env.SHOPIFY_APP_URL ?? "http://localhost";

// Create session storage with a getter function for secure flag
// This checks each request's actual protocol instead of relying on env vars
function createSessionStorageConfig() {
  return createCookieSessionStorage({
    cookie: {
      name: "__report_session",
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secrets: [process.env.SESSION_SECRET ?? "report-secret-fallback-32chars!!"],
      // Dynamic: only secure if request is over HTTPS. 
      // Will be overridden per-request in getReportSession if needed.
      secure: shopifyAppUrl.startsWith("https://"),
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  });
}

const sessionStorage = createSessionStorageConfig();

const SESSION_TOKEN_KEY = "reportToken";

// ─── App Proxy signature verification ──────────────────────────────────────
// Shopify appends signature/shop/timestamp params to EVERY request it forwards
// through the app proxy, regardless of method. A request that hits this app's
// raw Vercel/tunnel URL directly (bypassing the proxy) will never have a valid
// signature, so we can use this to hard-block direct access.

export function verifyAppProxySignature(request: Request): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;

  const url = new URL(request.url);
  const params = url.searchParams;
  const signature = params.get("signature");
  if (!signature) return false;

  const grouped = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    if (key === "signature") continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(value);
  }

  const message = Array.from(grouped.keys())
    .sort()
    .map((key) => `${key}=${grouped.get(key)!.join(",")}`)
    .join("");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");

  const digestBuffer = Buffer.from(digest, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  if (digestBuffer.length !== signatureBuffer.length) return false;

  return crypto.timingSafeEqual(digestBuffer, signatureBuffer);
}

export function requireAppProxyRequest(request: Request) {
  if (!verifyAppProxySignature(request)) {
    throw new Response("Not Found", { status: 404 });
  }
}

// ─── Base path helpers ──────────────────────────────────────────────────────
// Single source of truth for the mount path — works whether hit directly
// (local tunnel: /apps/containerdoor/login) or via the Shopify app proxy
// (production: /apps/containerdoor/login).
export function getReportBasePath(pathname: string) {
  const cleanPath = pathname.replace(/\/+$/, "");
  const trimmedPath = cleanPath.replace(/\/api\/report-auth$/, "");

  if (trimmedPath.endsWith("/login")) {
    return trimmedPath.replace(/\/login$/, "");
  }
  if (trimmedPath.endsWith("/dashboard")) {
    return trimmedPath.replace(/\/dashboard$/, "");
  }
  return trimmedPath;
}

function getRequestBasePath(request: Request) {
  const referer = request.headers.get("Referer");
  const forwardedProto = request.headers.get("X-Forwarded-Proto") || "https";
  const forwardedHost = request.headers.get("X-Forwarded-Host");

  let shopOrigin = "";
  if (forwardedHost) {
    shopOrigin = `${forwardedProto}://${forwardedHost}`;
  } else if (referer) {
    try {
      shopOrigin = new URL(referer).origin;
    } catch {
      // Ignore invalid referer URL
    }
  }

  const pathname = new URL(request.url).pathname;
  const basePath = getReportBasePath(pathname);

  if (shopOrigin && basePath && basePath !== "/" && !basePath.startsWith("/api")) {
    return `${shopOrigin}${basePath}`;
  }
  if (basePath && basePath !== "/" && !basePath.startsWith("/api")) {
    return basePath;
  }
  return "";
}

// ─── Session helpers ────────────────────────────────────────────────────────

export async function getReportSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  console.log("[getReportSession] Cookie header present:", !!cookie, "Cookie value:", cookie);
  const session = await sessionStorage.getSession(cookie);
  console.log("[getReportSession] Session data:", session.data);
  return session;
}

export async function getReportUser(request: Request) {
  const session = await getReportSession(request);
  const token = session.get(SESSION_TOKEN_KEY);

  console.log("[getReportUser] Token from session:", token ? `found (${token.slice(0, 8)}...)` : "NULL");

  if (!token) {
    console.log("[getReportUser] No token in session, returning null");
    return null;
  }

  const extSession = await prisma.externalSession.findUnique({
    where: { token },
    include: { user: true },
  });

  console.log("[getReportUser] extSession lookup result:", extSession ? "FOUND" : "NULL");

  if (!extSession) {
    console.log("[getReportUser] extSession not found for token");
    return null;
  }

  if (extSession.expiresAt < new Date()) {
    console.log("[getReportUser] Session expired");
    await prisma.externalSession.delete({ where: { token } });
    return null;
  }

  console.log("[getReportUser] Returning user:", { id: extSession.user.id, name: extSession.user.name, email: extSession.user.email });
  return extSession.user;
}

export async function requireReportUser(request: Request) {
  const user = await getReportUser(request);
  if (!user) {
    const basePath = getReportBasePath(new URL(request.url).pathname);
    throw redirect(`${basePath}/login`);
  }
  return user;
}

export async function storeReportToken(request: Request, token: string) {
  const session = await getReportSession(request);
  session.set(SESSION_TOKEN_KEY, token);
  let cookieHeader = await sessionStorage.commitSession(session);

  console.log("[storeReportToken] Token stored:", token);
  console.log("[storeReportToken] cookieHeader before fix:", cookieHeader);

  // If this is an HTTP request (not HTTPS), remove the Secure flag
  // so the browser will actually send the cookie back on HTTP responses
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol === "http:") {
    console.log("[storeReportToken] Request is HTTP, removing Secure flag from cookie");
    cookieHeader = cookieHeader.replace(/;\s*Secure/i, "");
  }

  console.log("[storeReportToken] cookieHeader after fix:", cookieHeader);

  return {
    session,
    cookieHeader,
  };
}

export async function createReportSession(request: Request, token: string, shop?: string) {
  const basePath = shop
    ? `https://${shop}/apps/containerdoor`
    : getRequestBasePath(request);
  const redirectUrl = `${basePath}/dashboard?token=${token}`;
  const payload = { redirectTo: redirectUrl };

  let { cookieHeader } = await storeReportToken(request, token);

  // Ensure Secure flag is removed for HTTP requests (done in storeReportToken)
  // But double-check here too
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol === "http:") {
    cookieHeader = cookieHeader.replace(/;\s*Secure/i, "");
  }

  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Credentials": "true",
    "Set-Cookie": cookieHeader,
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers,
  });
}

export async function destroyReportSession(request: Request) {
  const user = await getReportUser(request);
  const session = await getReportSession(request);

  let redirectUrl = "/apps/containerdoor/login";
  
  // Try to get shop from user first, then fall back to URL parameter (from Shopify app proxy)
  const shop = user?.shop || new URL(request.url).searchParams.get("shop");
  if (shop) {
    redirectUrl = `https://${shop}/apps/containerdoor/login`;
  }

  let cookieHeader = await sessionStorage.destroySession(session);

  // Ensure Secure flag is removed for HTTP requests
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol === "http:") {
    cookieHeader = cookieHeader.replace(/;\s*Secure/i, "");
  }

  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Credentials": "true",
    "Set-Cookie": cookieHeader,
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  return new Response(JSON.stringify({ redirectTo: redirectUrl }), {
    status: 200,
    headers,
  });
}