import { createCookieSessionStorage, redirect } from "react-router";
import prisma from "../db.server";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__report_session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [process.env.SESSION_SECRET ?? "report-secret-fallback-32chars!!"],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
});

const SESSION_TOKEN_KEY = "reportToken";

function withCorsHeaders(response: Response, request?: Request) {
  const headers = new Headers(response.headers);
  const origin = request?.headers.get("Origin");

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Expose-Headers", "Location");
    headers.set("Vary", "Origin");
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Cache-Control");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Single source of truth for the mount path — works whether hit directly
// (local tunnel: /report/login) or via the Shopify app proxy
// (production: /apps/submit/report/login).
export function getReportBasePath(pathname: string) {
  const cleanPath = pathname.replace(/\/+$/, "");
  const trimmedPath = cleanPath.replace(/\/api\/report-auth$/, "");

  if (trimmedPath.endsWith("/login")) return trimmedPath.replace(/\/login$/, "");
  if (trimmedPath.endsWith("/dashboard")) return trimmedPath.replace(/\/dashboard$/, "");
  return trimmedPath;
}

function getRequestBasePath(request: Request) {
  const referer = request.headers.get("Referer");
  let pathname = referer ? new URL(referer).pathname : new URL(request.url).pathname;
  
  // If referer is from a different origin, it may only have "/" — use request URL instead
  if (!pathname || pathname === "/" || pathname === "") {
    pathname = new URL(request.url).pathname;
  }
  
  return getReportBasePath(pathname);
}

export async function getReportSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function getReportUser(request: Request) {
  const session = await getReportSession(request);
  const token = session.get(SESSION_TOKEN_KEY);
  if (!token) return null;

  const extSession = await prisma.externalSession.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!extSession) return null;
  if (extSession.expiresAt < new Date()) {
    await prisma.externalSession.delete({ where: { token } });
    return null;
  }

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

export async function createReportSession(request: Request, token: string) {
  const session = await sessionStorage.getSession();
  session.set(SESSION_TOKEN_KEY, token);
  const basePath = getRequestBasePath(request);
  return withCorsHeaders(
    redirect(`${basePath}/dashboard`, {
      headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
    }),
    request
  );
}

export async function destroyReportSession(request: Request) {
  const session = await getReportSession(request);
  const basePath = getRequestBasePath(request);
  return withCorsHeaders(
    redirect(`${basePath}/login`, {
      headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
    }),
    request
  );
}