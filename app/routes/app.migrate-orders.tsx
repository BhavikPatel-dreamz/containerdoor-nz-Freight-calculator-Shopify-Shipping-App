import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authenticate } from "../shopify.server";
import {
  listMigrateReports,
  listShopifyOrdersInDateRange,
  MAX_BULK_DATE_SYNC,
  migrateShopifyOrdersToOms,
  searchShopifyOrders,
} from "../lib/migrate-shopify-oms.server";
import {
  findNextEligibleShopifyOrder,
  processShopifyOrder,
  summarizeSyncSystems,
} from "../lib/process-shopify-order.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const reports = await listMigrateReports(session.shop, 40);
  return { reports };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "search");
  const sentBy = session.shop;
  const mode = String(form.get("mode") || "full") === "dry_run" ? "dry_run" as const : "full" as const;

  if (intent === "sync_one") {
    const selected = String(form.get("orderId") || form.get("order") || "").trim();
    let shopifyOrderId = selected;
    let pickedName = "";
    let skippedHint = "";
    if (!shopifyOrderId) {
      const next = await findNextEligibleShopifyOrder(admin, session.shop);
      if ("error" in next) {
        return {
          intent: "sync_one" as const,
          ok: false,
          message: next.error,
          skippedCompleted: next.skippedCompleted,
          pagesScanned: next.pagesScanned,
        };
      }
      shopifyOrderId = next.orderId;
      pickedName = next.orderName;
      skippedHint = `Skipped ${next.skippedCompleted} already complete (${next.pagesScanned} page(s)).`;
    }
    const one = await processShopifyOrder({
      shop: session.shop,
      admin,
      shopifyOrderId,
      sentBy,
      mode,
    });
    const systems = summarizeSyncSystems(one);
    return {
      intent: "sync_one" as const,
      ok: one.ok,
      mode,
      message: one.ok
        ? `Synced ${one.orderName || pickedName || shopifyOrderId}${skippedHint ? ` ${skippedHint}` : ""}`
        : `Failed ${one.orderName || pickedName || shopifyOrderId}${systems.failedStep ? ` at ${systems.failedStep}` : ""}`,
      results: [one],
      systems,
    };
  }

  if (intent === "search") {
    const q = String(form.get("q") || "").trim();
    if (!q) return { intent: "search" as const, ok: false, message: "Enter an order name, number, or email." };
    const { hits, error, tried } = await searchShopifyOrders(admin, q, session.shop);
    return {
      intent: "search" as const,
      ok: hits.length > 0,
      query: q,
      hits,
      tried,
      message: hits.length
        ? `Found ${hits.length} Shopify order(s). Choose one to migrate.`
        : error
          ? `Search failed: ${error}`
          : "No Shopify orders matched. For old orders use the number only (e.g. 572660). For new orders use #CDL215343.",
    };
  }

  if (intent === "bulk_range") {
    const fromDate = String(form.get("fromDate") || "").trim();
    const toDate = String(form.get("toDate") || "").trim();
    const limit = Math.min(Math.max(Number(form.get("limit")) || 25, 1), MAX_BULK_DATE_SYNC);
    const skipCompleted = form.has("skipCompleted");
    if (mode === "full" && String(form.get("confirmFullRun") || "") !== "1") {
      return {
        intent: "bulk_range" as const,
        ok: false,
        mode,
        needsConfirm: true,
        message: "Full run requires confirmation. This would create/update OMS, Cin7, and Monday records.",
      };
    }
    const listed = await listShopifyOrdersInDateRange(admin, session.shop, {
      fromDate,
      toDate,
      limit,
      skipCompleted,
    });
    if (listed.error && !listed.orders.length) {
      return { intent: "bulk_range" as const, ok: false, message: listed.error, fromDate, toDate };
    }
    if (!listed.orders.length) {
      return {
        intent: "bulk_range" as const,
        ok: true,
        fromDate,
        toDate,
        message: listed.skippedCompleted
          ? `No unsynced orders between ${fromDate} and ${toDate} (skipped ${listed.skippedCompleted} already complete).`
          : `No Shopify orders between ${fromDate} and ${toDate}.`,
        results: [],
      };
    }
    const result = await migrateShopifyOrdersToOms({
      shop: session.shop,
      namesOrIds: listed.orders.map((o) => o.orderId),
      sentBy,
      mode,
    });
    const failed = result.results.filter((r) => !r.ok).length;
    return {
      intent: "bulk_range" as const,
      ok: failed === 0,
      mode,
      fromDate,
      toDate,
      message:
        `Date range ${fromDate} → ${toDate}: ${result.results.length} order(s)` +
        (listed.skippedCompleted ? `, skipped ${listed.skippedCompleted} already complete` : "") +
        (listed.truncated ? `, stopped at limit ${limit}` : "") +
        (failed ? `, ${failed} failed` : mode === "dry_run" ? ", dry run (no writes)" : ", done."),
      ...result,
    };
  }

  const names =
    intent === "bulk"
      ? String(form.get("orders") || "")
          .split(/[\n,]+/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [String(form.get("orderId") || form.get("order") || "").trim()].filter(Boolean);

  if (!names.length) {
    return { intent, ok: false, message: intent === "bulk" ? "Paste at least one order name." : "Choose an order from search first." };
  }

  if (mode === "full" && String(form.get("confirmFullRun") || "") !== "1") {
    return {
      intent,
      ok: false,
      mode,
      needsConfirm: true,
      message: "Full run requires confirmation. This would create/update OMS, Cin7, and Monday records.",
    };
  }

  const result = await migrateShopifyOrdersToOms({ shop: session.shop, namesOrIds: names, sentBy, mode });
  const failed = result.results.filter((r) => !r.ok).length;
  return {
    intent,
    ok: failed === 0,
    mode,
    message:
      failed === 0
        ? mode === "dry_run"
          ? `Dry run finished. ${result.results.length} order(s) previewed. No OMS/Cin7/Monday writes.`
          : `Done. ${result.results.length} order${result.results.length === 1 ? "" : "s"} processed. Report saved.`
        : `Finished with ${failed} failure(s) of ${result.results.length}.`,
    ...result,
  };
};

export default function MigrateOrdersPage() {
  const { reports } = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const hits = data && "hits" in data ? data.hits : [];
  const results = data && "results" in data ? data.results : [];
  const [mode, setMode] = useState<"dry_run" | "full">("full");
  const [allRunning, setAllRunning] = useState(false);
  const [allConfirm, setAllConfirm] = useState(false);
  const [allProgress, setAllProgress] = useState({
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    current: "",
    message: "",
    logs: [] as string[],
    systems: null as null | {
      shopify: string;
      oms: string;
      cin7: string;
      monday: string;
      statusLabel: string;
      failedStep?: string;
      failedMessage?: string;
    },
  });
  const stopAll = useRef(false);

  const mark = (v: string) => (v === "ok" ? "✓" : v === "fail" ? "✗" : "○");

  const runSyncAll = async () => {
    setAllConfirm(false);
    stopAll.current = false;
    setAllRunning(true);
    let after: string | null = null;
    let processed = 0;
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let total = 0;
    const logs: string[] = [];
    try {
      const countRes = await fetch("/api/order-sync-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ countOnly: true }),
      });
      const countJson = await countRes.json().catch(() => ({}));
      total = Number(countJson.total) || 0;
      setAllProgress((p) => ({ ...p, total, message: "Starting from today, newest first…" }));
      while (!stopAll.current) {
        const res = await fetch("/api/order-sync-step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ mode, newestFirst: true, after }),
        });
        const json = await res.json().catch(() => ({}));
        skipped += Number(json.skippedCompleted) || 0;
        if (json.after) after = json.after;
        if (json.done) {
          logs.unshift(new Date().toLocaleTimeString() + " " + (json.message || "All eligible orders finished."));
          setAllProgress({
            processed,
            success,
            failed,
            skipped,
            total,
            current: "",
            message: json.message || "Done.",
            logs: logs.slice(0, 40),
            systems: null,
          });
          break;
        }
        if (json.continueScan) {
          logs.unshift(new Date().toLocaleTimeString() + " Scanning further…");
          setAllProgress((p) => ({ ...p, skipped, message: json.message || "Scanning…", logs: logs.slice(0, 40) }));
          continue;
        }
        if (json.order) {
          processed += 1;
          if (json.order.ok) success += 1;
          else failed += 1;
          const line = `${new Date().toLocaleTimeString()} ${json.order.name || json.order.id} ${json.order.ok ? "OK" : "FAIL"} ${json.systems?.failedStep || ""}`;
          logs.unshift(line);
          setAllProgress({
            processed,
            success,
            failed,
            skipped,
            total,
            current: json.order.name || json.order.id,
            message: json.order.ok ? "Synced" : json.order.error || "Failed",
            logs: logs.slice(0, 40),
            systems: json.systems || null,
          });
          continue;
        }
        logs.unshift(new Date().toLocaleTimeString() + " " + (json.message || json.error || "Stopped"));
        setAllProgress((p) => ({ ...p, message: json.message || json.error || "Stopped", logs: logs.slice(0, 40) }));
        break;
      }
      if (stopAll.current) {
        logs.unshift(new Date().toLocaleTimeString() + " Stopped. Next run continues from remaining unsynced orders.");
        setAllProgress((p) => ({ ...p, message: "Stopped.", logs: logs.slice(0, 40) }));
      }
    } catch (err) {
      setAllProgress((p) => ({
        ...p,
        message: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setAllRunning(false);
    }
  };
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCount, setConfirmCount] = useState(1);
  const pendingForm = useRef<HTMLFormElement | null>(null);

  const onMigrateSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (mode !== "full") return;
    const form = event.currentTarget;
    const flag = form.querySelector<HTMLInputElement>('input[name="confirmFullRun"]');
    if (flag?.value === "1") return;
    event.preventDefault();
    const fd = new FormData(form);
    const bulk = String(fd.get("orders") || "")
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const limit = Number(fd.get("limit") || 0);
    setConfirmCount(bulk.length || limit || 1);
    pendingForm.current = form;
    setConfirmOpen(true);
  };

  const continueFullRun = () => {
    const form = pendingForm.current;
    if (!form) return;
    const flag = form.querySelector<HTMLInputElement>('input[name="confirmFullRun"]');
    if (flag) flag.value = "1";
    setConfirmOpen(false);
    form.requestSubmit();
  };

  useEffect(() => {
    if (nav.state !== "idle") return;
    document.querySelectorAll<HTMLInputElement>('input[name="confirmFullRun"]').forEach((el) => {
      el.value = "";
    });
  }, [nav.state]);

  return (
    <s-page heading="Order Sync">
      <style>{`
        .settings-card { border: 1px solid #dfe4e8; border-radius: 10px; padding: 16px; background: #fff; }
        .settings-field { display: grid; gap: 6px; font-size: 13px; color: #455a64; }
        .settings-field input, .settings-field textarea {
          border: 1px solid #bec5cc; border-radius: 8px; padding: 8px 10px; background: #fff; color: #1f2933;
        }
        .hit-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
        .hit { border: 1px solid #dfe4e8; border-radius: 8px; padding: 10px 12px; display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; }
        .hit strong { display: block; }
        .hit small { color: #52606d; }
        .log { font-family: ui-monospace, monospace; font-size: 12px; background: #f6f8fa; border-radius: 8px; padding: 10px; margin-top: 8px; white-space: pre-wrap; }
        .ok { color: #0f7b3a; }
        .fail { color: #b42318; }
        .pending { color: #9aa5b1; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
        .report-table th, .report-table td { border-bottom: 1px solid #eee; padding: 8px 6px; text-align: left; vertical-align: top; }
        .dry-banner { background: #fff8e1; border: 1px solid #f0c36d; color: #7a4f01; border-radius: 8px; padding: 10px 12px; font-weight: 600; margin: 8px 0 0; }
        .mode-row { display: flex; gap: 16px; font-size: 14px; color: #1f2933; margin-top: 8px; }
        .confirm-mask { position: fixed; inset: 0; background: rgba(15,23,32,.45); display: grid; place-items: center; z-index: 40; }
        .confirm-box { background: #fff; border-radius: 12px; padding: 20px 22px; max-width: 420px; width: calc(100% - 32px); box-shadow: 0 12px 40px rgba(0,0,0,.2); }
        .confirm-box h3 { margin: 0 0 8px; font-size: 16px; }
        .confirm-box p { margin: 0 0 8px; color: #334e68; font-size: 14px; }
        .confirm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
        .sys-row { display: grid; gap: 4px; font-size: 15px; margin-top: 8px; }
        .bar-wrap { height: 12px; background: #e4e7eb; border-radius: 999px; overflow: hidden; margin: 10px 0; }
        .bar-fill { height: 100%; background: #005bd3; transition: width .2s ease; }
      `}</style>

      {mode === "dry_run" ? (
        <div className="dry-banner">DRY RUN — No production changes will be made to OMS, Cin7, or Monday. Shopify load and Cin7/Monday lookups are read-only.</div>
      ) : null}

      <s-section heading="Sync one order">
        <s-paragraph>
          Processes exactly one order through Shopify → OMS → Cin7 → Monday. Sync Next scans oldest-first and skips orders that already completed.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="sync_one" />
          <input type="hidden" name="mode" value={mode} />
          <div className="settings-card" style={{ marginTop: 12 }}>
            <div className="mode-row" style={{ marginBottom: 12 }}>
              <label><input type="radio" name="modeUiNext" checked={mode === "dry_run"} onChange={() => setMode("dry_run")} /> Dry run</label>
              <label><input type="radio" name="modeUiNext" checked={mode === "full"} onChange={() => setMode("full")} /> Full sync</label>
            </div>
            <button type="submit" disabled={busy || allRunning} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #005bd3", background: "#005bd3", color: "#fff", cursor: "pointer" }}>
              {busy ? "Syncing…" : "Sync Next Order"}
            </button>
            <button
              type="button"
              disabled={busy || allRunning}
              onClick={() => (mode === "full" ? setAllConfirm(true) : runSyncAll())}
              style={{ marginLeft: 8, padding: "8px 14px", borderRadius: 8, border: "1px solid #1a1a1a", background: "#1a1a1a", color: "#fff", cursor: "pointer" }}
            >
              Sync all orders
            </button>
          </div>
        </Form>
        {allRunning || allProgress.processed || allProgress.message ? (
          <div className="settings-card" style={{ marginTop: 16 }}>
            <strong>All orders sync</strong>
            <div style={{ color: "#52606d", fontSize: 13, marginTop: 4 }}>
              Newest first (today → oldest). Same process as Sync Order. {allRunning ? "Running…" : allProgress.message}
            </div>
            <div className="bar-wrap">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.min(100, allProgress.total > 0 ? Math.round(((allProgress.processed + allProgress.skipped) / allProgress.total) * 100) : allProgress.processed ? 8 : 0)}%`,
                }}
              />
            </div>
            <div>
              {allProgress.processed} processed
              {allProgress.total ? ` · ~${allProgress.total} Shopify orders` : ""}
              {" "}· ✓ {allProgress.success} · ✗ {allProgress.failed} · skipped {allProgress.skipped}
            </div>
            {allProgress.current ? <div style={{ marginTop: 8 }}>Current: <strong>{allProgress.current}</strong></div> : null}
            {allProgress.systems ? (
              <div className="sys-row">
                <div className={allProgress.systems.shopify === "ok" ? "ok" : allProgress.systems.shopify === "fail" ? "fail" : "pending"}>{mark(allProgress.systems.shopify)} Shopify</div>
                <div className={allProgress.systems.oms === "ok" ? "ok" : allProgress.systems.oms === "fail" ? "fail" : "pending"}>{mark(allProgress.systems.oms)} OMS</div>
                <div className={allProgress.systems.cin7 === "ok" ? "ok" : allProgress.systems.cin7 === "fail" ? "fail" : "pending"}>{mark(allProgress.systems.cin7)} Cin7</div>
                <div className={allProgress.systems.monday === "ok" ? "ok" : allProgress.systems.monday === "fail" ? "fail" : "pending"}>{mark(allProgress.systems.monday)} Monday</div>
                <div>Status: {allProgress.systems.statusLabel}</div>
              </div>
            ) : null}
            {allRunning ? (
              <button type="button" onClick={() => { stopAll.current = true; }} style={{ marginTop: 12, padding: "8px 14px", borderRadius: 8, border: "1px solid #b42318", background: "#fff", color: "#b42318" }}>
                Stop sync
              </button>
            ) : null}
            {allProgress.logs.length ? (
              <div className="log">
                {allProgress.logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <s-paragraph>Or search and sync a specific order:</s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="search" />
          <div className="settings-card" style={{ marginTop: 12 }}>
            <label className="settings-field">
              Search (#CDL215343 or old number 572660)
              <input name="q" type="search" placeholder="#CDL215343 or 572660" defaultValue={data && "query" in data ? data.query : ""} />
            </label>
            <div style={{ marginTop: 16 }}>
              <button type="submit" disabled={busy} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #1a1a1a", background: "#1a1a1a", color: "#fff", cursor: "pointer" }}>
                {busy ? "Searching…" : "Search Shopify"}
              </button>
            </div>
          </div>
        </Form>
        {data?.intent === "search" && data.message ? (
          <s-paragraph>{data.message}</s-paragraph>
        ) : null}

        {hits?.length ? (
          <Form method="post">
            <input type="hidden" name="intent" value="sync_one" />
            <input type="hidden" name="mode" value={mode} />
            <div className="mode-row">
              <label><input type="radio" name="modeUi" checked={mode === "dry_run"} onChange={() => setMode("dry_run")} /> Dry run</label>
              <label><input type="radio" name="modeUi" checked={mode === "full"} onChange={() => setMode("full")} /> Full run</label>
            </div>
            <ul className="hit-list">
              {hits.map((h, i) => (
                <li className="hit" key={h.id}>
                  <input type="radio" name="orderId" value={h.id} defaultChecked={i === 0} />
                  <div>
                    <strong>{h.name}</strong>
                    <small>
                      {h.customer} · {h.email || "no email"} · {h.financialStatus} · {h.lineCount} line(s)
                      {h.skuPreview ? ` · ${h.skuPreview}` : ""}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 12 }}>
              <button type="submit" disabled={busy} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #1a1a1a", background: "#005bd3", color: "#fff", cursor: "pointer" }}>
                {busy ? "Syncing…" : "Sync Order"}
              </button>
            </div>
          </Form>
        ) : null}
      </s-section>

      <s-section heading="Bulk sync by date">
        <s-paragraph>
          Choose a created-at date range. Orders are synced one at a time with the same Shopify → OMS → Cin7 → Monday process. Already-complete orders are skipped.
        </s-paragraph>
        <Form method="post" onSubmit={onMigrateSubmit}>
          <input type="hidden" name="intent" value="bulk_range" />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="confirmFullRun" value="" />
          <div className="settings-card" style={{ marginTop: 12 }}>
            <div className="mode-row" style={{ marginBottom: 12 }}>
              <label><input type="radio" name="modeUiRange" checked={mode === "dry_run"} onChange={() => setMode("dry_run")} /> Dry run</label>
              <label><input type="radio" name="modeUiRange" checked={mode === "full"} onChange={() => setMode("full")} /> Full sync</label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="settings-field">
                From
                <input name="fromDate" type="date" required defaultValue={data && "fromDate" in data ? String(data.fromDate || "") : ""} />
              </label>
              <label className="settings-field">
                To
                <input name="toDate" type="date" required defaultValue={data && "toDate" in data ? String(data.toDate || "") : ""} />
              </label>
            </div>
            <label className="settings-field" style={{ marginTop: 12 }}>
              Max orders this run
              <select name="limit" defaultValue="25" style={{ border: "1px solid #bec5cc", borderRadius: 8, padding: "8px 10px" }}>
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </label>
            <label className="mode-row" style={{ marginTop: 12 }}>
              <input type="checkbox" name="skipCompleted" value="1" defaultChecked />
              Skip orders already synced
            </label>
            <div style={{ marginTop: 16 }}>
              <button type="submit" disabled={busy} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #005bd3", background: "#005bd3", color: "#fff", cursor: "pointer" }}>
                {busy ? "Syncing…" : "Start bulk sync"}
              </button>
            </div>
          </div>
        </Form>
      </s-section>

      {data?.message && data.intent !== "search" ? (
        <s-section heading="Last order">
          <s-paragraph>{data.message}</s-paragraph>
          {data && "mode" in data && data.mode === "dry_run" ? (
            <div className="dry-banner">DRY RUN — No production changes were made to OMS, Cin7, or Monday.</div>
          ) : null}
          {data && "systems" in data && data.systems && results[0] ? (
            <div className="settings-card" style={{ marginTop: 10 }}>
              <strong>Order {results[0].orderName || results[0].input}</strong>
              <div className="sys-row">
                <div className={data.systems.shopify === "ok" ? "ok" : data.systems.shopify === "fail" ? "fail" : "pending"}>
                  {data.systems.shopify === "ok" ? "✓" : data.systems.shopify === "fail" ? "✗" : "○"} Shopify
                </div>
                <div className={data.systems.oms === "ok" ? "ok" : data.systems.oms === "fail" ? "fail" : "pending"}>
                  {data.systems.oms === "ok" ? "✓" : data.systems.oms === "fail" ? "✗" : "○"} OMS
                </div>
                <div className={data.systems.cin7 === "ok" ? "ok" : data.systems.cin7 === "fail" ? "fail" : "pending"}>
                  {data.systems.cin7 === "ok" ? "✓" : data.systems.cin7 === "fail" ? "✗" : "○"} Cin7
                </div>
                <div className={data.systems.monday === "ok" ? "ok" : data.systems.monday === "fail" ? "fail" : "pending"}>
                  {data.systems.monday === "ok" ? "✓" : data.systems.monday === "fail" ? "✗" : "○"} Monday
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                Status: <strong>{data.systems.statusLabel}</strong>
              </div>
              {data.systems.failedStep ? (
                <div className="fail" style={{ marginTop: 6 }}>
                  Failed step: {data.systems.failedStep}
                  {data.systems.failedMessage ? ` — ${data.systems.failedMessage}` : ""}
                </div>
              ) : null}
            </div>
          ) : null}
          {results?.map((r) => (
            <div key={r.input} className="settings-card" style={{ marginTop: 10 }}>
              <strong>{r.orderName || r.input}</strong>
              {r.error ? <div className="fail">{r.error}</div> : null}
              {r.steps?.length ? (
                <div className="log">
                  {r.steps.map((s, idx) => (
                    <div key={idx} className={s.ok ? "ok" : "fail"}>
                      [{s.step}] {s.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </s-section>
      ) : null}

      <s-section heading="Saved reports (re-sync)">
        <s-paragraph>Each order keeps one report. Run migrate again on the same order to refresh Cin7/Monday links.</s-paragraph>
        {reports.length ? (
          <table className="report-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>OMS</th>
                <th>Monday</th>
                <th>Cin7</th>
                <th>Runs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.orderName || r.orderId}</strong>
                    {r.lastError ? <div className="fail">{r.lastError}</div> : null}
                  </td>
                  <td>{r.status}</td>
                  <td>{r.omsAction}</td>
                  <td>{r.mondayAction}</td>
                  <td>{r.cin7Action}</td>
                  <td>{r.runCount}</td>
                  <td>
                    <Form method="post" onSubmit={onMigrateSubmit}>
                      <input type="hidden" name="intent" value="migrate" />
                      <input type="hidden" name="mode" value={mode} />
                      <input type="hidden" name="confirmFullRun" value="" />
                      <input type="hidden" name="orderId" value={r.orderId} />
                      <s-button type="submit" {...(busy ? { loading: true } : {})}>
                        Sync again
                      </s-button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <s-paragraph>No migrate reports yet.</s-paragraph>
        )}
      </s-section>

      {allConfirm ? (
        <div className="confirm-mask" role="dialog" aria-modal="true">
          <div className="confirm-box">
            <h3>Sync all unsynced orders?</h3>
            <p><strong>Mode: FULL SYNC</strong></p>
            <p>Starts from today and walks back to the oldest order, one at a time (Shopify → OMS → Cin7 → Monday).</p>
            <p>Already-complete orders are skipped. You can stop after the current order.</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setAllConfirm(false)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #bec5cc", background: "#fff" }}>Cancel</button>
              <button type="button" onClick={() => void runSyncAll()} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #b42318", background: "#b42318", color: "#fff" }}>Start</button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmOpen ? (
        <div className="confirm-mask" role="dialog" aria-modal="true">
          <div className="confirm-box">
            <h3>You are about to process {confirmCount} order{confirmCount === 1 ? "" : "s"}.</h3>
            <p><strong>Mode: FULL RUN</strong></p>
            <p>This will create/update records in:</p>
            <p>✓ OMS<br />✓ Cin7<br />✓ Monday.com</p>
            <p>Continue?</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setConfirmOpen(false)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #bec5cc", background: "#fff" }}>
                Cancel
              </button>
              <button type="button" onClick={continueFullRun} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #b42318", background: "#b42318", color: "#fff" }}>
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </s-page>
  );
}
