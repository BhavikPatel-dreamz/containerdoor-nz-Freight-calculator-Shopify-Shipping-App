/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Order amendments — CS edits once in OMS; we sync to Shopify (+ Monday where relevant)
 * and always write CommunicationLog audit (what / old / new / who / when).
 *
 * Launch scope: contact, address, delivery instructions, soft cancel line/order.
 * Variant swap (orderEdit) — next slice.
 */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { logActivity } from "./communication-log.server";
import { updateMondayItem, buildMondayRowFromOms } from "./monday.server";

export type ContactAmendment = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

export type AddressAmendment = {
  firstName?: string;
  lastName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
  phone?: string;
};

export type AmendmentInput = {
  shop: string;
  orderId: string;
  performedBy: string;
  /** Optional line context for cancel-line / audit */
  variantId?: string;
  contact?: ContactAmendment;
  address?: AddressAmendment;
  deliveryInstructions?: string;
  /** Soft-cancel one ops line (customerStatus=cancelled) */
  cancelLineItem?: boolean;
  /** Soft-cancel all ops lines on the order */
  cancelOrder?: boolean;
};

export type AmendmentResult = {
  ok: boolean;
  error?: string;
  changes: Array<{ field: string; oldValue: string; newValue: string }>;
  shopifyOk?: boolean;
  shopifyError?: string;
  mondayOk?: boolean;
  cin7Ok?: boolean;
  cin7Error?: string;
  activityLogged: number;
};

function fullAddressFrom(parts: {
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
}) {
  return [parts.address1, parts.address2, parts.city, parts.province, parts.zip, parts.country]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

async function pushShopifyOrderUpdate(
  shop: string,
  orderId: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      mutation OrderAmendmentUpdate($input: OrderInput!) {
        orderUpdate(input: $input) {
          order { id email phone }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          input: {
            id: `gid://shopify/Order/${orderId}`,
            ...input,
          },
        },
      },
    );
    const json = await res.json();
    const errors = json?.data?.orderUpdate?.userErrors ?? [];
    if (errors.length) {
      return { ok: false, error: errors.map((e: { message: string }) => e.message).join("; ") };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function pushDeliveryInstructionsMetafield(
  shop: string,
  orderId: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(
      `#graphql
      mutation SetDeliveryInstructions($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              ownerId: `gid://shopify/Order/${orderId}`,
              namespace: "containerdoor_ops",
              key: "delivery_instructions",
              type: "multi_line_text_field",
              value: value || " ",
            },
          ],
        },
      },
    );
    const json = await res.json();
    const errors = json?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      return { ok: false, error: errors.map((e: { message: string }) => e.message).join("; ") };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Load current contact/address for amend form. */
export async function getOrderAmendmentDraft(shop: string, orderId: string, variantId?: string) {
  const snap = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });
  if (!snap) return null;

  let lineOps: any = null;
  if (variantId) {
    lineOps = await prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
    });
  }
  const hasLineAddress = Boolean(
    lineOps && (lineOps.shippingAddress1 || lineOps.shippingCity || lineOps.shippingZip),
  );

  return {
    orderId: snap.orderId,
    orderName: snap.orderName,
    email: snap.email,
    phone: snap.phone,
    firstName: hasLineAddress ? lineOps.shippingFirstName : snap.shippingFirstName,
    lastName: hasLineAddress ? lineOps.shippingLastName : snap.shippingLastName,
    address1: hasLineAddress ? lineOps.shippingAddress1 : snap.shippingAddress1,
    address2: hasLineAddress ? lineOps.shippingAddress2 : snap.shippingAddress2,
    city: hasLineAddress ? lineOps.shippingCity : snap.shippingCity,
    province: hasLineAddress ? lineOps.shippingProvince : snap.shippingProvince,
    zip: hasLineAddress ? lineOps.shippingZip : snap.shippingZip,
    country: hasLineAddress ? lineOps.shippingCountry : snap.shippingCountry,
    deliveryInstructions: snap.deliveryInstructions,
  };
}

export async function applyOrderAmendment(input: AmendmentInput): Promise<AmendmentResult> {
  const { shop, orderId, performedBy } = input;
  const changes: AmendmentResult["changes"] = [];
  let activityLogged = 0;

  const snap = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });
  if (!snap) {
    return { ok: false, error: "Order not found in OMS snapshot", changes: [], activityLogged: 0 };
  }

  const snapUpdate: Record<string, string> = {};
  const shopifyInput: Record<string, unknown> = {};
  let needShopifyAddress = false;
  let needInstructionsMeta = false;
  let instructionsValue = "";

  // ── Contact ──
  if (input.contact) {
    const c = input.contact;
    if (c.email !== undefined && c.email.trim() !== snap.email) {
      changes.push({ field: "email", oldValue: snap.email, newValue: c.email.trim() });
      snapUpdate.email = c.email.trim();
      shopifyInput.email = c.email.trim();
    }
    if (c.phone !== undefined && c.phone.trim() !== snap.phone) {
      changes.push({ field: "phone", oldValue: snap.phone, newValue: c.phone.trim() });
      snapUpdate.phone = c.phone.trim();
      shopifyInput.phone = c.phone.trim();
    }
    if (c.firstName !== undefined && c.firstName.trim() !== snap.shippingFirstName) {
      changes.push({ field: "firstName", oldValue: snap.shippingFirstName, newValue: c.firstName.trim() });
      snapUpdate.shippingFirstName = c.firstName.trim();
      needShopifyAddress = true;
    }
    if (c.lastName !== undefined && c.lastName.trim() !== snap.shippingLastName) {
      changes.push({ field: "lastName", oldValue: snap.shippingLastName, newValue: c.lastName.trim() });
      snapUpdate.shippingLastName = c.lastName.trim();
      needShopifyAddress = true;
    }
  }

  // ── Address ──
    if (input.address && !input.variantId) {
    const a = input.address;
    const map: Array<[keyof AddressAmendment, string, string]> = [
      ["firstName", "shippingFirstName", "firstName"],
      ["lastName", "shippingLastName", "lastName"],
      ["address1", "shippingAddress1", "address1"],
      ["address2", "shippingAddress2", "address2"],
      ["city", "shippingCity", "city"],
      ["province", "shippingProvince", "province"],
      ["zip", "shippingZip", "zip"],
      ["country", "shippingCountry", "country"],
    ];
    for (const [inKey, snapKey, label] of map) {
      if (a[inKey] === undefined) continue;
      const next = String(a[inKey] ?? "").trim();
      const prev = String((snap as any)[snapKey] ?? "");
      if (next === prev) continue;
      changes.push({ field: label, oldValue: prev, newValue: next });
      snapUpdate[snapKey] = next;
      needShopifyAddress = true;
    }
    if (a.phone !== undefined && a.phone.trim() !== snap.phone) {
      // shipping phone often mirrors order phone
      if (!changes.some((ch) => ch.field === "phone")) {
        changes.push({ field: "phone", oldValue: snap.phone, newValue: a.phone.trim() });
        snapUpdate.phone = a.phone.trim();
        shopifyInput.phone = a.phone.trim();
      }
    }
  }

  // ── Address (line/product-level override) ──
  let lineAddressChanged = false;
  if (input.address && input.variantId) {
    const lineOps = await prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId: input.variantId } },
    });
    if (lineOps) {
      const a = input.address;
      const lineUpdate: Record<string, string> = {};
      const lmap: Array<[keyof AddressAmendment, string, string]> = [
        ["firstName", "shippingFirstName", "firstName"],
        ["lastName", "shippingLastName", "lastName"],
        ["address1", "shippingAddress1", "address1"],
        ["address2", "shippingAddress2", "address2"],
        ["city", "shippingCity", "city"],
        ["province", "shippingProvince", "province"],
        ["zip", "shippingZip", "zip"],
        ["country", "shippingCountry", "country"],
      ];
      for (const [inKey, lineKey, label] of lmap) {
        if (a[inKey] === undefined) continue;
        const next = String(a[inKey] ?? "").trim();
        const prev = String((lineOps as any)[lineKey] ?? "");
        if (next === prev) continue;
        lineUpdate[lineKey] = next;
        lineAddressChanged = true;
        changes.push({ field: label, oldValue: prev, newValue: next });
      }
      if (lineAddressChanged) {
        await prisma.orderLineItemOperationalData.update({
          where: { id: lineOps.id },
          data: lineUpdate,
        });
      }
    }
  }

  // ── Delivery instructions ──
  if (input.deliveryInstructions !== undefined) {
    const next = input.deliveryInstructions.trim();
    if (next !== snap.deliveryInstructions) {
      changes.push({
        field: "deliveryInstructions",
        oldValue: snap.deliveryInstructions,
        newValue: next,
      });
      snapUpdate.deliveryInstructions = next;
      needInstructionsMeta = true;
      instructionsValue = next;
    }
  }

  // Build Shopify shippingAddress from merged values
  if (needShopifyAddress) {
    const merged = {
      firstName: snapUpdate.shippingFirstName ?? snap.shippingFirstName,
      lastName: snapUpdate.shippingLastName ?? snap.shippingLastName,
      address1: snapUpdate.shippingAddress1 ?? snap.shippingAddress1,
      address2: snapUpdate.shippingAddress2 ?? snap.shippingAddress2,
      city: snapUpdate.shippingCity ?? snap.shippingCity,
      province: snapUpdate.shippingProvince ?? snap.shippingProvince,
      zip: snapUpdate.shippingZip ?? snap.shippingZip,
      country: snapUpdate.shippingCountry ?? snap.shippingCountry,
      phone: snapUpdate.phone ?? snap.phone,
    };
    shopifyInput.shippingAddress = merged;
  }

  // ── Soft cancel ──
  const cancelTargets: Array<{ variantId: string; opsId: string; oldStatus: string }> = [];
  if (input.cancelLineItem && input.variantId) {
    const ops = await prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId: input.variantId } },
    });
    if (ops && (ops.customerStatus || "").toLowerCase() !== "cancelled") {
      cancelTargets.push({
        variantId: ops.variantId,
        opsId: ops.id,
        oldStatus: ops.customerStatus || "",
      });
    }
  } else if (input.cancelOrder) {
    const lines = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, orderId },
    });
    for (const ops of lines) {
      if ((ops.customerStatus || "").toLowerCase() === "cancelled") continue;
      cancelTargets.push({
        variantId: ops.variantId,
        opsId: ops.id,
        oldStatus: ops.customerStatus || "",
      });
    }
  }

  if (changes.length === 0 && cancelTargets.length === 0) {
    return { ok: true, changes: [], activityLogged: 0 };
  }

  // ── Persist OMS snapshot ──
  if (Object.keys(snapUpdate).length > 0) {
    await prisma.orderSnapshot.update({
      where: { id: snap.id },
      data: snapUpdate,
    });

    // Keep line index denormalized fields in sync
    const indexData: Record<string, string> = {};
    if (snapUpdate.email !== undefined) indexData.email = snapUpdate.email;
    if (snapUpdate.phone !== undefined) indexData.phone = snapUpdate.phone;
    const nameFirst = snapUpdate.shippingFirstName ?? snap.shippingFirstName;
    const nameLast = snapUpdate.shippingLastName ?? snap.shippingLastName;
    if (snapUpdate.shippingFirstName !== undefined || snapUpdate.shippingLastName !== undefined) {
      indexData.customerName = `${nameFirst} ${nameLast}`.trim();
    }
    if (
      snapUpdate.shippingAddress1 !== undefined ||
      snapUpdate.shippingAddress2 !== undefined ||
      snapUpdate.shippingCity !== undefined ||
      snapUpdate.shippingProvince !== undefined ||
      snapUpdate.shippingZip !== undefined ||
      snapUpdate.shippingCountry !== undefined
    ) {
      indexData.fullAddress = fullAddressFrom({
        address1: snapUpdate.shippingAddress1 ?? snap.shippingAddress1,
        address2: snapUpdate.shippingAddress2 ?? snap.shippingAddress2,
        city: snapUpdate.shippingCity ?? snap.shippingCity,
        province: snapUpdate.shippingProvince ?? snap.shippingProvince,
        zip: snapUpdate.shippingZip ?? snap.shippingZip,
        country: snapUpdate.shippingCountry ?? snap.shippingCountry,
      });
      if (snapUpdate.shippingCity !== undefined) indexData.city = snapUpdate.shippingCity;
      if (snapUpdate.shippingZip !== undefined) indexData.zip = snapUpdate.shippingZip;
    }
    if (Object.keys(indexData).length > 0) {
      await prisma.orderLineItemIndex.updateMany({
        where: { shop, orderId },
        data: indexData,
      });
    }
  }

  // Soft-cancel ops rows
  for (const t of cancelTargets) {
    await prisma.orderLineItemOperationalData.update({
      where: { id: t.opsId },
      data: { customerStatus: "cancelled", customerStatusUpdatedAt: new Date() },
    });
    changes.push({
      field: input.cancelOrder ? "orderCancel" : "lineCancel",
      oldValue: t.oldStatus || "none",
      newValue: "cancelled",
    });
  }

  // ── Shopify mirror ──
  let shopifyOk: boolean | undefined;
  let shopifyError: string | undefined;
  if (Object.keys(shopifyInput).length > 0) {
    const r = await pushShopifyOrderUpdate(shop, orderId, shopifyInput);
    shopifyOk = r.ok;
    shopifyError = r.error;
  }
  if (needInstructionsMeta) {
    const r = await pushDeliveryInstructionsMetafield(shop, orderId, instructionsValue);
    if (shopifyOk === undefined) shopifyOk = r.ok;
    else shopifyOk = shopifyOk && r.ok;
    if (!r.ok) shopifyError = [shopifyError, r.error].filter(Boolean).join("; ");
  }

  // Cancelled status → Shopify metafield per line (customer-facing)
  if (cancelTargets.length > 0) {
    const { pushCustomerStatusToShopify } = await import("./shopify-sync.server");
    for (const t of cancelTargets) {
      const r = await pushCustomerStatusToShopify(shop, orderId, t.variantId, "cancelled");
      if (shopifyOk === undefined) shopifyOk = r.ok;
      else shopifyOk = shopifyOk && r.ok;
      if (!r.ok) shopifyError = [shopifyError, r.error].filter(Boolean).join("; ");
    }
  }

  // ── Cin7 (per-line delivery address) ──
  let cin7Ok: boolean | undefined;
  let cin7Error: string | undefined;
  if (lineAddressChanged && input.variantId) {
    try {
      const { resolveCin7SalesOrderId } = await import("./cin7-adapter.server");
      const { syncCin7DeliveryAddress } = await import("./cin7.server");
      const link = await resolveCin7SalesOrderId({ shop, orderId, variantId: input.variantId });
      if (link.salesOrderId) {
        const a = input.address!;
        const r = await syncCin7DeliveryAddress({
          salesOrderId: link.salesOrderId,
          firstName: a.firstName ?? snap.shippingFirstName,
          lastName: a.lastName ?? snap.shippingLastName,
          address1: a.address1 ?? snap.shippingAddress1,
          address2: a.address2 ?? snap.shippingAddress2,
          city: a.city ?? snap.shippingCity,
          state: a.province ?? snap.shippingProvince,
          postalCode: a.zip ?? snap.shippingZip,
          country: a.country ?? snap.shippingCountry,
        });
        cin7Ok = r.updated;
        if (r.error) cin7Error = r.error;
      }
    } catch (e) {
      cin7Ok = false;
      cin7Error = e instanceof Error ? e.message : String(e);
    }
  }

  // ── Monday (name/email on linked items) ──
  let mondayOk: boolean | undefined;
  const nameChanged = changes.some((c) => c.field === "firstName" || c.field === "lastName" || c.field === "email");
  if (nameChanged || cancelTargets.length > 0) {
    const lines = await prisma.orderLineItemOperationalData.findMany({
      where: { shop, orderId, mondayItemId: { not: null } },
    });
    const first = snapUpdate.shippingFirstName ?? snap.shippingFirstName;
    const last = snapUpdate.shippingLastName ?? snap.shippingLastName;
    const email = snapUpdate.email ?? snap.email;
    mondayOk = true;
    for (const line of lines) {
      if (!line.mondayItemId || line.mondayItemId === "pending") continue;
      try {
        const { row } = await buildMondayRowFromOms({
          shop,
          orderId,
          variantId: line.variantId,
          ops: {
            ...line,
            customerStatus:
              cancelTargets.some((t) => t.variantId === line.variantId)
                ? "cancelled"
                : line.customerStatus ?? "",
          },
        });
        await updateMondayItem(line.mondayItemId, {
          ...row,
          customerName: `${first} ${last}`.trim() || row.customerName,
          email: email || row.email,
        });
      } catch (e) {
        mondayOk = false;
        console.error("[Amendments] Monday sync failed", e);
      }
    }
  }

  // ── Audit — one CommunicationLog row per changed field ──
  const now = new Date();
  const activityTypeFor = (field: string) => {
    if (field === "email" || field === "phone" || field === "firstName" || field === "lastName") {
      return "contact_update";
    }
    if (field === "deliveryInstructions") return "delivery_instructions_update";
    if (field === "lineCancel" || field === "orderCancel") return "cancel_update";
    return "address_update";
  };

  for (const ch of changes) {
    const variantForLog =
      ch.field === "lineCancel" || ch.field === "orderCancel"
        ? input.variantId || cancelTargets[0]?.variantId
        : input.variantId;
    await logActivity({
      shop,
      orderId,
      variantId: variantForLog,
      activityType: activityTypeFor(ch.field),
      channel: "oms",
      subject: ch.field,
      body: `${ch.field} changed from "${ch.oldValue || "none"}" to "${ch.newValue || "none"}" by ${performedBy}`,
      sentBy: performedBy,
      deliveryStatus: "internal",
      metadata: {
        field: ch.field,
        oldValue: ch.oldValue,
        newValue: ch.newValue,
        source: "oms_amendment",
        shopifyOk,
        mondayOk,
      },
      sentAt: now,
    });
    activityLogged += 1;
  }

  return {
    ok: true,
    changes,
    shopifyOk,
    shopifyError,
    mondayOk,
    cin7Ok,
    cin7Error,
    activityLogged,
  };
}
