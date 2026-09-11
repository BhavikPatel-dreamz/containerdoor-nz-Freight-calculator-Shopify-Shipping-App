import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authenticate } from "../shopify.server";
import {
  listMigrateReports,
  migrateShopifyOrdersToOms,
  searchShopifyOrders,
} from "../lib/migrate-shopify-oms.server";

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
    setConfirmCount(bulk.length || 1);
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
    <s-page heading="Migrate Shopify → OMS">
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
        .report-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
        .report-table th, .report-table td { border-bottom: 1px solid #eee; padding: 8px 6px; text-align: left; vertical-align: top; }
        .dry-banner { background: #fff8e1; border: 1px solid #f0c36d; color: #7a4f01; border-radius: 8px; padding: 10px 12px; font-weight: 600; margin: 8px 0 0; }
        .mode-row { display: flex; gap: 16px; font-size: 14px; color: #1f2933; margin-top: 8px; }
        .confirm-mask { position: fixed; inset: 0; background: rgba(15,23,32,.45); display: grid; place-items: center; z-index: 40; }
        .confirm-box { background: #fff; border-radius: 12px; padding: 20px 22px; max-width: 420px; width: calc(100% - 32px); box-shadow: 0 12px 40px rgba(0,0,0,.2); }
        .confirm-box h3 { margin: 0 0 8px; font-size: 16px; }
        .confirm-box p { margin: 0 0 8px; color: #334e68; font-size: 14px; }
        .confirm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
      `}</style>

      {mode === "dry_run" ? (
        <div className="dry-banner">DRY RUN — No production changes will be made to OMS, Cin7, or Monday. Shopify load and Cin7/Monday lookups are read-only.</div>
      ) : null}

      <s-section heading="1. Search and choose one order">
        <s-paragraph>
          Search Shopify, pick the order, then migrate. If it is already in OMS we refresh it; if not we add it. Cin7 and Monday are linked when they already exist.
        </s-paragraph>
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
          <Form method="post" onSubmit={onMigrateSubmit}>
            <input type="hidden" name="intent" value="migrate" />
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="confirmFullRun" value="" />
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
                {busy ? "Migrating…" : "Migrate selected order"}
              </button>
            </div>
          </Form>
        ) : null}
      </s-section>

      <s-section heading="2. Bulk (after one order looks right)">
        <Form method="post" onSubmit={onMigrateSubmit}>
          <input type="hidden" name="intent" value="bulk" />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="confirmFullRun" value="" />
          <div className="settings-card" style={{ marginTop: 12 }}>
            <div className="mode-row" style={{ marginBottom: 12 }}>
              <label><input type="radio" name="modeUiBulk" checked={mode === "dry_run"} onChange={() => setMode("dry_run")} /> Dry run</label>
              <label><input type="radio" name="modeUiBulk" checked={mode === "full"} onChange={() => setMode("full")} /> Full run</label>
            </div>
            <label className="settings-field">
              Order names or IDs
              <textarea name="orders" rows={8} placeholder={"#CDL215347\n#CDL215348"} />
            </label>
            <div style={{ marginTop: 16 }}>
              <s-button type="submit" {...(busy ? { loading: true } : {})}>
                Process bulk
              </s-button>
            </div>
          </div>
        </Form>
      </s-section>

      {data?.message ? (
        <s-section heading="This run">
          <s-paragraph>{data.message}</s-paragraph>
          {data && "mode" in data && data.mode === "dry_run" ? (
            <div className="dry-banner">DRY RUN — No production changes were made to OMS, Cin7, or Monday.</div>
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
