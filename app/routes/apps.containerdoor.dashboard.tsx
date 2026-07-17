/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getReportUser} from "../lib/report-auth.server";
import prisma from "../db.server";
import { useState, useEffect } from "react";
import FreightDashboard from "../components/FreightDashboard";

// ─── Types ────────────────────────────────────────────────────────────────────

type ShopifyOrderNode = {
  id: string; name: string; createdAt: string; currencyCode: string;
  email?: string; phone?: string;
  displayFinancialStatus?: string; displayFulfillmentStatus?: string;
  shippingAddress?: { city?: string; zip?: string; address1?: string; province?: string; country?: string; firstName?: string; lastName?: string };
  shippingLines: { nodes: Array<{ title: string; code: string; originalPriceSet: { shopMoney: { amount: string; currencyCode: string } } }> };
  lineItems: { nodes: Array<{ id: string; title: string; quantity: number; sku?: string; variant?: { id: string; sku?: string } }> };
};

const PAGE_SIZE = 25;
const FREIGHT_SERVICE_PREFIXES = ["standard_delivery::", "depot_delivery::", "customer_pickup::"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ─── Loader ───────────────────────────────────────────────────────────────────

// Local copy — client code (UserMenu below) can't import from a .server.ts file.
function getReportBasePath(pathname: string) {
  const cleanPath = pathname.replace(/\/+$/, "");
  if (cleanPath.endsWith("/login")) return cleanPath.replace(/\/login$/, "");
  if (cleanPath.endsWith("/dashboard")) return cleanPath.replace(/\/dashboard$/, "");
  return cleanPath;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // For embedded app and direct access, do not require an App Proxy signature
  // on the dashboard page. This route must work from the logged-in dashboard
  // experience as well as through the proxy.

  console.log("[DASHBOARD LOADER] ========== START ==========");
  console.log("[DASHBOARD LOADER] Request URL:", new URL(request.url).toString());
  console.log("[DASHBOARD LOADER] Request headers - Cookie:", request.headers.get("Cookie"));
  
  // Check for token in URL (from redirect after login)
  const url = new URL(request.url);
  const tokenFromUrl = url.searchParams.get("token");

  console.log("[DASHBOARD LOADER] tokenFromUrl:", tokenFromUrl);
  
  // First try to get user from session cookie (existing auth)
  let user = await getReportUser(request);

  console.log("[DASHBOARD LOADER] user from session:", user ? { id: user.id, email: user.email, name: user.name } : "NULL");
  
  // If a token is in the URL, prefer it over any existing cookie session.
  // This avoids stale session data when the user logs in with a different
  // account or store on the same browser.
  if (tokenFromUrl) {
    console.log("[DASHBOARD LOADER] Looking up token from URL...");
    const extSession = await prisma.externalSession.findUnique({
      where: { token: tokenFromUrl },
      include: { user: true },
    });

    console.log("[DASHBOARD LOADER] extSession found:", extSession ? "YES" : "NO");
    if (extSession) console.log("[DASHBOARD LOADER] extSession.user:", { id: extSession.user?.id, email: extSession.user?.email, name: extSession.user?.name });
    if (extSession) console.log("[DASHBOARD LOADER] extSession.expiresAt:", extSession.expiresAt, "now:", new Date());

    if (extSession && extSession.expiresAt > new Date()) {
      console.log("[DASHBOARD LOADER] Session valid, using token-based auth...");
      user = extSession.user;
      // Don't redirect - just continue loading. We have the user from the token.
      // This avoids cross-domain cookie issues with Shopify's app proxy.
      console.log("[DASHBOARD LOADER] User authenticated via token:", {
        id: user.id,
        email: user.email,
        name: user.name,
        shop: user.shop,
      });
    }
  }

  if (!user) {
    const basePath = getReportBasePath(new URL(request.url).pathname);
    throw redirect(`${basePath}/login`);
  }

  console.log("[DASHBOARD LOADER] User authenticated:", {
    id: user.id,
    email: user.email,
    name: user.name,
    shop: user.shop,
  });

  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
  const shop = (url.searchParams.get("shop") || user.shop || "").trim().toLowerCase();
  
  console.log("[DASHBOARD LOADER] Page:", page, "Shop:", shop);
  
  if (!shop) {
    console.warn("[dashboard loader] No shop provided in URL or user object");
    return {
      orders: [],
      allOrders: [],
      total: 0,
      page: 1,
      pageCount: 1,
      shop: "",
      user: { name: user.name || user.email, email: user.email, shop: user.shop },
    };
  }

  console.log("[DASHBOARD LOADER] Searching for Shopify session for shop:", shop);
  const session =
    (await prisma.session.findFirst({ where: { shop, isOnline: false }, orderBy: { id: "asc" } })) ??
    (await prisma.session.findFirst({ where: { shop }, orderBy: { id: "asc" } }));

  console.log("[DASHBOARD LOADER] Shopify session found:", session ? { shop: session.shop, userId: session.userId } : "NULL");

  // No Shopify session for this shop yet — return safe empty defaults.
  // IMPORTANT: every key FreightDashboard destructures must be present here,
  // with array fields defaulting to [] (never undefined), or the component
  // will throw when it calls .length/.map/.flatMap on them.
  if (!session) {
    console.warn(`[DASHBOARD LOADER] No session found for shop: "${shop}", returning empty orders`);
    return {
      orders: [],
      allOrders: [],
      total: 0,
      page: 1,
      pageCount: 1,
      shop,
      user: { name: user.name || user.email, email: user.email, shop: user.shop },
    };
  }

  let allOrders: ShopifyOrderNode[] = [];
  try {
    console.log(`[DASHBOARD LOADER] Fetching orders for shop: ${shop}`);
    const gqlRes = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
      body: JSON.stringify({
        query: `query FreightOrders($first: Int!) {
          orders(first: $first, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id name createdAt currencyCode
              shippingAddress { city zip address1 province country firstName lastName }
              email phone displayFinancialStatus displayFulfillmentStatus
              shippingLines(first: 5) { nodes { title code originalPriceSet { shopMoney { amount currencyCode } } } }
              lineItems(first: 50) { nodes { id title quantity sku variant { id sku } } }
            }
          }
        }`,
        variables: { first: 250 },
      }),
    });

    const gqlJson = await gqlRes.json();
    console.log("[DASHBOARD LOADER] GraphQL response status:", gqlRes.status);
    if (gqlJson.errors) {
      console.error("[DASHBOARD LOADER] GraphQL errors:", gqlJson.errors);
    }
    allOrders = gqlJson.data?.orders?.nodes ?? [];
    console.log(`[DASHBOARD LOADER] Fetched ${allOrders.length} orders from Shopify`);
  } catch (err) {
    // Shopify API unreachable/errored — degrade gracefully instead of 500ing.
    console.error("[DASHBOARD LOADER] GraphQL fetch failed:", err);
    allOrders = [];
  }
  try {
    console.log(`[dashboard loader] Fetching orders for shop: ${shop}, session shop: ${session.shop}`);
    const gqlRes = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
      body: JSON.stringify({
        query: `query FreightOrders($first: Int!) {
          orders(first: $first, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id name createdAt currencyCode
              shippingAddress { city zip address1 province country firstName lastName }
              email phone displayFinancialStatus displayFulfillmentStatus
              shippingLines(first: 5) { nodes { title code originalPriceSet { shopMoney { amount currencyCode } } } }
              lineItems(first: 50) { nodes { id title quantity variant { id sku } } }
            }
          }
        }`,
        variables: { first: 250 },
      }),
    });

    const gqlJson = await gqlRes.json();
    if (gqlJson.errors) {
      console.error("[dashboard loader] GraphQL errors:", gqlJson.errors);
    }
    allOrders = gqlJson.data?.orders?.nodes ?? [];
    console.log(`[dashboard loader] Fetched ${allOrders.length} orders from Shopify`);
  } catch (err) {
    // Shopify API unreachable/errored — degrade gracefully instead of 500ing.
    console.error("[dashboard loader] GraphQL fetch failed:", err);
    allOrders = [];
  }

  const allOpsData = await prisma.orderLineItemOperationalData.findMany({ where: { shop } });
  const opsMap = new Map(allOpsData.map((r) => [`${r.orderId}::${r.variantId}`, r]));

  const orderOpData = await prisma.orderOperationalData.findMany({
    where: { shop },
    select: { orderId: true, cin7SalesOrderId: true },
  });
  const orderCin7Map = new Map(
    orderOpData
      .filter((row) => Boolean(row.cin7SalesOrderId && row.cin7SalesOrderId !== "pending"))
      .map((row) => [row.orderId, true])
  );

  const freightOrders = allOrders
    .map((order) => buildRow(order, opsMap, orderCin7Map))
    .filter((row): row is NonNullable<ReturnType<typeof buildRow>> => row !== null);

  const total = freightOrders.length;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const paged = freightOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  console.log("[DASHBOARD LOADER] Final data before return:", { total, pageCount, page, ordersCount: paged.length, userName: user.name, userEmail: user.email });

  return {
    orders: paged,
    allOrders: freightOrders,
    total,
    page,
    pageCount,
    shop,
    user: { name: user.name || user.email, email: user.email, shop: user.shop },
  };
}

function buildRow(order: ShopifyOrderNode, opsMap: Map<string, any>, orderCin7Map: Map<string, boolean>) {
  const shippingLines = order.shippingLines?.nodes ?? [];
  const shippingLine = shippingLines.find((s) =>
    FREIGHT_SERVICE_PREFIXES.some((prefix) => s.code?.startsWith(prefix))
  );
  if (!shippingLine) return null;
  const parts = (shippingLine.code ?? "").split("::");
  const carriers = parts[1];
  const packageCount = parts[2];
  const lineItemsRaw = parts[4];
  if (!carriers || !lineItemsRaw) return null;
  const numericOrderId = order.id.replace("gid://shopify/Order/", "");
  const variantTitleMap = new Map<string, string>();
  const variantSkuMap = new Map<string, string>();
  for (const li of order.lineItems?.nodes ?? []) {
    if (li.variant?.id) {
      variantTitleMap.set(li.variant.id.replace("gid://shopify/ProductVariant/", ""), li.title);
      variantSkuMap.set(li.variant.id.replace("gid://shopify/ProductVariant/", ""), li.variant.sku || li.sku || "");
    }
  }
  const lineItems = lineItemsRaw.split("|").map((part, idx) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr, amountStr] = (rest ?? "").split("x");
    const ops = opsMap.get(`${numericOrderId}::${variantId}`);
    return {
      id: `${order.id}-${idx}`,
      variantId: variantId ?? "",
      title: variantTitleMap.get(variantId ?? ""),
      sku: variantSkuMap.get(variantId ?? "") ?? "",
      company: company ?? "",
      boxes: Number(boxesStr ?? 0),
      amount: Number(amountStr ?? 0),
      letterSuffix: LETTERS[idx % 26],
      customerStatus: ops?.customerStatus ?? "",
      trackingNumber: ops?.trackingNumber ?? "",
      freightRef: ops?.freightRef ?? "",
      eddDate: ops?.eddDate ?? "",
      originalEddDate: ops?.originalEddDate ?? "",
      cin7Exists: orderCin7Map.get(numericOrderId) ?? false,
      // Restore persisted cached statuses so the UI shows DB values after a reload
      cin7Status: typeof ops?.cin7CachedStatus === "string" && ops.cin7CachedStatus.trim() ? ops.cin7CachedStatus.trim().toLowerCase() : undefined,
      cin7Mismatches: typeof ops?.cin7CachedMismatches === "string" && ops.cin7CachedMismatches.trim() ? ops.cin7CachedMismatches.split(",").map(s => s.trim()).filter(Boolean) : [],
      mondayStatus: typeof ops?.mondayCachedStatus === "string" && ops.mondayCachedStatus.trim() ? ops.mondayCachedStatus.trim().toLowerCase() as any : undefined,
      mondayMismatches: typeof ops?.mondayCachedMismatches === "string" && ops.mondayCachedMismatches.trim() ? ops.mondayCachedMismatches.split(",").map(s => s.trim()).filter(Boolean) : [],
    };
  });
  return {
    id: order.id,
    shopifyOrderId: numericOrderId,
    shopifyOrderName: order.name,
    currency: order.currencyCode,
    totalFreight: Number(shippingLine.originalPriceSet?.shopMoney?.amount ?? 0),
    city: order.shippingAddress?.city ?? null,
    postalCode: order.shippingAddress?.zip ?? null,
    createdAt: order.createdAt,
    carriers: carriers ?? "",
    packageCount: packageCount ?? "",
    shippingTitle: shippingLine.title ?? "",
    lineItems,
    customerName: `${order.shippingAddress?.firstName ?? ""} ${order.shippingAddress?.lastName ?? ""}`.trim() || "—",
    email: order.email ?? "—",
    phone: order.phone ?? "—",
    financialStatus: order.displayFinancialStatus ?? "—",
    fulfillmentStatus: order.displayFulfillmentStatus ?? "UNFULFILLED",
    fullAddress: [order.shippingAddress?.address1, order.shippingAddress?.city, order.shippingAddress?.province, order.shippingAddress?.zip, order.shippingAddress?.country].filter(Boolean).join(", "),
  };
}

// ─── User Avatar / Logout (containerdoor dashboard UI) ────────────────────────

function UserMenu({ user }: { user: { name: string; email: string; shop?: string } }) {
  const [open, setOpen] = useState(false);
  const displayName = (user.name ?? "").trim() || (user.email ?? "").trim() || "User";
  const initials = displayName.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);
  
  console.log("[USER MENU] Rendering with user:", { name: user.name, email: user.email, displayName, initials });

  const handleLogout = async () => {
    const basePath = getReportBasePath(window.location.pathname);
    const res = await fetch(`${window.location.origin}${basePath}/api/report-auth?intent=logout`, { method: "POST", credentials: "include" });
    if (res.ok) {
      try {
        const json = await res.json();
        const redirectUrl = (json as { redirectTo?: string }).redirectTo;
        if (redirectUrl) {
          window.location.href = redirectUrl;
        } else {
          window.location.href = `${basePath}/login`;
        }
      } catch {
        window.location.href = `${basePath}/login`;
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <>
      <style>{`
        .rd-user-wrap { position: relative; }
        .rd-user-avatar { width:32px;height:32px;background:#2563eb;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;cursor:pointer;border:2px solid transparent;transition:border-color .15s;user-select:none; }
        .rd-user-avatar:hover { border-color:rgba(255,255,255,.3); }
        .rd-user-menu { position:absolute;top:calc(100% + 8px);right:0;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.12);min-width:200px;z-index:999;overflow:hidden;animation:menuIn .15s ease; }
        @keyframes menuIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        .rd-menu-user { padding:12px 14px;border-bottom:1px solid #f3f4f6; }
        .rd-menu-user-name { font-size:13px;font-weight:600;color:#111827; }
        .rd-menu-user-email { font-size:11px;color:#9ca3af;margin-top:2px; }
        .rd-menu-item { display:flex;align-items:center;gap:8px;padding:10px 14px;font-size:13px;color:#374151;cursor:pointer;transition:background .1s;background:none;border:none;width:100%;text-align:left;font-family:inherit; }
        .rd-menu-item:hover { background:#f9fafb; }
        .rd-menu-item.danger { color:#dc2626; }
        .rd-menu-item.danger:hover { background:#fef2f2; }
        .rd-menu-divider { height:1px;background:#f3f4f6; }
      `}</style>
      <div
        className="rd-user-wrap"
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }
        }}
      >
        <div className="rd-user-avatar" title={displayName}>{initials}</div>
        {open && (
          <div className="rd-user-menu">
            <div className="rd-menu-user">
              <div className="rd-menu-user-name">{displayName}</div>
              {user.email && user.email !== displayName && <div className="rd-menu-user-email">{user.email}</div>}
            </div>
            <div className="rd-menu-divider"/>
            <button className="rd-menu-item danger" onClick={handleLogout}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign out
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ContainerdoorDashboard() {
  const { orders, allOrders, total, page, pageCount, shop, user } = useLoaderData<typeof loader>();

  console.log("[COMPONENT] Loaded data:", { total, shop, orders: orders?.length, user });
  
  // Ensure name has a proper fallback and is trimmed
  const userName = (user?.name ?? "").trim() || (user?.email ?? "").trim() || "User";
  const noteAuthor = userName;
  const safeUser = user ?? { name: userName, email: "", shop: "" };

  console.log("[COMPONENT] userName:", userName, "safeUser:", safeUser);

  return (
    <FreightDashboard
      orders={(orders ?? []) as any}
      allOrders={(allOrders ?? []) as any}
      total={total ?? 0}
      page={page ?? 1}
      pageCount={pageCount ?? 1}
      shop={shop}
      noteAuthor={noteAuthor}
      navbarRight={<UserMenu user={safeUser} />}
    />
  );
}