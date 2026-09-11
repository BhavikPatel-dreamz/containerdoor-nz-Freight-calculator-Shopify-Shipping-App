import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
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
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "search");
  const sentBy = session.shop;

  if (intent === "search") {
    const q = String(form.get("q") || "").trim();
    if (!q) return { intent: "search" as const, ok: false, message: "Enter an order name, number, or email." };
    const hits = await searchShopifyOrders(session.shop, q);
    return {
      intent: "search" as const,
      ok: true,
      query: q,
      hits,
      message: hits.length ? `Found ${hits.length} Shopify order(s). Choose one to migrate.` : "No Shopify orders matched.",
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

  const result = await migrateShopifyOrdersToOms({ shop: session.shop, namesOrIds: names, sentBy });
  const failed = result.results.filter((r) => !r.ok).length;
  return {
    intent,
    ok: failed === 0,
    message:
      failed === 0
        ? `Done. ${result.results.length} order${result.results.length === 1 ? "" : "s"} processed. Report saved.`
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
      `}</style>

      <s-section heading="1. Search and choose one order">
        <s-paragraph>
          Search Shopify, pick the order, then migrate. If it is already in OMS we refresh it; if not we add it. Cin7 and Monday are linked when they already exist.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="search" />
          <div className="settings-card" style={{ marginTop: 12 }}>
            <label className="settings-field">
              Search (order name, id, email)
              <input name="q" type="search" placeholder="#CDL215347" defaultValue={data && "query" in data ? data.query : ""} />
            </label>
            <div style={{ marginTop: 16 }}>
              <s-button type="submit" {...(busy ? { loading: true } : {})}>
                Search Shopify
              </s-button>
            </div>
          </div>
        </Form>

        {hits?.length ? (
          <Form method="post">
            <input type="hidden" name="intent" value="migrate" />
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
              <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
                Migrate selected order
              </s-button>
            </div>
          </Form>
        ) : null}
      </s-section>

      <s-section heading="2. Bulk (after one order looks right)">
        <Form method="post">
          <input type="hidden" name="intent" value="bulk" />
          <div className="settings-card" style={{ marginTop: 12 }}>
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
                    <Form method="post">
                      <input type="hidden" name="intent" value="migrate" />
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
    </s-page>
  );
}
