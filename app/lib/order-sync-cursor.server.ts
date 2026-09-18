import prisma from "../db.server";

export type OrderSyncCursorState = {
  after: string | null;
  skipIds: string[];
  lastOrderId: string;
  lastOrderName: string;
  lastOk: boolean | null;
  lastMessage: string;
  processed: number;
  success: number;
  failed: number;
  caughtUp: boolean;
};

function parseSkipIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x || "").trim()).filter(Boolean).slice(-1500);
  } catch {
    return [];
  }
}

export async function loadOrderSyncCursor(
  shop: string,
  source = "cron",
): Promise<OrderSyncCursorState | null> {
  const row = await prisma.orderSyncCursor.findUnique({
    where: { shop_source: { shop, source } },
  });
  if (!row) return null;
  return {
    after: row.after || null,
    skipIds: parseSkipIds(row.skipIdsJson),
    lastOrderId: row.lastOrderId,
    lastOrderName: row.lastOrderName,
    lastOk: row.lastOk,
    lastMessage: row.lastMessage,
    processed: row.processed,
    success: row.success,
    failed: row.failed,
    caughtUp: row.caughtUp,
  };
}

export async function saveOrderSyncCursor(input: {
  shop: string;
  source?: string;
  after?: string | null;
  skipIds?: string[];
  lastOrderId?: string;
  lastOrderName?: string;
  lastOk?: boolean | null;
  lastMessage?: string;
  bumpProcessed?: boolean;
  bumpSuccess?: boolean;
  bumpFailed?: boolean;
  caughtUp?: boolean;
  reset?: boolean;
}) {
  const shop = String(input.shop || "").trim();
  const source = input.source || "cron";
  if (!shop) return null;

  const existing = await prisma.orderSyncCursor.findUnique({
    where: { shop_source: { shop, source } },
  });

  if (input.reset) {
    return prisma.orderSyncCursor.upsert({
      where: { shop_source: { shop, source } },
      create: { shop, source },
      update: {
        after: "",
        skipIdsJson: "[]",
        lastMessage: "Cursor reset",
        caughtUp: false,
        processed: 0,
        success: 0,
        failed: 0,
        lastOrderId: "",
        lastOrderName: "",
        lastOk: null,
      },
    });
  }

  const skipIds = (input.skipIds || parseSkipIds(existing?.skipIdsJson || "[]")).slice(-1500);
  const processed = (existing?.processed || 0) + (input.bumpProcessed ? 1 : 0);
  const success = (existing?.success || 0) + (input.bumpSuccess ? 1 : 0);
  const failed = (existing?.failed || 0) + (input.bumpFailed ? 1 : 0);

  return prisma.orderSyncCursor.upsert({
    where: { shop_source: { shop, source } },
    create: {
      shop,
      source,
      after: input.after || "",
      skipIdsJson: JSON.stringify(skipIds),
      lastOrderId: input.lastOrderId || "",
      lastOrderName: input.lastOrderName || "",
      lastOk: input.lastOk ?? null,
      lastMessage: input.lastMessage || "",
      processed,
      success,
      failed,
      caughtUp: Boolean(input.caughtUp),
    },
    update: {
      after: input.after !== undefined ? input.after || "" : undefined,
      skipIdsJson: JSON.stringify(skipIds),
      lastOrderId: input.lastOrderId !== undefined ? input.lastOrderId : undefined,
      lastOrderName: input.lastOrderName !== undefined ? input.lastOrderName : undefined,
      lastOk: input.lastOk !== undefined ? input.lastOk : undefined,
      lastMessage: input.lastMessage !== undefined ? input.lastMessage : undefined,
      processed,
      success,
      failed,
      caughtUp: input.caughtUp !== undefined ? input.caughtUp : undefined,
    },
  });
}
