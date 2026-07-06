/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getReportUser, storeReportToken } from "../lib/report-auth.server";
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
  lineItems: { nodes: Array<{ id: string; title: string; quantity: number; variant?: { id: string } }> };
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
  // Check for token in URL (from redirect after login)
  const url = new URL(request.url);
  const tokenFromUrl = url.searchParams.get("token");
  
  // console.log("[DEBUG] Dashboard loader - tokenFromUrl:", tokenFromUrl);
  
  // First try to get user from session cookie (existing auth)
  let user = await getReportUser(request);
  
  // If no session cookie, check if token is in URL and upgrade it to a secure cookie
  if (!user && tokenFromUrl) {
    const extSession = await prisma.externalSession.findUnique({
      where: { token: tokenFromUrl },
      include: { user: true },
    });

    if (extSession && extSession.expiresAt > new Date()) {
      user = extSession.user;
      const { cookieHeader } = await storeReportToken(request, tokenFromUrl);
      const requestUrl = new URL(request.url);
      const cleanUrl = new URL(`${requestUrl.origin}${getReportBasePath(requestUrl.pathname)}/dashboard`);
      for (const [key, value] of url.searchParams.entries()) {
        if (key !== "token") {
          cleanUrl.searchParams.set(key, value);
        }
      }
      return redirect(cleanUrl.toString(), {
        headers: { "Set-Cookie": cookieHeader },
      });
    }
  }
  // this is for token based dashboard use
  //   if (!user) {
  //   const basePath = getReportBasePath(new URL(request.url).pathname);
  //   throw redirect(`${basePath}/login`);
  // }

  // TEMPORARY DEV BYPASS — set to false before going live.
// When true, anyone can view the dashboard without logging in — including in production.
const SKIP_REPORT_AUTH = true;
const DEV_SHOP = "findash-shipping-2.myshopify.com"; // must match a row in your Session table

  if (!user) {
    if (SKIP_REPORT_AUTH) {
      user = {
        id: "dev-user",
        shop: DEV_SHOP,
        name: "Dev User",
        email: "dev@example.com",
      } as any;
    } else {
      const basePath = getReportBasePath(new URL(request.url).pathname);
      throw redirect(`${basePath}/login`);
    }
  }

  if (!user) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
  const shop = user.shop;

  const session =
    (await prisma.session.findFirst({ where: { shop, isOnline: false }, orderBy: { id: "asc" } })) ??
    (await prisma.session.findFirst({ where: { shop }, orderBy: { id: "asc" } }));

  if (!session) {
    return { orders: [], total: 0, page: 1, pageCount: 1, shop, user: { name: user.name, email: user.email } };
  }

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
            lineItems(first: 50) { nodes { id title quantity variant { id } } }
          }
        }
      }`,
      variables: { first: 250 },
    }),
  });

  const gqlJson = await gqlRes.json();
  const allOrders: ShopifyOrderNode[] = gqlJson.data?.orders?.nodes ?? [];

  const allOpsData = await prisma.orderLineItemOperationalData.findMany({ where: { shop } });
  const opsMap = new Map(allOpsData.map((r) => [`${r.orderId}::${r.variantId}`, r]));

  const freightOrders = allOrders
    .map((order) => buildRow(order, opsMap))
    .filter(Boolean) as ReturnType<typeof buildRow>[];

  const total = freightOrders.length;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const paged = freightOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return { orders: paged, allOrders: freightOrders, total, page, pageCount, shop, user: { name: user.name, email: user.email } };
}

function buildRow(order: ShopifyOrderNode, opsMap: Map<string, any>) {
  const shippingLine = order.shippingLines.nodes.find((s) =>
    FREIGHT_SERVICE_PREFIXES.some((prefix) => s.code?.startsWith(prefix))
  );
  if (!shippingLine) return null;
  const parts = shippingLine.code.split("::");
  const carriers = parts[1]; const packageCount = parts[2]; const lineItemsRaw = parts[4];
  if (!carriers || !lineItemsRaw) return null;
  const numericOrderId = order.id.replace("gid://shopify/Order/", "");
  const variantTitleMap = new Map<string, string>();
  for (const li of order.lineItems.nodes) {
    if (li.variant?.id) variantTitleMap.set(li.variant.id.replace("gid://shopify/ProductVariant/", ""), li.title);
  }
  const lineItems = lineItemsRaw.split("|").map((part, idx) => {
    const [variantId, rest] = part.split(":");
    const [company, boxesStr, amountStr] = (rest ?? "").split("x");
    const ops = opsMap.get(`${numericOrderId}::${variantId}`);
    return { id: `${order.id}-${idx}`, variantId, title: variantTitleMap.get(variantId), company: company ?? "", boxes: Number(boxesStr ?? 0), amount: Number(amountStr ?? 0), letterSuffix: LETTERS[idx % 26], customerStatus: ops?.customerStatus ?? "", trackingNumber: ops?.trackingNumber ?? "", eddDate: ops?.eddDate ?? "", originalEddDate: ops?.originalEddDate ?? "" };
  });
  return {
    id: order.id, shopifyOrderId: numericOrderId, shopifyOrderName: order.name, currency: order.currencyCode,
    totalFreight: Number(shippingLine.originalPriceSet.shopMoney.amount ?? 0),
    city: order.shippingAddress?.city ?? null, postalCode: order.shippingAddress?.zip ?? null,
    createdAt: order.createdAt, carriers, packageCount, shippingTitle: shippingLine.title, lineItems,
    customerName: `${order.shippingAddress?.firstName ?? ""} ${order.shippingAddress?.lastName ?? ""}`.trim() || "—",
    email: order.email ?? "—", phone: order.phone ?? "—",
    financialStatus: order.displayFinancialStatus ?? "—",
    fulfillmentStatus: order.displayFulfillmentStatus ?? "UNFULFILLED",
    fullAddress: [order.shippingAddress?.address1, order.shippingAddress?.city, order.shippingAddress?.province, order.shippingAddress?.zip, order.shippingAddress?.country].filter(Boolean).join(", "),
  };
}

// ─── User Avatar / Logout (containerdoor dashboard UI) ────────────────────────

function UserMenu({ user }: { user: { name: string; email: string } }) {
  const [open, setOpen] = useState(false);
  const initials = (user.name ?? user.email ?? "U").split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);

 const handleLogout = async () => {
    const basePath = getReportBasePath(window.location.pathname);
    await fetch(`${basePath}/api/report-auth?intent=logout`, { method: "POST" });
    window.location.href = `${basePath}/login`;
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
      <div className="rd-user-wrap" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <div className="rd-user-avatar" title={user.name ?? user.email}>{initials}</div>
        {open && (
          <div className="rd-user-menu">
            <div className="rd-menu-user">
              <div className="rd-menu-user-name">{user.name ?? "User"}</div>
              <div className="rd-menu-user-email">{user.email}</div>
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

  const noteAuthor = user?.name ?? user?.email ?? "User";

  return (
    <FreightDashboard
      orders={orders as any}
      allOrders={allOrders as any}
      total={total}
      page={page}
      pageCount={pageCount}
      shop={shop}
      noteAuthor={noteAuthor}
      navbarRight={user ? <UserMenu user={user} /> : null}
    />
  );
}