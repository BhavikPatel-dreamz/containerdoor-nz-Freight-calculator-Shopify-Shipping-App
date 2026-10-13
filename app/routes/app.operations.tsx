import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { getAppSettings } from "../models/freight.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [settings, activeRates, inactiveRates] = await Promise.all([
    getAppSettings(session.shop),
    prisma.shippingRate.count({ where: { shop: session.shop, active: true } }),
    prisma.shippingRate.count({ where: { shop: session.shop, active: false } }),
  ]);

  return {
    shop: session.shop,
    activeRates,
    inactiveRates,
    settings: {
      fuelSurchargePercent: settings.fuelSurchargePercent.toString(),
      additionalCostType: settings.additionalCostType,
      additionalCostValue: settings.additionalCostValue.toString(),
      defaultCurrency: settings.defaultCurrency,
    },
  };
};

export default function FreightOrdersPage() {
  const { shop, activeRates, inactiveRates, settings } = useLoaderData<typeof loader>();
  const totalRates = activeRates + inactiveRates;
  const activeRatio = totalRates > 0 ? Math.round((activeRates / totalRates) * 100) : 0;

  return (
    <s-page heading="Operations Summary">
      <style>{`
        .ops-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }
        .ops-card {
          border: 1px solid #d5d9dd;
          border-radius: 12px;
          padding: 14px;
          background: linear-gradient(180deg, #ffffff 0%, #f7f9fa 100%);
        }
        .ops-label {
          margin: 0;
          font-size: 12px;
          color: #4f5d6b;
          letter-spacing: 0.02em;
        }
        .ops-value {
          margin: 6px 0 0;
          font-size: 26px;
          font-weight: 700;
          color: #1f2933;
          line-height: 1.1;
        }
        .action-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 10px;
        }
        .action-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
          border: 1px solid #bec5cc;
          border-radius: 999px;
          padding: 6px 12px;
          color: #22303c;
          background: #fff;
          font-weight: 600;
          font-size: 13px;
        }
      `}</style>

      <s-section heading="Operations summary">
        <div className="ops-grid">
          <article className="ops-card">
            <p className="ops-label">Active rates</p>
            <p className="ops-value">{activeRates}</p>
          </article>
          <article className="ops-card">
            <p className="ops-label">Inactive rates</p>
            <p className="ops-value">{inactiveRates}</p>
          </article>
          <article className="ops-card">
            <p className="ops-label">Coverage health</p>
            <p className="ops-value">{activeRatio}%</p>
          </article>
          <article className="ops-card">
            <p className="ops-label">Checkout currency</p>
            <p className="ops-value">{settings.defaultCurrency}</p>
          </article>
        </div>
      </s-section>

      <s-section heading="Global adjustments">
        <s-stack direction="block" gap="small">
          <s-paragraph>
            Fuel surcharge: {settings.fuelSurchargePercent}% · Additional cost: {settings.additionalCostType.toLowerCase()} {settings.additionalCostValue}
          </s-paragraph>
          <div className="action-row">
            <Link className="action-link" to="/app/settings">
              Open settings
            </Link>
            <Link className="action-link" to="/app/rates">
              Manage rates
            </Link>
          </div>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Store">
        <s-paragraph>{shop}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
