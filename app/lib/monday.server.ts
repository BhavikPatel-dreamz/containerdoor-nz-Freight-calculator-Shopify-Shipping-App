/* eslint-disable @typescript-eslint/no-explicit-any */
const MONDAY_API_URL = "https://api.monday.com/v2";

async function mondayRequest(
  query: string,
  variables?: Record<string, any>,
  retries = 3,
): Promise<any> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN!,
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  console.log("[Monday API] request:", JSON.stringify(variables));
  console.log("[Monday API] response:", JSON.stringify(json));

  const complexityError = json.errors?.find(
    (e: any) => e?.extensions?.code === "COMPLEXITY_BUDGET_EXHAUSTED",
  );
  if (complexityError && retries > 0) {
    const waitSeconds = Math.min(
      complexityError.extensions?.retry_in_seconds ?? 10,
      40,
    );
    console.log(
      `[Monday API] Complexity budget exhausted, retrying in ${waitSeconds}s (retries left: ${retries - 1})`,
    );
    await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    return mondayRequest(query, variables, retries - 1);
  }

  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

export function isStaleMondayItemError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Item not found in board") ||
    msg.includes("inactiveItems") ||
    msg.includes("Cannot change column value for inactive items")
  );
}

/** `{MONDAY_BOARD_LINK}/boards/{MONDAY_BOARD_ID}/pulses/{itemId}` */
export function buildMondayItemUrl(itemId?: string | null): string | null {
  const id = String(itemId ?? "").trim();
  if (!id || id === "pending") return null;
  const base = String(process.env.MONDAY_BOARD_LINK || "").replace(/\/$/, "");
  const boardId = String(process.env.MONDAY_BOARD_ID || "").trim();
  if (!base || !boardId) return null;
  return `${base}/boards/${boardId}/pulses/${id}`;
}

export function isInvalidColumnError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("InvalidColumnIdException") ||
    msg.includes("doesn't exist for the board")
  );
}

/**
 * Monday pulse name = Shopify order name + line letter, e.g. `#CDL215347A`.
 * Product titles must never be used as Monday item names.
 */
export function buildMondayPulseName(
  orderName?: string | null,
  letterSuffix?: string | null,
  fallbackOrderId?: string | null,
): string {
  let base = String(orderName || "").trim();
  if (!base) base = String(fallbackOrderId || "").trim();
  if (!base) return "Order";
  if (!base.startsWith("#")) base = `#${base}`;
  const letter = String(letterSuffix || "").trim().toUpperCase();
  return `${base}${letter}`;
}

/** Load full Monday row from OMS (ops + line index + snapshot + order ops). */
export async function buildMondayRowFromOms(args: {
  shop: string;
  orderId: string;
  variantId: string;
  /** Optional ops overrides (e.g. just-saved fields). */
  ops?: Record<string, any> | null;
}): Promise<{ row: MondayRow; itemName: string }> {
  const { default: prisma } = await import("../db.server");
  const { normalizePaymentStatus } = await import("./freight-orders.server");
  const { shop, orderId, variantId, ops: opsOverride } = args;

  // Always load OMS rows, then overlay overrides (never skip DB when override is passed).
  let [opsDb, lineIndex, snap, orderOps] = await Promise.all([
    prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
    }),
    prisma.orderLineItemIndex.findFirst({
      where: { shop, orderId, variantId },
    }),
    prisma.orderSnapshot.findFirst({
      where: { shop, orderId },
    }),
    prisma.orderOperationalData.findUnique({
      where: { shop_orderId: { shop, orderId } },
      select: { poNumber: true },
    }),
  ]);

  // Fallback without shop if shop mismatch left index/snapshot empty.
  if (!lineIndex || !snap) {
    const [lineFb, snapFb] = await Promise.all([
      !lineIndex
        ? prisma.orderLineItemIndex.findFirst({ where: { orderId, variantId } })
        : Promise.resolve(lineIndex),
      !snap
        ? prisma.orderSnapshot.findFirst({ where: { orderId } })
        : Promise.resolve(snap),
    ]);
    lineIndex = lineFb;
    snap = snapFb;
  }
  if (!opsDb) {
    opsDb = await prisma.orderLineItemOperationalData.findFirst({
      where: { orderId, variantId },
    });
  }

  const ops = { ...(opsDb || {}), ...(opsOverride || {}) } as Record<string, any>;
  const customerName =
    String(lineIndex?.customerName || "").trim() ||
    `${snap?.shippingFirstName || ""} ${snap?.shippingLastName || ""}`.trim() ||
    String(opsOverride?.customerName || "").trim();
  const email =
    String(lineIndex?.email || "").trim() ||
    String(snap?.email || "").trim() ||
    String(opsOverride?.email || "").trim();
  const phone =
    String(lineIndex?.phone || "").trim() || String(snap?.phone || "").trim();
  const address =
    String(lineIndex?.fullAddress || "").trim() ||
    [
      snap?.shippingAddress1,
      snap?.shippingAddress2,
      snap?.shippingCity,
      snap?.shippingProvince,
      snap?.shippingZip,
      snap?.shippingCountry,
    ]
      .filter(Boolean)
      .join(", ");

  const itemName = buildMondayPulseName(
    lineIndex?.orderName || snap?.orderName,
    lineIndex?.letterSuffix,
    orderId,
  );

  const orderDateRaw = snap?.createdAt
    ? new Date(snap.createdAt).toISOString().slice(0, 10)
    : lineIndex?.createdAt
      ? new Date(lineIndex.createdAt).toISOString().slice(0, 10)
      : "";

  const boxes =
    lineIndex?.boxes != null && Number(lineIndex.boxes) > 0
      ? Number(lineIndex.boxes)
      : ops.boxes != null && ops.boxes !== ""
        ? Number(ops.boxes) || ops.boxes
        : "";

  const row: MondayRow = {
    customerName,
    email,
    phone,
    address,
    carriers: String(ops.carrier || lineIndex?.company || "").trim(),
    trackingNumber: String(ops.trackingNumber || "").trim(),
    freightRef: String(ops.freightRef || "").trim(),
    deliveryMethod: "Standard",
    eddDate: String(ops.eddDate || "").trim(),
    originalEddDate: String(ops.originalEddDate || "").trim(),
    productTitle: String(ops.productTitle || lineIndex?.productTitle || "").trim(),
    variantTitle: String(lineIndex?.variantTitle || "").trim(),
    sku: String(lineIndex?.sku || "").trim(),
    productId: String(lineIndex?.productId || "").trim(),
    boxes,
    customerStatus: String(ops.customerStatus || "").trim(),
    paymentStatus: normalizePaymentStatus(
      ops.paymentStatus || lineIndex?.financialStatus || "",
    ),
    shop: shop || String(ops.shop || snap?.shop || lineIndex?.shop || ""),
    orderId,
    variantId,
    lineOrderName: itemName,
    orderDate: orderDateRaw,
    warehouseStatus: String(ops.warehouseStatus || "").trim(),
    warehouseTags: String(ops.warehouseTags || "").trim(),
    dispatchStatus: String(ops.dispatchStatus || "").trim(),
    deliveryStatus: String(ops.deliveryStatus || "").trim(),
    receivedDate: String(ops.receivedDate || "").trim(),
    portArrivalDate: String(ops.portArrivalDate || "").trim(),
    inTransitDate: String(ops.inTransitDate || "").trim(),
    supplierContainer: String(ops.supplierContainer || "").trim(),
    poNumber: String(orderOps?.poNumber || ops.poNumber || "").trim(),
    depositPaid: String(ops.depositPaid || "").trim(),
    balanceDue: String(ops.balanceDue || "").trim(),
  };

  return { row, itemName };
}

export async function renameMondayItem(itemId: string, newName: string) {
  const name = String(newName || "").trim();
  if (!itemId || !name) return;
  console.log("[Monday] renameMondayItem:", itemId, "→", name);
  await mondayRequest(
    `mutation ($boardId: ID!, $itemId: ID!, $newName: String!) {
      change_name_on_board(board_id: $boardId, item_id: $itemId, new_name: $newName) { id name }
    }`,
    {
      boardId: process.env.MONDAY_BOARD_ID,
      itemId,
      newName: name,
    },
  );
}

type MondayRow = {
  customerName: string;
  email: string;
  phone: string;
  address: string;
  carriers: string;
  trackingNumber: string;
  freightRef: string;
  deliveryMethod: string;
  eddDate: string;
  originalEddDate: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  productId: string;
  boxes: number | string;
  customerStatus: string;
  paymentStatus: string;
  shop: string;
  orderId: string;
  variantId: string;
  lineOrderName: string;
  orderDate: string;
  warehouseStatus: string;
  warehouseTags: string;
  dispatchStatus: string;
  deliveryStatus: string;
  receivedDate: string;
  portArrivalDate: string;
  inTransitDate: string;
  supplierContainer: string;
  poNumber: string;
  depositPaid: string;
  balanceDue: string;
};

const FIELD_DEFS: Record<
  keyof MondayRow,
  { title: string; type: string; defaults?: string }
> = {
  customerName: { title: "Customer", type: "text" },
  email: { title: "Email", type: "email" },
  phone: { title: "Phone", type: "text" },
  address: { title: "Address", type: "text" },
  carriers: {
    title: "Carrier",
    type: "status",
    defaults: JSON.stringify({
      labels: {
        "0": "Fliway - Linehaul",
        "1": "Fliway - Midsize",
        "2": "NZP",
        "3": "NZP - Age Restricted",
        "4": "Castle",
        "5": "Team Global Express",
        "6": "M2H",
        "7": "Mainfreight",
      },
    }),
  },
  trackingNumber: { title: "Tracking Number", type: "text" },
  freightRef: { title: "Freight Ref", type: "text" },
  deliveryMethod: { title: "Delivery Method", type: "text" },
  eddDate: { title: "EDD", type: "date" },
  originalEddDate: { title: "Original EDD", type: "date" },
  productTitle: { title: "Product", type: "text" },
  variantTitle: { title: "Variant", type: "text" },
  sku: { title: "SKU", type: "text" },
  productId: { title: "Product ID", type: "text" },
  boxes: { title: "Quantity", type: "numbers" },
  customerStatus: {
    title: "Status",
    type: "status",
    defaults: JSON.stringify({
      labels: {
        "0": "Pending",
        "1": "Confirmed",
        "2": "Dispatched",
        "3": "Delivered",
        "4": "Cancelled",
      },
    }),
  },
  paymentStatus: {
    title: "Payment Status",
    type: "status",
    defaults: JSON.stringify({
      labels: {
        "0": "Paid",
        "1": "Partial",
        "2": "Pending",
        "3": "Overdue",
      },
    }),
  },
  shop: { title: "Shop", type: "text" },
  orderId: { title: "Order ID", type: "text" },
  variantId: { title: "Variant ID", type: "text" },
  lineOrderName: { title: "Line Order #", type: "text" },
  orderDate: { title: "Order Date", type: "date" },
  warehouseStatus: {
    title: "Warehouse Status",
    type: "status",
    defaults: JSON.stringify({
      labels: {
        "0": "Not received",
        "1": "Received",
        "2": "Processing",
        "3": "Ready to dispatch",
        "4": "Dispatched",
      },
    }),
  },
  warehouseTags: { title: "Warehouse Tags", type: "text" },
  dispatchStatus: {
    title: "Dispatch Status",
    type: "status",
    defaults: JSON.stringify({
      labels: {
        "0": "Not dispatched",
        "1": "Booked",
        "2": "Dispatched",
        "3": "Failed",
      },
    }),
  },
  deliveryStatus: {
    title: "Delivery Status",
    type: "status",
    defaults: JSON.stringify({
      labels: {
        "0": "Pending",
        "1": "In transit",
        "2": "Out for delivery",
        "3": "Delivered",
        "4": "Failed",
      },
    }),
  },
  receivedDate: { title: "Received Date", type: "date" },
  portArrivalDate: { title: "Port Arrival", type: "date" },
  inTransitDate: { title: "In Transit Date", type: "date" },
  supplierContainer: { title: "Supplier / Container", type: "text" },
  poNumber: { title: "PO #", type: "text" },
  depositPaid: { title: "Deposit Paid", type: "text" },
  balanceDue: { title: "Balance Due", type: "text" },
};

let columnIdCache: Record<string, string> | null = null;
let columnIdCachePromise: Promise<Record<string, string>> | null = null;
let validGroupIdCache: string | null = null;
let validGroupIdPromise: Promise<string | undefined> | null = null;

async function getOrCreateColumnIds(): Promise<Record<string, string>> {
  if (columnIdCache) {
    const missing = Object.keys(FIELD_DEFS).filter((k) => !columnIdCache![k]);
    if (missing.length === 0) {
      console.log("[Monday] Using cached column IDs:", columnIdCache);
      return columnIdCache;
    }
    console.log("[Monday] Column cache missing new fields, refreshing:", missing);
    columnIdCache = null;
  }

  if (columnIdCachePromise) {
    console.log("[Monday] Column ID fetch already in flight, awaiting it");
    return columnIdCachePromise;
  }

  columnIdCachePromise = (async () => {
    console.log(
      "[Monday] Fetching board columns for board:",
      process.env.MONDAY_BOARD_ID,
    );
    const data = await mondayRequest(
      `query ($boardId: ID!) { boards(ids: [$boardId]) { columns { id title type } } }`,
      { boardId: process.env.MONDAY_BOARD_ID },
    );
    const existing: { id: string; title: string; type: string }[] =
      data.boards?.[0]?.columns ?? [];
    console.log(
      "[Monday] Existing columns:",
      existing.map((c) => c.title),
    );
    const map: Record<string, string> = {};

    for (const [key, def] of Object.entries(FIELD_DEFS)) {
      const found = existing.find(
        (c) => c.title.toLowerCase() === def.title.toLowerCase(),
      );
      if (found) {
        console.log(
          `[Monday] Column "${def.title}" already exists (id: ${found.id})`,
        );
        map[key] = found.id;
        continue;
      }
      console.log(
        `[Monday] Creating column "${def.title}" (type: ${def.type})`,
      );
      const created = await mondayRequest(
        `mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!, $defaults: JSON) {
          create_column(board_id: $boardId, title: $title, column_type: $columnType, defaults: $defaults) { id }
        }`,
        {
          boardId: process.env.MONDAY_BOARD_ID,
          title: def.title,
          columnType: def.type,
          defaults: def.defaults,
        },
      );
      console.log(
        `[Monday] Created column "${def.title}" -> id: ${created.create_column.id}`,
      );
      map[key] = created.create_column.id;
    }

    columnIdCache = map;
    console.log("[Monday] Final column ID map:", map);
    return map;
  })();

  try {
    return await columnIdCachePromise;
  } finally {
    columnIdCachePromise = null;
  }
}

async function getValidGroupId(): Promise<string | undefined> {
  if (validGroupIdCache) return validGroupIdCache;
  if (validGroupIdPromise) return validGroupIdPromise;

  validGroupIdPromise = (async () => {
    const configuredGroupId = process.env.MONDAY_GROUP_ID;
    if (!configuredGroupId) return undefined;

    const data = await mondayRequest(
      `query ($boardId: ID!) { boards(ids: [$boardId]) { groups { id title archived deleted } } }`,
      { boardId: process.env.MONDAY_BOARD_ID },
    );
    const groups: {
      id: string;
      title: string;
      archived?: boolean;
      deleted?: boolean;
    }[] = data.boards?.[0]?.groups ?? [];

    const configured = groups.find((g) => g.id === configuredGroupId);
    if (configured && !configured.archived && !configured.deleted) {
      console.log(
        `[Monday] Configured group "${configuredGroupId}" is active, using it`,
      );
      validGroupIdCache = configuredGroupId;
      return configuredGroupId;
    }

    console.warn(
      `[Monday] Configured MONDAY_GROUP_ID "${configuredGroupId}" is missing/archived/deleted. Falling back to first active group.`,
    );
    const fallback = groups.find((g) => !g.archived && !g.deleted);
    if (fallback) {
      console.log(
        `[Monday] Using fallback group "${fallback.title}" (${fallback.id})`,
      );
      validGroupIdCache = fallback.id;
      return fallback.id;
    }

    console.warn(
      "[Monday] No active groups found, creating item without a group_id (board default).",
    );
    return undefined;
  })();

  try {
    return await validGroupIdPromise;
  } finally {
    validGroupIdPromise = null;
  }
}

const statusLabelMap: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const paymentStatusLabelMap: Record<string, string> = {
  paid: "Paid",
  partial: "Partial",
  pending: "Pending",
  overdue: "Overdue",
  // Shopify financial statuses
  complete: "Paid",
  fully_paid: "Paid",
  authorized: "Paid",
  captured: "Paid",
  partially_paid: "Partial",
  partially_refunded: "Partial",
  pending_payment: "Pending",
  unpaid: "Pending",
  authorized_pending_capture: "Pending",
  outstanding: "Pending",
  // spaced variants
  "fully paid": "Paid",
  "partially paid": "Partial",
  "partially refunded": "Partial",
  "pending payment": "Pending",
};

/** Monday Payment Status board labels only — omit unknown to avoid whole-mutation fail. */
const MONDAY_PAYMENT_LABELS = new Set(["Paid", "Partial", "Pending", "Overdue"]);

function resolveMondayPaymentLabel(raw: string): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  const key = v.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const underscored = v.toLowerCase().replace(/[\s-]+/g, "_");
  const mapped =
    paymentStatusLabelMap[key] ||
    paymentStatusLabelMap[underscored] ||
    paymentStatusLabelMap[v.toLowerCase()] ||
    null;
  if (mapped && MONDAY_PAYMENT_LABELS.has(mapped)) return mapped;
  // Already a valid Monday label (exact casing)
  if (MONDAY_PAYMENT_LABELS.has(v)) return v;
  const titleCase = MONDAY_PAYMENT_LABELS.has(
    v.charAt(0).toUpperCase() + v.slice(1).toLowerCase(),
  )
    ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
    : null;
  return titleCase;
}

const warehouseStatusLabelMap: Record<string, string> = {
  pending: "Not received",
  "not received": "Not received",
  received: "Received",
  processing: "Processing",
  "ready to dispatch": "Ready to dispatch",
  dispatched: "Dispatched",
};

const dispatchStatusLabelMap: Record<string, string> = {
  "not dispatched": "Not dispatched",
  booked: "Booked",
  dispatched: "Dispatched",
  failed: "Failed",
};

const deliveryStatusLabelMap: Record<string, string> = {
  pending: "Pending",
  "in transit": "In transit",
  "out for delivery": "Out for delivery",
  delivered: "Delivered",
  failed: "Failed",
};

const carrierLabelMap: Record<string, string> = {
  fliway: "Fliway - Linehaul",
  fliwaylinehaul: "Fliway - Linehaul",
  fliwaymidsize: "Fliway - Midsize",
  nzp: "NZP",
  nzp_age_restricted: "NZP - Age Restricted",
  castle: "Castle",
  tge: "Team Global Express",
  m2h: "M2H",
  mainfreight: "Mainfreight",
};

const MONDAY_CARRIER_LABELS = new Set(Object.values(carrierLabelMap));

function resolveMappedLabel(
  raw: string,
  map: Record<string, string>,
): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (map[lower]) return map[lower];
  // Already a valid label value in the map
  if (Object.values(map).includes(v)) return v;
  return null;
}

async function buildColumnValues(row: MondayRow) {
  const colIds = await getOrCreateColumnIds();
  const values: Record<string, any> = {};
  const skipped: string[] = [];
  const dateKeys = new Set<keyof MondayRow>([
    "eddDate",
    "originalEddDate",
    "receivedDate",
    "portArrivalDate",
    "inTransitDate",
    "orderDate",
  ]);
  const toDate = (raw: unknown) => {
    const s = String(raw || "").trim();
    if (!s) return "";
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s.slice(0, 10);
  };

  for (const key of Object.keys(FIELD_DEFS) as (keyof MondayRow)[]) {
    const colId = colIds[key];
    if (!colId) {
      skipped.push(`${key}:no-column`);
      continue;
    }
    const val = row[key];
    if (dateKeys.has(key)) {
      const d = toDate(val);
      if (d) values[colId] = { date: d };
      else if (val) skipped.push(`${key}:bad-date`);
    } else if (key === "customerStatus") {
      const label = resolveMappedLabel(String(val || ""), statusLabelMap);
      if (label) values[colId] = { label };
      else if (val) skipped.push(`${key}:bad-label:${val}`);
    } else if (key === "carriers") {
      const carrierVal = String(val || "").trim();
      if (carrierVal) {
        const keyNorm = carrierVal.toLowerCase().replace(/[\s-]+/g, "");
        const label =
          carrierLabelMap[carrierVal.toLowerCase()] ||
          carrierLabelMap[keyNorm] ||
          (MONDAY_CARRIER_LABELS.has(carrierVal) ? carrierVal : null);
        if (label) values[colId] = { label };
        else skipped.push(`${key}:bad-label:${carrierVal}`);
      }
    } else if (key === "paymentStatus") {
      const label = resolveMondayPaymentLabel(String(val || ""));
      if (label) values[colId] = { label };
      else if (val) skipped.push(`${key}:bad-label:${val}`);
    } else if (key === "warehouseStatus") {
      const label = resolveMappedLabel(String(val || ""), warehouseStatusLabelMap);
      if (label) values[colId] = { label };
      else if (val) skipped.push(`${key}:bad-label:${val}`);
    } else if (key === "dispatchStatus") {
      const label = resolveMappedLabel(String(val || ""), dispatchStatusLabelMap);
      if (label) values[colId] = { label };
      else if (val) skipped.push(`${key}:bad-label:${val}`);
    } else if (key === "deliveryStatus") {
      const label = resolveMappedLabel(String(val || ""), deliveryStatusLabelMap);
      if (label) values[colId] = { label };
      else if (val) skipped.push(`${key}:bad-label:${val}`);
    } else if (key === "email") {
      if (val) values[colId] = { email: val, text: val };
    } else if (val !== "" && val != null) {
      values[colId] = val;
    }
  }
  if (skipped.length) {
    console.log("[Monday] buildColumnValues skipped:", skipped);
  }
  return values;
}

/** Which MondayRow fields are non-empty (for sync debug responses). */
export function summarizeMondayRow(row: MondayRow): {
  filled: Record<string, string | number>;
  blank: string[];
} {
  const filled: Record<string, string | number> = {};
  const blank: string[] = [];
  for (const key of Object.keys(FIELD_DEFS) as (keyof MondayRow)[]) {
    const val = row[key];
    if (val !== "" && val != null) filled[key] = val as string | number;
    else blank.push(key);
  }
  return { filled, blank };
}

export async function findExistingMondayItemId(
  orderId: string,
  variantId: string,
) {
  if (!orderId || !variantId) return null;

  const colIds = await getOrCreateColumnIds();
  const data = await mondayRequest(
    `query ($boardId: ID!, $columnId: String!, $columnValue: String!) {
      items_page_by_column_values(board_id: $boardId, columns: [{column_id: $columnId, column_values: [$columnValue]}]) {
        items { id }
      }
    }`,
    {
      boardId: process.env.MONDAY_BOARD_ID,
      columnId: colIds.orderId,
      columnValue: orderId,
    },
  );

  const candidateIds = (data.items_page_by_column_values?.items ?? [])
    .map((item: any) => item.id)
    .filter(Boolean);
  if (!candidateIds.length) return null;

  const details = await mondayRequest(
    `query ($itemIds: [ID!]) {
      items(ids: $itemIds) { id column_values { id text } }
    }`,
    { itemIds: candidateIds },
  );

  const matched = details.items?.find((item: any) =>
    item.column_values?.some(
      (column: any) =>
        column.id === colIds.variantId && column.text === String(variantId),
    ),
  );

  return matched?.id ?? null;
}

export async function createMondayItem(itemName: string, row: MondayRow) {
  console.log("[Monday] createMondayItem called:", itemName, row);
  const groupId = await getValidGroupId();
  const query = `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
    create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id }
  }`;

  let columnValues = await buildColumnValues(row);
  let data;
  try {
    data = await mondayRequest(query, {
      boardId: process.env.MONDAY_BOARD_ID,
      groupId,
      itemName,
      columnValues: JSON.stringify(columnValues),
    });
  } catch (err) {
    if (isInvalidColumnError(err)) {
      console.log(
        "[Monday] Stale column ID cache detected on create, clearing cache and retrying once",
      );
      columnIdCache = null;
      columnValues = await buildColumnValues(row);
      data = await mondayRequest(query, {
        boardId: process.env.MONDAY_BOARD_ID,
        groupId,
        itemName,
        columnValues: JSON.stringify(columnValues),
      });
    } else {
      throw err;
    }
  }
  console.log("[Monday] Item created with id:", data.create_item.id);
  return data.create_item.id as string;
}

export async function updateMondayItem(itemId: string, row: MondayRow) {
  console.log("[Monday] updateMondayItem called:", itemId, row);
  const query = `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
    change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
  }`;

  let columnValues = await buildColumnValues(row);
  const send = async (values: Record<string, any>) => {
    await mondayRequest(query, {
      boardId: process.env.MONDAY_BOARD_ID,
      itemId,
      columnValues: JSON.stringify(values),
    });
  };

  try {
    await send(columnValues);
  } catch (err) {
    if (isInvalidColumnError(err)) {
      console.log(
        "[Monday] Stale column ID cache detected on update, clearing cache and retrying once",
      );
      columnIdCache = null;
      columnValues = await buildColumnValues(row);
      await send(columnValues);
    } else {
      // One bad status label used to fail the whole mutation — strip that column and retry.
      const msg = err instanceof Error ? err.message : String(err);
      const colMatch = msg.match(/"column_id":"([^"]+)"/);
      const badColId = colMatch?.[1];
      if (badColId && msg.includes("missingLabel") && columnValues[badColId] != null) {
        console.warn(
          `[Monday] Removing bad column ${badColId} after missingLabel and retrying`,
          columnValues[badColId],
        );
        const { [badColId]: _removed, ...rest } = columnValues;
        await send(rest);
      } else {
        throw err;
      }
    }
  }

  // ── NEW: Monday's API returns success even when writing to a deleted/archived
  // item (the write is silently a no-op). Verify the item is actually active
  // after updating, so callers' stale-item recovery logic actually triggers.
  const verifyData = await mondayRequest(
    `query ($itemId: [ID!]) { items(ids: $itemId) { id state } }`,
    { itemId: [itemId] },
  ).catch(() => null);
  const verifiedState = verifyData?.items?.[0]?.state;
  if (verifiedState && verifiedState !== "active") {
    console.log(`[Monday] Item ${itemId} update was a no-op — item state is "${verifiedState}"`);
    throw new Error("inactiveItems");
  }
  // ── end new block ──

  console.log("[Monday] Item updated:", itemId);
}

// Text columns don't carry `changed_at` in their column value JSON (only
// date/status columns do), so for text columns we look up the last time
// that specific column was changed via the board's activity log instead.
async function fetchColumnChangedAt(
  itemId: string,
  columnId: string,
): Promise<string | null> {
  const data = await mondayRequest(
    `query ($boardId: ID!, $columnIds: [String!]) {
      boards(ids: [$boardId]) {
        activity_logs(column_ids: $columnIds, limit: 25) {
          data
          created_at
        }
      }
    }`,
    { boardId: process.env.MONDAY_BOARD_ID, columnIds: [columnId] },
  ).catch((err) => {
    console.error("[Monday] fetchColumnChangedAt failed", err);
    return null;
  });

  const logs: { data: string; created_at: string }[] =
    data?.boards?.[0]?.activity_logs ?? [];

  let latestMs: number | null = null;
  for (const log of logs) {
    try {
      const parsed = JSON.parse(log.data);
      const pulseId = String(parsed.pulse_id ?? parsed.item_id ?? "");
      if (pulseId !== String(itemId)) continue;
      // Monday activity log created_at is Unix time * 10,000,000
      // (100-nanosecond intervals) — divide by 10,000 to get milliseconds.
      const ms = Number(log.created_at) / 10000;
      if (!Number.isFinite(ms)) continue;
      if (latestMs === null || ms > latestMs) latestMs = ms;
    } catch {
      continue;
    }
  }

  return latestMs !== null ? new Date(latestMs).toISOString() : null;
}

export async function fetchMondayItem(itemId: string) {
  const colIds = await getOrCreateColumnIds();
  const query = `query ($itemId: [ID!]) {
    items(ids: $itemId) { id state column_values { id text value } }
  }`;
  const data = await mondayRequest(query, { itemId: [itemId] });
  const item = data.items?.[0];
  if (!item) return null;
  if (item.state && item.state !== "active") {
    console.log(
      `[Monday] Item ${itemId} is not active (state: ${item.state}), treating as not found`,
    );
    return null;
  }

  const getCol = (key: keyof MondayRow) =>
    item.column_values.find((c: any) => c.id === colIds[key]);
  const getText = (key: keyof MondayRow) => getCol(key)?.text ?? "";

  const getChangedAt = (key: keyof MondayRow): string | null => {
    const raw = getCol(key)?.value;
    if (!raw) return null;
    try {
      return JSON.parse(raw)?.changed_at ?? null;
    } catch {
      return null;
    }
  };

  // trackingNumber is a text column, which has no `changed_at` in its value
  // JSON, so it needs the activity-log lookup instead of getChangedAt().
  const trackingNumberChangedAt = await fetchColumnChangedAt(
    itemId,
    colIds.trackingNumber,
  );

  return {
    customerStatus: getText("customerStatus"),
    statusChangedAt: getChangedAt("customerStatus"),
    eddDate: getText("eddDate"),
    eddDateChangedAt: getChangedAt("eddDate"),
    originalEddDate: getText("originalEddDate"),
    trackingNumber: getText("trackingNumber"),
    trackingNumberChangedAt,
    warehouseStatus: getText("warehouseStatus"),
    warehouseTags: getText("warehouseTags"),
    dispatchStatus: getText("dispatchStatus"),
    deliveryStatus: getText("deliveryStatus"),
    depositPaid: getText("depositPaid"),
    balanceDue: getText("balanceDue"),
    paymentStatus: getText("paymentStatus"),
    sku: getText("sku"),
  };
}

export async function createMondayUpdate(itemId: string, body: string) {
  console.log("[Monday] createMondayUpdate called:", itemId, body);
  const query = `mutation ($itemId: ID!, $body: String!) {
    create_update(item_id: $itemId, body: $body) { id }
  }`;
  const data = await mondayRequest(query, { itemId, body });
  console.log("[Monday] Update created:", data.create_update?.id);
  return data.create_update?.id as string;
}

let mondayApiUserId: string | null = null;

export async function getMondayApiUserId(): Promise<string | null> {
  if (mondayApiUserId) return mondayApiUserId;
  const data = await mondayRequest(`query { me { id } }`).catch(() => null);
  mondayApiUserId = data?.me?.id ? String(data.me.id) : null;
  return mondayApiUserId;
}

export async function fetchMondayUpdates(itemId: string) {
  const data = await mondayRequest(
    `query ($itemId: [ID!]) { items(ids: $itemId) { updates(limit: 50) { id text_body created_at creator { id name } } } }`,
    { itemId: [itemId] },
  );
  const updates = data.items?.[0]?.updates ?? [];
  return updates
    .map((u: any) => ({
      id: String(u.id),
      creatorId: u.creator?.id != null ? String(u.creator.id) : null,
      creatorName: u.creator?.name ?? "Monday",
      body: String(u.text_body ?? "").trim(),
      createdAt: u.created_at,
    }))
    .filter((u: any) => u.body);
}
