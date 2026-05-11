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

export default function Index() {
  const { shop, activeRates, inactiveRates, settings } = useLoaderData<typeof loader>();

  return (
    <s-page heading="ContainerDoor freight">
      <s-section heading="Operations summary">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>{activeRates}</s-heading>
            <s-paragraph>Active rates</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>{inactiveRates}</s-heading>
            <s-paragraph>Inactive rates</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>{settings.defaultCurrency}</s-heading>
            <s-paragraph>Checkout currency</s-paragraph>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Global adjustments">
        <s-stack direction="block" gap="small">
          <s-paragraph>
            Fuel surcharge: {settings.fuelSurchargePercent}% · Additional cost:{" "}
            {settings.additionalCostType.toLowerCase()} {settings.additionalCostValue}
          </s-paragraph>
          <s-stack direction="inline" gap="small">
            <Link to="/app/settings">Settings</Link>
            <Link to="/app/rates">Rate management</Link>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Store">
        <s-paragraph>{shop}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
