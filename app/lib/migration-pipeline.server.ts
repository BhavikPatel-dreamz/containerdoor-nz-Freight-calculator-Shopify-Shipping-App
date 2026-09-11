/**
 * Order migration pipeline (state machine).
 *
 * Reuses existing ingest / Cin7 / Monday adapters — does not reimplement them.
 * One order = one independent run. A failed order does not stop the batch
 * unless the caller treats the error as critical (e.g. missing shop).
 *
 * Step order (Control Center):
 *   shopify → validate → oms_sync → oms_verify → cin7_sync → cin7_verify
 *   → monday_sync → monday_verify → completed
 *
 * Downstream writes (Cin7/Monday) still happen after OMS even if the other
 * integration failed (`stopOnDownstreamFailure` default false) so a Cin7
 * error does not block Monday, matching current migrate behaviour. Set
 * `stopOnDownstreamFailure: true` to halt that order at the first failed
 * sync/verify (spec example #1002).
 *
 * Dry-run (Task 4): Shopify load is already done by the caller (read).
 * OMS: no snapshot/ops/index writes.
 * Cin7: READ-ONLY GET search (no POST SalesOrders).
 * Monday: READ-ONLY item search (no create_item).
 * There is no Cin7/Monday sandbox in this app.
 */
import prisma from "../db.server";
import {
  createCin7EntryForOrder,
  createMondayEntriesForOrder,
  getOperationalLines,
  ingestShopifyOrderIntoOms,
  type IntegrationSyncStats,
  type OrderPayload,
} from "./order-webhook.server";
import { isLinkedCin7Id, buildCin7SalesOrderReference } from "./cin7-adapter.server";
import { findCin7SalesOrdersForShopifyOrder, pickCin7MatchForLine } from "./cin7.server";
import { buildMondayPulseName, findMondayItemByName, findMondayItemBySkuAndOrderName } from "./monday.server";
import { appendMigrationStepLog } from "./migration-run.server";

export const MIGRATION_STEPS = [
  "shopify",
  "validate",
  "oms_sync",
  "oms_verify",
  "cin7_sync",
  "cin7_verify",
  "monday_sync",
  "monday_verify",
  "completed",
] as const;

export type MigrationStepId = (typeof MIGRATION_STEPS)[number];
export type MigrationMode = "dry_run" | "full";
export type OrderPipelineStatus = "completed" | "partial" | "failed";
export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export type PipelineStepResult = {
  step: MigrationStepId;
  status: StepStatus;
  ok: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  message: string;
};

export type PipelineLineResult = {
  variantId: string;
  sku: string;
  title: string;
  oms: "existed" | "created" | "missing";
  monday: string;
  mondayItemId: string;
  cin7: string;
  cin7SalesOrderId: string;
};

export type OrderPipelineResult = {
  status: OrderPipelineStatus;
  currentStep: MigrationStepId;
  orderId: string;
  orderName: string;
  omsAction: string;
  monday?: IntegrationSyncStats;
  cin7?: IntegrationSyncStats;
  lines: PipelineLineResult[];
  steps: PipelineStepResult[];
  error?: string;
  /** True only for failures that should abort the whole batch (not one order). */
  critical?: boolean;
};

export type RunOrderPipelineInput = {
  shop: string;
  order: OrderPayload;
  admin: {
    graphql: (q: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
  mode?: MigrationMode;
  stopOnDownstreamFailure?: boolean;
  /** Persist step logs onto MigrationOrder when set. */
  trackingOrderId?: string;
};

function nowIso() {
  return new Date().toISOString();
}

async function timedStep(
  step: MigrationStepId,
  fn: () => Promise<{ ok: boolean; message: string; skip?: boolean; request?: unknown; response?: unknown }>,
  trackingOrderId?: string,
): Promise<PipelineStepResult> {
  const startedAt = nowIso();
  const t0 = Date.now();
  let result: PipelineStepResult;
  try {
    const out = await fn();
    const completedAt = nowIso();
    result = {
      step,
      status: out.skip ? "skipped" : out.ok ? "success" : "failed",
      ok: out.ok,
      startedAt,
      completedAt,
      durationMs: Date.now() - t0,
      message: out.message,
    };
    if (trackingOrderId) {
      await appendMigrationStepLog({
        migrationOrderId: trackingOrderId,
        step: result,
        requestSummary: out.request,
        responseSummary: out.response ?? { message: out.message },
      });
    }
    return result;
  } catch (err) {
    const completedAt = nowIso();
    const message = err instanceof Error ? err.message : String(err);
    result = {
      step,
      status: "failed",
      ok: false,
      startedAt,
      completedAt,
      durationMs: Date.now() - t0,
      message,
    };
    if (trackingOrderId) {
      await appendMigrationStepLog({
        migrationOrderId: trackingOrderId,
        step: result,
        responseSummary: { message },
      });
    }
    return result;
  }
}

export async function runOrderPipeline(input: RunOrderPipelineInput): Promise<OrderPipelineResult> {
  const shop = String(input.shop || "").trim();
  const order = input.order;
  const mode: MigrationMode = input.mode || "full";
  const stopOnDownstreamFailure = Boolean(input.stopOnDownstreamFailure);
  const steps: PipelineStepResult[] = [];

  const orderId = String(order?.id || "");
  const orderName = String(order?.name || "");

  if (!shop) {
    return {
      status: "failed",
      currentStep: "shopify",
      orderId,
      orderName,
      omsAction: "",
      lines: [],
      steps: [],
      error: "Missing shop",
      critical: true,
    };
  }

  if (mode === "dry_run") {
    return runDryOrderPipeline(input);
  }

  const trackId = input.trackingOrderId;
  const step = (
    id: MigrationStepId,
    fn: () => Promise<{ ok: boolean; message: string; skip?: boolean; request?: unknown; response?: unknown }>,
  ) => timedStep(id, fn, trackId);

  let currentStep: MigrationStepId = "shopify";
  let omsAction = "";
  let monday: IntegrationSyncStats | undefined;
  let cin7: IntegrationSyncStats | undefined;
  let lines: PipelineLineResult[] = [];
  let fatal: string | undefined;
  let opsBefore: Array<{ variantId: string; mondayItemId: string; cin7SalesOrderId: string }> = [];

  const push = (row: PipelineStepResult) => {
    steps.push(row);
    currentStep = row.step;
    if (!row.ok && !fatal) fatal = row.message;
  };

  push(
    await step("shopify", async () => {
      if (!orderId) return { ok: false, message: "Shopify payload has no order id" };
      return { ok: true, message: `Shopify order ${orderName || orderId} (id ${orderId})` };
    }),
  );
  if (!steps[steps.length - 1]?.ok) {
    return { status: "failed", currentStep, orderId, orderName, omsAction, lines, steps, error: fatal };
  }

  push(
    await step("validate", async () => {
      const shopifyLines = order.line_items ?? [];
      if (!shopifyLines.length) return { ok: false, message: "No line items" };
      const missingSku = shopifyLines.filter((li) => !String(li.sku || "").trim()).length;
      return {
        ok: true,
        message:
          `${shopifyLines.length} line item(s)` +
          (missingSku ? `; ${missingSku} missing SKU` : "; SKUs present"),
      };
    }),
  );
  if (!steps[steps.length - 1]?.ok) {
    return { status: "failed", currentStep, orderId, orderName, omsAction, lines, steps, error: fatal };
  }

  const snapshot = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { id: true },
  });
  opsBefore = await prisma.orderLineItemOperationalData.findMany({
    where: { shop, orderId },
    select: { variantId: true, mondayItemId: true, cin7SalesOrderId: true },
  });
  const omsExisted = Boolean(snapshot) && opsBefore.length > 0;
  omsAction = omsExisted ? "existed" : "created";

  push(
    await step("oms_sync", async () => {
      await ingestShopifyOrderIntoOms(shop, order, input.admin);
      return {
        ok: true,
        message: omsExisted ? "OMS snapshot/index refreshed" : "OMS snapshot + line ops created",
      };
    }),
  );
  if (!steps[steps.length - 1]?.ok) {
    return { status: "failed", currentStep, orderId, orderName, omsAction: "failed", lines, steps, error: fatal };
  }

  push(
    await step("oms_verify", async () => {
      const snap = await prisma.orderSnapshot.findUnique({
        where: { shop_orderId: { shop, orderId } },
        select: { id: true },
      });
      const opsCount = await prisma.orderLineItemOperationalData.count({ where: { shop, orderId } });
      const indexCount = await prisma.orderLineItemIndex.count({ where: { shop, orderId } });
      const opLines = getOperationalLines(order);
      if (!snap) return { ok: false, message: "OMS snapshot missing after ingest" };
      if (opsCount < 1) return { ok: false, message: "OMS has no operational line rows" };
      return {
        ok: true,
        message: `OMS ok — ${opsCount} ops, ${indexCount} index, ${opLines.length} operational line(s)`,
        request: { orderId },
        response: { opsCount, indexCount, operationalLines: opLines.length },
      };
    }),
  );
  if (!steps[steps.length - 1]?.ok) {
    return { status: "failed", currentStep, orderId, orderName, omsAction, lines, steps, error: fatal };
  }

  push(
    await step("cin7_sync", async () => {
      cin7 = await createCin7EntryForOrder(shop, order);
      return {
        ok: (cin7.failed || 0) === 0,
        message:
          `Cin7 linked=${cin7.linked} created=${cin7.created} skipped=${cin7.skipped} failed=${cin7.failed}` +
          (cin7.errors?.length ? ` — ${cin7.errors.join(" | ")}` : ""),
        request: { orderId },
        response: {
          linked: cin7.linked,
          created: cin7.created,
          skipped: cin7.skipped,
          failed: cin7.failed,
          errorCount: cin7.errors?.length || 0,
        },
      };
    }),
  );
  const cin7SyncOk = steps[steps.length - 1]?.ok ?? false;

  push(
    await step("cin7_verify", async () => {
      const opLines = getOperationalLines(order);
      const after = await prisma.orderLineItemOperationalData.findMany({
        where: { shop, orderId },
        select: { variantId: true, cin7SalesOrderId: true },
      });
      const linked = after.filter((r) => isLinkedCin7Id(r.cin7SalesOrderId)).length;
      const failed = (cin7?.failed || 0) > 0;
      if (failed) return { ok: false, message: `Cin7 verify failed — ${linked}/${opLines.length} lines linked` };
      return { ok: true, message: `Cin7 verify — ${linked}/${opLines.length} lines linked` };
    }),
  );
  const cin7Ok = cin7SyncOk && (steps[steps.length - 1]?.ok ?? false);
  if (!cin7Ok && stopOnDownstreamFailure) {
    return {
      status: "failed",
      currentStep,
      orderId,
      orderName,
      omsAction,
      cin7,
      lines,
      steps,
      error: fatal,
    };
  }

  push(
    await step("monday_sync", async () => {
      monday = await createMondayEntriesForOrder(shop, order);
      return {
        ok: (monday.failed || 0) === 0,
        message:
          `Monday linked=${monday.linked} created=${monday.created} skipped=${monday.skipped} failed=${monday.failed}` +
          (monday.errors?.length ? ` — ${monday.errors.join(" | ")}` : ""),
        request: { orderId },
        response: {
          linked: monday.linked,
          created: monday.created,
          skipped: monday.skipped,
          failed: monday.failed,
          errorCount: monday.errors?.length || 0,
        },
      };
    }),
  );
  const mondaySyncOk = steps[steps.length - 1]?.ok ?? false;

  push(
    await step("monday_verify", async () => {
      const opLines = getOperationalLines(order);
      const after = await prisma.orderLineItemOperationalData.findMany({
        where: { shop, orderId },
        select: { variantId: true, mondayItemId: true },
      });
      const linked = after.filter((r) => {
        const id = String(r.mondayItemId || "").trim();
        return Boolean(id && id !== "pending");
      }).length;
      const failed = (monday?.failed || 0) > 0;
      if (failed) return { ok: false, message: `Monday verify failed — ${linked}/${opLines.length} pulses linked` };
      return { ok: true, message: `Monday verify — ${linked}/${opLines.length} pulses linked` };
    }),
  );
  const mondayOk = mondaySyncOk && (steps[steps.length - 1]?.ok ?? false);
  if (!mondayOk && stopOnDownstreamFailure) {
    return {
      status: "partial",
      currentStep,
      orderId,
      orderName,
      omsAction,
      cin7,
      monday,
      lines,
      steps,
      error: fatal,
    };
  }

  const opLines = getOperationalLines(order);
  const afterOps = await prisma.orderLineItemOperationalData.findMany({
    where: { shop, orderId },
  });
  const beforeMap = new Map(opsBefore.map((r) => [r.variantId, r]));
  lines = opLines.map((li) => {
    const before = beforeMap.get(li.variantId);
    const after = afterOps.find((r) => r.variantId === li.variantId);
    const mondayId = String(after?.mondayItemId || "").trim();
    const cin7Id = String(after?.cin7SalesOrderId || "").trim();
    return {
      variantId: li.variantId,
      sku: li.sku,
      title: li.title,
      oms: before ? "existed" : after ? "created" : "missing",
      monday:
        mondayId && mondayId !== "pending"
          ? before?.mondayItemId && before.mondayItemId !== "pending"
            ? "existed"
            : "linked_or_created"
          : "missing",
      mondayItemId: mondayId,
      cin7: isLinkedCin7Id(cin7Id)
        ? isLinkedCin7Id(before?.cin7SalesOrderId)
          ? "existed"
          : "linked_or_created"
        : cin7Id || "missing",
      cin7SalesOrderId: isLinkedCin7Id(cin7Id) ? cin7Id : "",
    };
  });

  const downstreamOk = cin7Ok && mondayOk;
  push(
    await step("completed", async () => ({
      ok: downstreamOk,
      message: downstreamOk
        ? `Order ${orderName || orderId} completed`
        : `Order ${orderName || orderId} finished with downstream failures`,
    })),
  );

  return {
    status: downstreamOk ? "completed" : "partial",
    currentStep: "completed",
    orderId,
    orderName,
    omsAction,
    monday,
    cin7,
    lines,
    steps,
    error: downstreamOk ? undefined : fatal,
  };
}

/** Sequential batch: each order is independent. Critical result aborts the rest. */
export async function runOrderPipelineBatch(
  orders: Array<{ token: string; run: () => Promise<OrderPipelineResult> }>,
): Promise<{ results: OrderPipelineResult[]; aborted?: string }> {
  const results: OrderPipelineResult[] = [];
  for (const item of orders) {
    const result = await item.run();
    results.push(result);
    if (result.critical) {
      return { results, aborted: result.error || "Critical pipeline failure" };
    }
  }
  return { results };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Preview only — no OMS/Cin7/Monday writes. Shopify payload is already loaded. */
async function runDryOrderPipeline(input: RunOrderPipelineInput): Promise<OrderPipelineResult> {
  const shop = String(input.shop || "").trim();
  const order = input.order;
  const orderId = String(order?.id || "");
  const orderName = String(order?.name || "");
  const trackId = input.trackingOrderId;
  const steps: PipelineStepResult[] = [];
  let currentStep: MigrationStepId = "shopify";
  let fatal: string | undefined;
  const step = (
    id: MigrationStepId,
    fn: () => Promise<{ ok: boolean; message: string; skip?: boolean; request?: unknown; response?: unknown }>,
  ) => timedStep(id, fn, trackId);
  const push = (row: PipelineStepResult) => {
    steps.push(row);
    currentStep = row.step;
    if (!row.ok && !fatal) fatal = row.message;
  };

  push(
    await step("shopify", async () => {
      if (!orderId) return { ok: false, message: "Shopify payload has no order id" };
      return {
        ok: true,
        message: `READ Shopify ${orderName || orderId} (id ${orderId}) — already loaded, no write`,
        request: { orderId },
      };
    }),
  );
  if (!steps[steps.length - 1]?.ok) {
    return { status: "failed", currentStep, orderId, orderName, omsAction: "", lines: [], steps, error: fatal };
  }

  const shopifyLines = order.line_items ?? [];
  const opLines = getOperationalLines(order);
  push(
    await step("validate", async () => {
      if (!shopifyLines.length) return { ok: false, message: "No line items" };
      const missingSku = shopifyLines.filter((li) => !String(li.sku || "").trim()).length;
      return {
        ok: true,
        message: `Would process ${opLines.length || shopifyLines.length} operational line(s)` +
          (missingSku ? `; ${missingSku} missing SKU (Cin7 create would skip)` : ""),
        response: { shopifyLines: shopifyLines.length, operationalLines: opLines.length, missingSku },
      };
    }),
  );
  if (!steps[steps.length - 1]?.ok) {
    return { status: "failed", currentStep, orderId, orderName, omsAction: "", lines: [], steps, error: fatal };
  }

  const snapshot = await prisma.orderSnapshot.findUnique({
    where: { shop_orderId: { shop, orderId } },
    select: { id: true },
  });
  const opsCount = await prisma.orderLineItemOperationalData.count({ where: { shop, orderId } });
  const omsExisted = Boolean(snapshot) && opsCount > 0;
  const omsAction = omsExisted ? "existed" : "created";

  push(
    await step("oms_sync", async () => ({
      ok: true,
      skip: true,
      message: omsExisted
        ? "SIMULATED OMS — would refresh snapshot/index (no DB write)"
        : "SIMULATED OMS — would create snapshot + line ops (no DB write)",
      response: { simulated: true, would: omsExisted ? "refresh" : "create" },
    })),
  );
  push(
    await step("oms_verify", async () => ({
      ok: opLines.length > 0,
      message:
        opLines.length > 0
          ? `OMS mapping ok to ${omsExisted ? "refresh" : "create"}; ${opLines.length} line(s) in payload`
          : "No operational lines to write",
      response: { existingSnapshot: Boolean(snapshot), existingOps: opsCount, wouldWriteLines: opLines.length },
    })),
  );
  if (!steps[steps.length - 1]?.ok) {
    return { status: "failed", currentStep, orderId, orderName, omsAction, lines: [], steps, error: fatal };
  }

  let cin7: IntegrationSyncStats = { created: 0, linked: 0, skipped: 0, failed: 0 };
  push(
    await step("cin7_sync", async () => {
      const existing = await findCin7SalesOrdersForShopifyOrder({
        orderName,
        orderId,
      });
      for (const [idx, li] of opLines.entries()) {
        const letterSuffix = LETTERS[idx % 26];
        const reference = buildCin7SalesOrderReference({
          orderName,
          letterSuffix,
          orderId,
          variantId: li.variantId,
        });
        const match = pickCin7MatchForLine(existing, { reference, sku: li.sku });
        if (match?.id) cin7.linked++;
        else if (!String(li.sku || "").trim()) cin7.skipped++;
        else cin7.created++;
      }
      return {
        ok: true,
        message: `READ-ONLY Cin7 GET — would link=${cin7.linked} create=${cin7.created} skip=${cin7.skipped} (no POST)`,
        request: { orderId, readOnly: true },
        response: { ...cin7, existingMatches: existing.length, simulated: true },
      };
    }),
  );
  push(
    await step("cin7_verify", async () => ({
      ok: true,
      message: `Cin7 preview verified against GET search only`,
      response: { ...cin7, simulated: true },
    })),
  );

  let monday: IntegrationSyncStats = { created: 0, linked: 0, skipped: 0, failed: 0 };
  push(
    await step("monday_sync", async () => {
      for (const [idx, li] of opLines.entries()) {
        const letterSuffix = LETTERS[idx % 26];
        const itemName = buildMondayPulseName(orderName, letterSuffix, orderId);
        const existingId =
          (await findMondayItemByName(itemName)) ||
          (await findMondayItemBySkuAndOrderName({ sku: li.sku, orderName }));
        if (existingId) monday.linked++;
        else monday.created++;
      }
      return {
        ok: true,
        message: `READ-ONLY Monday search — would link=${monday.linked} create=${monday.created} (no create_item)`,
        request: { orderId, readOnly: true },
        response: { ...monday, simulated: true },
      };
    }),
  );
  push(
    await step("monday_verify", async () => ({
      ok: true,
      message: "Monday preview verified against item search only",
      response: { ...monday, simulated: true },
    })),
  );

  const lines: PipelineLineResult[] = opLines.map((li, idx) => ({
    variantId: li.variantId,
    sku: li.sku,
    title: li.title,
    oms: omsExisted ? "existed" : "created",
    monday: "dry_run",
    mondayItemId: "",
    cin7: "dry_run",
    cin7SalesOrderId: "",
  }));

  push(
    await step("completed", async () => ({
      ok: true,
      message: `DRY RUN complete for ${orderName || orderId} — no OMS/Cin7/Monday writes`,
    })),
  );

  return {
    status: "completed",
    currentStep: "completed",
    orderId,
    orderName,
    omsAction,
    monday,
    cin7,
    lines,
    steps,
  };
}
