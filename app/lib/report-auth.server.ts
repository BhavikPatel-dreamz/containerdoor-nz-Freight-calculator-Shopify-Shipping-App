import { createCookieSessionStorage, redirect } from "react-router";
import prisma from "../db.server";

const shopifyAppUrl = process.env.SHOPIFY_APP_URL ?? "http://localhost";
const secureCookie = shopifyAppUrl.startsWith("https://") || process.env.NODE_ENV === "production";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__report_session",
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secrets: [process.env.SESSION_SECRET ?? "report-secret-fallback-32chars!!"],
    secure: secureCookie,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
});

const SESSION_TOKEN_KEY = "reportToken";

function withCorsHeaders(response: Response, request?: Request) {
  const headers = new Headers(response.headers);
  const origin = request?.headers.get("Origin");

  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Expose-Headers", "Location");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Cache-Control");

  // console.log("[DEBUG] withCorsHeaders - original Set-Cookie:", response.headers.get("Set-Cookie"));
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Single source of truth for the mount path — works whether hit directly
// (local tunnel: /apps/containerdoor/login) or via the Shopify app proxy
// (production: /apps/containerdoor/login).
export function getReportBasePath(pathname: string) {
  // console.log("[DEBUG] getReportBasePath input pathname:", pathname);
  const cleanPath = pathname.replace(/\/+$/, "");
  // console.log("[DEBUG] After removing trailing slashes:", cleanPath);
  const trimmedPath = cleanPath.replace(/\/api\/report-auth$/, "");
  // console.log("[DEBUG] After removing /api/report-auth:", trimmedPath);

  if (trimmedPath.endsWith("/login")) {
    const result = trimmedPath.replace(/\/login$/, "");
    // console.log("[DEBUG] Ends with /login, returning:", result);
    return result;
  }
  if (trimmedPath.endsWith("/dashboard")) {
    const result = trimmedPath.replace(/\/dashboard$/, "");
    // console.log("[DEBUG] Ends with /dashboard, returning:", result);
    return result;
  }
  // console.log("[DEBUG] Returning trimmedPath as-is:", trimmedPath);
  return trimmedPath;
}

function getRequestBasePath(request: Request) {
  // console.log("[DEBUG] === getRequestBasePath called ===");
  // console.log("[DEBUG] request.url:", request.url);
  
  const referer = request.headers.get("Referer");
  const forwardedProto = request.headers.get("X-Forwarded-Proto") || "https";
  const forwardedHost = request.headers.get("X-Forwarded-Host");
  
  // console.log("[DEBUG] X-Forwarded-Proto:", forwardedProto);
  // console.log("[DEBUG] X-Forwarded-Host:", forwardedHost);
  // console.log("[DEBUG] Referer:", referer);
  
  // Extract shop origin (prefer X-Forwarded-Host, fallback to Referer)
  let shopOrigin = "";
  if (forwardedHost) {
    shopOrigin = `${forwardedProto}://${forwardedHost}`;
    // console.log("[DEBUG] Using X-Forwarded-Host for origin:", shopOrigin);
  } else if (referer) {
    try {
      const refererUrl = new URL(referer);
      shopOrigin = refererUrl.origin;
      // console.log("[DEBUG] Using Referer origin:", shopOrigin);
    } catch (e) {
      // console.log("[DEBUG] Failed to parse referer:", e);
    }
  }
  
  // Extract app path from request URL
  const pathname = new URL(request.url).pathname;
  const basePath = getReportBasePath(pathname);
  // console.log("[DEBUG] Request pathname:", pathname);
  // console.log("[DEBUG] basePath from getReportBasePath:", basePath);
  
  // Build final path
  let finalPath = "";
  if (shopOrigin && basePath && basePath !== "/" && !basePath.startsWith("/api")) {
    finalPath = `${shopOrigin}${basePath}`;
    // console.log("[DEBUG] Using shop origin + basePath:", finalPath);
  } else if (shopOrigin && basePath === "/apps/containerdoor") {
    // Special case: if we got the app path from request URL, use it with shop origin
    finalPath = `${shopOrigin}${basePath}`;
    // console.log("[DEBUG] App path found in request, using with shop origin:", finalPath);
  } else if (basePath && basePath !== "/" && !basePath.startsWith("/api")) {
    finalPath = basePath;
    // console.log("[DEBUG] Using basePath without origin (fallback):", finalPath);
  }
  
  // console.log("[DEBUG] Final path:", finalPath || "EMPTY");
  return finalPath;
}

export async function getReportSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  // console.log("[DEBUG] === getReportSession called ===");
  // console.log("[DEBUG] Cookie header:", cookie);
  const session = await sessionStorage.getSession(cookie);
  // console.log("[DEBUG] Session data:", session.data);
  return session;
}

export async function getReportUser(request: Request) {
  // console.log("[DEBUG] === getReportUser called ===");
  const session = await getReportSession(request);
  const token = session.get(SESSION_TOKEN_KEY);
  // console.log("[DEBUG] Token from session:", token);
  
  if (!token) {
    // console.log("[DEBUG] No token found in session, returning null");
    return null;
  }

  const extSession = await prisma.externalSession.findUnique({
    where: { token },
    include: { user: true },
  });
  
  // console.log("[DEBUG] externalSession from DB:", extSession ? "found" : "not found");

  if (!extSession) {
    console.log("[DEBUG] No extSession found");
    return null;
  }
  
  if (extSession.expiresAt < new Date()) {
    // console.log("[DEBUG] Session expired");
    await prisma.externalSession.delete({ where: { token } });
    return null;
  }

  // console.log("[DEBUG] User found:", extSession.user.email);
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
  // console.log("[DEBUG] === createReportSession called ===");
  const basePath = getRequestBasePath(request);
  // console.log("[DEBUG] basePath from getRequestBasePath:", basePath);
  
  // Include token as URL parameter so it can be stored client-side
  const redirectUrl = `${basePath}/dashboard?token=${encodeURIComponent(token)}`;
  // console.log("[DEBUG] Redirecting to:", redirectUrl);
  
  // Return JSON response with redirect URL
  // Token is passed in URL and will be stored in localStorage by the client
  const payload = { redirectTo: redirectUrl };
  
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function destroyReportSession(request: Request) {
  const session = await getReportSession(request);
  const basePath = getRequestBasePath(request);
  return redirect(`${basePath}/login`, {
    headers: { "Set-Cookie": await sessionStorage.destroySession(session) },
  });
}