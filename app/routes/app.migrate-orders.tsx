import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { migrateShopifyOrdersToOms } from "../lib/migrate-shopify-oms.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "one");
  const one = String(form.get("order") || "").trim();
  const bulk = String(form.get("orders") || "");
  const names =
    intent === "bulk"
      ? bulk
          .split(/[\n,]+/)
          .map((x) => x.trim())
          .filter(Boolean)
      : one
        ? [one]
        : [];

  if (!names.length) {
    return { ok: false, message: intent === "bulk" ? "Paste at least one order name." : "Enter one Shopify order name." };
  }

  const result = await migrateShopifyOrdersToOms({ shop: session.shop, namesOrIds: names });
  const failed = result.results.filter((r) => !r.ok).length;
  return {
    ok: failed === 0,
    message:
      failed === 0
        ? `Done. ${result.results.length} order${result.results.length === 1 ? "" : "s"} processed.`
        : `Finished with ${failed} failure(s) of ${result.results.length}.`,
    ...result,
  };
};

function statsLine(label: string, s?: { created: number; linked: number; skipped: number; failed: number }) {
  if (!s) return null;
  return `${label}: linked ${s.linked}, created ${s.created}, skipped ${s.skipped}, failed ${s.failed}`;
}

export default function MigrateOrdersPage() {
  const data = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <s-page heading="Migrate Shopify → OMS">
      <style>{`
        .settings-card { border: 1px solid #dfe4e8; border-radius: 10px; padding: 16px; background: #fff; }
        .settings-field { display: grid; gap: 6px; font-size: 13px; color: #455a64; }
        .settings-field input, .settings-field textarea {
          border: 1px solid #bec5cc; border-radius: 8px; padding: 8px 10px; background: #fff; color: #1f2933;
        }
        .migrate-result { margin: 8px 0 0; padding-left: 18px; }
        .migrate-result li { margin-bottom: 8px; }
      `}</style>
      <s-section heading="1. Try one order first">
        <s-paragraph>
          Enter a Shopify order name (for example #CDL215347). OMS is created, then Cin7 and Monday are linked if they already exist, or created if they do not.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="one" />
          <div className="settings-card" style={{ marginTop: 12 }}>
            <label className="settings-field">
              Order name or ID
              <input name="order" type="text" placeholder="#CDL215347" defaultValue="" autoComplete="off" />
            </label>
            <div style={{ marginTop: 16 }}>
              <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
                Migrate this order
              </s-button>
            </div>
          </div>
        </Form>
      </s-section>

      <s-section heading="2. Then bulk">
        <s-paragraph>One order name per line (or comma-separated). Same link-or-create rules as the single order.</s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="bulk" />
          <div className="settings-card" style={{ marginTop: 12 }}>
            <label className="settings-field">
              Order names
              <textarea name="orders" rows={10} placeholder={"#CDL215347\n#CDL215348\n#CDL215349"} />
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
        <s-section heading="Result">
          <s-paragraph>{data.message}</s-paragraph>
          {data.results?.length ? (
            <ul className="migrate-result">
              {data.results.map((r) => (
                <li key={r.input}>
                  <strong>{r.orderName || r.input}</strong>
                  {r.ok ? (
                    <>
                      {" — OMS ok"}
                      {r.monday ? ` · ${statsLine("Monday", r.monday)}` : ""}
                      {r.cin7 ? ` · ${statsLine("Cin7", r.cin7)}` : ""}
                    </>
                  ) : (
                    <> — failed: {r.error}</>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </s-section>
      ) : null}
    </s-page>
  );
}
