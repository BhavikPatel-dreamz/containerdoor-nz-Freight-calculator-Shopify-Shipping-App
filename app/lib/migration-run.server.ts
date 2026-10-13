/**
 * Persist Control Center migration runs / orders / step logs.
 * Never store tokens, passwords, emails, phones, or addresses.
 */
import prisma from "../db.server";
import type { MigrationMode, PipelineStepResult } from "./migration-pipeline.server";

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|email|phone|address|access/i;
const MAX_FIELD = 1500;

function clip(text: string, max = MAX_FIELD): string {
  const s = String(text || "");
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Strip secrets and contact PII from objects before JSON logging. */
export function safeLogJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v == null) return v;
    if (typeof v !== "object") return v;
    if (Array.isArray(v)) return v.slice(0, 20).map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = walk(val);
    }
    return out;
  };
  try {
    return clip(JSON.stringify(walk(value) ?? {}));
  } catch {
    return "{}";
  }
}

export async function createMigrationRun(input: {
  shop: string;
  mode?: MigrationMode;
  orderLimit: number;
  createdBy?: string;
  tokens: string[];
}) {
  const tokens = input.tokens.map((t) => String(t || "").trim()).filter(Boolean);
  const run = await prisma.migrationRun.create({
    data: {
      shop: input.shop,
      mode: input.mode || "full",
      orderLimit: input.orderLimit,
      status: "running",
      totalOrders: tokens.length,
      createdBy: String(input.createdBy || "").slice(0, 120),
    },
  });
  const orders = await prisma.$transaction(
    tokens.map((token) =>
      prisma.migrationOrder.create({
        data: {
          runId: run.id,
          shopifyOrderId: token,
          shopifyOrderName: "",
          status: "pending",
        },
      }),
    ),
  );
  return { run, orders };
}

export async function markMigrationOrderRunning(id: string) {
  await prisma.migrationOrder.update({
    where: { id },
    data: { status: "running", startedAt: new Date(), currentStep: "shopify" },
  });
}

export async function appendMigrationStepLog(input: {
  migrationOrderId: string;
  step: PipelineStepResult;
  requestSummary?: unknown;
  responseSummary?: unknown;
}) {
  const error = input.step.ok ? "" : clip(input.step.message);
  await prisma.migrationStepLog.create({
    data: {
      migrationOrderId: input.migrationOrderId,
      step: input.step.step,
      status: input.step.status,
      startedAt: new Date(input.step.startedAt),
      completedAt: new Date(input.step.completedAt),
      durationMs: input.step.durationMs,
      requestSummary: input.requestSummary ? safeLogJson(input.requestSummary) : "",
      responseSummary: input.responseSummary
        ? safeLogJson(input.responseSummary)
        : safeLogJson({ message: input.step.message }),
      error,
      retryCount: 0,
    },
  });
  await prisma.migrationOrder.update({
    where: { id: input.migrationOrderId },
    data: { currentStep: input.step.step },
  });
}

export async function finishMigrationOrder(input: {
  id: string;
  shopifyOrderId?: string;
  shopifyOrderName?: string;
  status: string;
  currentStep: string;
  error?: string;
  isRetry?: boolean;
}) {
  const row = await prisma.migrationOrder.findUnique({ where: { id: input.id } });
  const started = row?.startedAt ? row.startedAt.getTime() : Date.now();
  await prisma.migrationOrder.update({
    where: { id: input.id },
    data: {
      shopifyOrderId: input.shopifyOrderId || row?.shopifyOrderId,
      shopifyOrderName: input.shopifyOrderName || row?.shopifyOrderName || "",
      status: input.status,
      currentStep: input.currentStep,
      completedAt: new Date(),
      durationMs: Math.max(0, Date.now() - started),
      error: clip(input.error || ""),
      ...(input.isRetry
        ? { retryCount: { increment: 1 }, lastRetryAt: new Date() }
        : {}),
    },
  });
}

export async function bumpMigrationRunCounters(runId: string, outcome: "success" | "failed" | "skipped") {
  await prisma.migrationRun.update({
    where: { id: runId },
    data: {
      processedOrders: { increment: 1 },
      ...(outcome === "success" ? { successfulOrders: { increment: 1 } } : {}),
      ...(outcome === "failed" ? { failedOrders: { increment: 1 } } : {}),
      ...(outcome === "skipped" ? { skippedOrders: { increment: 1 } } : {}),
    },
  });
}

export async function finishMigrationRun(runId: string, status: "completed" | "aborted" | "failed") {
  await prisma.migrationRun.update({
    where: { id: runId },
    data: { status, completedAt: new Date() },
  });
}

export async function getMigrationRun(id: string) {
  return prisma.migrationRun.findUnique({
    where: { id },
    include: {
      orders: {
        orderBy: { createdAt: "asc" },
        include: { steps: { orderBy: { startedAt: "asc" } } },
      },
    },
  });
}
