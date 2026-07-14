/* eslint-disable @typescript-eslint/no-explicit-any */
const MONDAY_API_URL = "https://api.monday.com/v2";

async function mondayRequest(query: string, variables?: Record<string, any>, retries = 3): Promise<any> {
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

  const complexityError = json.errors?.find((e: any) => e?.extensions?.code === "COMPLEXITY_BUDGET_EXHAUSTED");
  if (complexityError && retries > 0) {
    const waitSeconds = Math.min(complexityError.extensions?.retry_in_seconds ?? 10, 40);
    console.log(`[Monday API] Complexity budget exhausted, retrying in ${waitSeconds}s (retries left: ${retries - 1})`);
    await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    return mondayRequest(query, variables, retries - 1);
  }

  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

type MondayRow = {
  customerName: string;
  email: string;
  carriers: string;
  trackingNumber: string;
  eddDate: string;
  originalEddDate: string;
  productTitle: string;
  boxes: number | string;
  customerStatus: string;
  shop: string;
  orderId: string;
  variantId: string;
  warehouseStatus: string;
  dispatchStatus: string;
  deliveryStatus: string;
  depositPaid: string;
  balanceDue: string;
};

const FIELD_DEFS: Record<keyof MondayRow, { title: string; type: string; defaults?: string }> = {
  customerName: { title: "Customer", type: "text" },
  email: { title: "Email", type: "email" },
  carriers: { title: "Carrier", type: "text" },
  trackingNumber: { title: "Tracking Number", type: "text" },
  eddDate: { title: "EDD", type: "date" },
  originalEddDate: { title: "Original EDD", type: "date" },
  productTitle: { title: "Product", type: "text" },
  boxes: { title: "Quantity", type: "numbers" },
  customerStatus: {
    title: "Status",
    type: "status",
    defaults: JSON.stringify({
      labels: { "0": "Pending", "1": "Confirmed", "2": "Dispatched", "3": "Delivered", "4": "Cancelled" },
    }),
  },
  shop: { title: "Shop", type: "text" },
  orderId: { title: "Order ID", type: "text" },
  variantId: { title: "Variant ID", type: "text" },
  warehouseStatus: { title: "Warehouse Status", type: "text" },
  dispatchStatus: { title: "Dispatch Status", type: "text" },
  deliveryStatus: { title: "Delivery Status", type: "text" },
  depositPaid: { title: "Deposit Paid", type: "text" },
  balanceDue: { title: "Balance Due", type: "text" },
};

let columnIdCache: Record<string, string> | null = null;
let columnIdCachePromise: Promise<Record<string, string>> | null = null;

async function getOrCreateColumnIds(): Promise<Record<string, string>> {
  if (columnIdCache) {
    console.log("[Monday] Using cached column IDs:", columnIdCache);
    return columnIdCache;
  }

  if (columnIdCachePromise) {
    console.log("[Monday] Column ID fetch already in flight, awaiting it");
    return columnIdCachePromise;
  }

  columnIdCachePromise = (async () => {
    console.log("[Monday] Fetching board columns for board:", process.env.MONDAY_BOARD_ID);
    const data = await mondayRequest(
      `query ($boardId: ID!) { boards(ids: [$boardId]) { columns { id title type } } }`,
      { boardId: process.env.MONDAY_BOARD_ID }
    );
    const existing: { id: string; title: string; type: string }[] = data.boards?.[0]?.columns ?? [];
    console.log("[Monday] Existing columns:", existing.map((c) => c.title));
    const map: Record<string, string> = {};

    for (const [key, def] of Object.entries(FIELD_DEFS)) {
      const found = existing.find((c) => c.title.toLowerCase() === def.title.toLowerCase());
      if (found) {
        console.log(`[Monday] Column "${def.title}" already exists (id: ${found.id})`);
        map[key] = found.id;
        continue;
      }
      console.log(`[Monday] Creating column "${def.title}" (type: ${def.type})`);
      const created = await mondayRequest(
        `mutation ($boardId: ID!, $title: String!, $columnType: ColumnType!, $defaults: JSON) {
          create_column(board_id: $boardId, title: $title, column_type: $columnType, defaults: $defaults) { id }
        }`,
        { boardId: process.env.MONDAY_BOARD_ID, title: def.title, columnType: def.type, defaults: def.defaults }
      );
      console.log(`[Monday] Created column "${def.title}" -> id: ${created.create_column.id}`);
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

const statusLabelMap: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};


async function buildColumnValues(row: MondayRow) {
  const colIds = await getOrCreateColumnIds();
  const values: Record<string, any> = {};
  for (const key of Object.keys(FIELD_DEFS) as (keyof MondayRow)[]) {
    const colId = colIds[key];
    const val = row[key];
    if (key === "eddDate" || key === "originalEddDate") {
      if (val) values[colId] = { date: val };
      // omit when empty, so an empty local value never blanks an existing Monday date
    } else if (key === "customerStatus") {
      const statusVal = val as string;
      if (statusVal)
        values[colId] = { label: statusLabelMap[statusVal.toLowerCase()] ?? statusVal };
      // omit the column entirely when empty, to avoid invalid-label errors
    } else if (key === "email") {
      if (val) values[colId] = { email: val, text: val };
    } else if (key === "productTitle" || key === "boxes") {
      if (val !== "" && val != null) values[colId] = val;
      // omit when empty, so an empty local value never blanks an existing Monday value
    } else {
      if (val !== "" && val != null) values[colId] = val;
    }
  }
  return values;
}

export async function findExistingMondayItemId(orderId: string, variantId: string) {
  if (!orderId || !variantId) return null;

  const colIds = await getOrCreateColumnIds();
  const data = await mondayRequest(
    `query ($boardId: ID!, $columnId: String!, $columnValue: String!) {
      items_page_by_column_values(board_id: $boardId, columns: [{column_id: $columnId, column_values: [$columnValue]}]) {
        items { id }
      }
    }`,
    { boardId: process.env.MONDAY_BOARD_ID, columnId: colIds.orderId, columnValue: orderId }
  );

  const candidateIds = (data.items_page_by_column_values?.items ?? []).map((item: any) => item.id).filter(Boolean);
  if (!candidateIds.length) return null;

  const details = await mondayRequest(
    `query ($itemIds: [ID!]) {
      items(ids: $itemIds) { id column_values { id text } }
    }`,
    { itemIds: candidateIds }
  );

  const matched = details.items?.find((item: any) =>
    item.column_values?.some((column: any) => column.id === colIds.variantId && column.text === String(variantId))
  );

  return matched?.id ?? null;
}

export async function createMondayItem(itemName: string, row: MondayRow) {
  console.log("[Monday] createMondayItem called:", itemName, row);
  const columnValues = await buildColumnValues(row);
   console.log("[Monday] Built column values:", columnValues);
  const query = `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
    create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) { id }
  }`;
  const data = await mondayRequest(query, {
    boardId: process.env.MONDAY_BOARD_ID,
    groupId: process.env.MONDAY_GROUP_ID || undefined,
    itemName,
    columnValues: JSON.stringify(columnValues),
  });
  console.log("[Monday] Item created with id:", data.create_item.id);
  return data.create_item.id as string;
}

export async function updateMondayItem(itemId: string, row: MondayRow) {
  console.log("[Monday] updateMondayItem called:", itemId, row);
  const columnValues = await buildColumnValues(row);
  const query = `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
    change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) { id }
  }`;
  await mondayRequest(query, {
    boardId: process.env.MONDAY_BOARD_ID,
    itemId,
    columnValues: JSON.stringify(columnValues),
  });
  console.log("[Monday] Item updated:", itemId);
}

export async function fetchMondayItem(itemId: string) {
  const colIds = await getOrCreateColumnIds();
  const query = `query ($itemId: [ID!]) {
    items(ids: $itemId) { id column_values { id text value } }
  }`;
  const data = await mondayRequest(query, { itemId: [itemId] });
  const item = data.items?.[0];
  if (!item) return null;

  const getCol = (key: keyof MondayRow) => item.column_values.find((c: any) => c.id === colIds[key]);
  const getText = (key: keyof MondayRow) => getCol(key)?.text ?? "";

  const getChangedAt = (key: keyof MondayRow): string | null => {
    const raw = getCol(key)?.value;
    if (!raw) return null;
    try { return JSON.parse(raw)?.changed_at ?? null; } catch { return null; }
  };

  return {
    customerStatus: getText("customerStatus"),
    statusChangedAt: getChangedAt("customerStatus"), // unchanged from before
    eddDate: getText("eddDate"),
    eddDateChangedAt: getChangedAt("eddDate"), // NEW
    originalEddDate: getText("originalEddDate"),
    trackingNumber: getText("trackingNumber"),
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