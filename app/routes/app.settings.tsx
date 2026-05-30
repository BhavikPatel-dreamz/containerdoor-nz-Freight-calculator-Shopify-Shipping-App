import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import {
  costTypeLabels,
  costTypes,
  freightMetafieldNamespace,
  serviceLabels,
  serviceTypes,
  variantFreightMetafields,
} from "../lib/freight";
import { listCarrierServices, registerOrUpdateCarrierService } from "../lib/carrier-service.server";
import prisma from "../db.server";
import { getAppSettings, updateAppSettings } from "../models/freight.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getAppSettings(session.shop);

  return {
    settings: {
      fuelSurchargePercent: settings.fuelSurchargePercent.toString(),
      additionalCostType: settings.additionalCostType,
      additionalCostValue: settings.additionalCostValue.toString(),
      defaultCurrency: settings.defaultCurrency,
      defaultServiceType: settings.defaultServiceType,
      fafFliway: (settings.fafFliway ?? 30.5).toString(),
      fafFliwayMidsize: (settings.fafFliwayMidsize ?? 30.5).toString(),
      fafMainfreight: (settings.fafMainfreight ?? 36.35).toString(),
      fafTge: (settings.fafTge ?? 29.8).toString(),
      fafM2h: (settings.fafM2h ?? 0).toString(),
       tgeAdminFee: (settings.tgeAdminFee ?? 12.69).toString(),
      homeDeliveryFeeFliway: (settings.homeDeliveryFeeFliway ?? 45).toString(),
      homeDeliveryFeeFliwayMidsize: (settings.homeDeliveryFeeFliwayMidsize ?? 45).toString(),
      homeDeliveryFeeTge: (settings.homeDeliveryFeeTge ?? 25).toString(), 
    },
    metafields: variantFreightMetafields,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "save");

  if (intent === "carrier-register") {
    const offlineSession = await prisma.session.findFirst({
      where: { shop: session.shop, isOnline: false },
      orderBy: { id: "asc" },
    });
    const token = offlineSession?.accessToken || session.accessToken;

    if (!token) {
      return { ok: false, message: "No access token found for this shop. Reinstall app and try again." };
    }

    try {
      const result = await registerOrUpdateCarrierService(session.shop, token);
      const services = await listCarrierServices(session.shop, token);
      const names = services.map((service) => service.name).join(", ") || "none";
      return {
        ok: true,
        message: `Carrier service ${result.action}. Active services: ${names}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to register carrier service";
      return { ok: false, message };
    }
  }

  if (intent === "metafields") {
    const results = [];
    for (const field of variantFreightMetafields) {
      const response = await admin.graphql(
        `#graphql
        mutation CreateVariantFreightDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id key namespace }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            definition: {
              name: field.name,
              namespace: freightMetafieldNamespace,
              key: field.key,
              type: field.type,
              ownerType: "PRODUCTVARIANT",
            },
          },
        },
      );
      const json = await response.json();
      results.push(json.data?.metafieldDefinitionCreate?.userErrors?.[0]?.message ?? field.key);
    }

    return { ok: true, message: `Variant metafield setup checked: ${results.join(", ")}` };
  }

  await updateAppSettings(session.shop, formData);
  return { ok: true, message: "Settings saved" };
};

export default function SettingsPage() {
  const { settings, metafields } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <s-page heading="Settings">
      <style>{`
        .settings-card {
          border: 1px solid #d5d9dd;
          border-radius: 12px;
          padding: 20px;
          background: #fff;
        }
        .settings-group {
          margin-bottom: 20px;
        }
        .settings-group:last-of-type {
          margin-bottom: 0;
        }
        .settings-group-title {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #8896a4;
          margin: 0 0 10px 0;
          padding-bottom: 6px;
          border-bottom: 1px solid #edf0f2;
        }
        .settings-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        }
        .settings-field {
          display: grid;
          gap: 5px;
          font-size: 13px;
          color: #455a64;
        }
        .settings-field input,
        .settings-field select {
          width: 100%;
          border: 1px solid #bec5cc;
          border-radius: 8px;
          padding: 8px 10px;
          background: #fff;
          color: #1f2933;
          box-sizing: border-box;
        }
        .meta-list {
          display: grid;
          gap: 8px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .meta-list li {
          border: 1px solid #dfe4e8;
          border-radius: 8px;
          padding: 10px;
          background: #fbfcfd;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .meta-key {
          color: #52606d;
          font-size: 12px;
        }
      `}</style>

      <s-section heading="Shipping defaults">
        {actionData?.message ? (
          <s-banner tone={actionData.ok ? "success" : "critical"}>{actionData.message}</s-banner>
        ) : null}
        <div className="settings-card">
          <Form method="post">

            <div className="settings-group">
              <p className="settings-group-title">Fuel Adjustment Factor (FAF) %</p>
              <div className="settings-grid">
                <label className="settings-field">
                  Fliway Linehaul
                  <input name="fafFliway" type="number" step="0.01" min="0" defaultValue={settings.fafFliway} />
                </label>
                <label className="settings-field">
                  Fliway Midsize
                  <input name="fafFliwayMidsize" type="number" step="0.01" min="0" defaultValue={settings.fafFliwayMidsize} />
                </label>
                <label className="settings-field">
                  Mainfreight
                  <input name="fafMainfreight" type="number" step="0.01" min="0" defaultValue={settings.fafMainfreight} />
                </label>
                <label className="settings-field">
                  TGE
                  <input name="fafTge" type="number" step="0.01" min="0" defaultValue={settings.fafTge} />
                </label>
                <label className="settings-field">
                  M2H
                  <input name="fafM2h" type="number" step="0.01" min="0" defaultValue={settings.fafM2h} />
                </label>
                <label className="settings-field">
                  NZP / Castle <span style={{ fontWeight: 400, color: "#90a4ae" }}>(fuel surcharge fallback)</span>
                  <input name="fuelSurchargePercent" type="number" step="0.01" min="0" defaultValue={settings.fuelSurchargePercent} />
                </label>
              </div>
            </div>

            <div className="settings-group">
              <p className="settings-group-title">Home Delivery Fee ($) — global defaults</p>
              <div className="settings-grid">
                <label className="settings-field">
                  Fliway Linehaul
                  <input name="homeDeliveryFeeFliway" type="number" step="0.01" min="0" defaultValue={settings.homeDeliveryFeeFliway} />
                </label>
                <label className="settings-field">
                  Fliway Midsize
                  <input name="homeDeliveryFeeFliwayMidsize" type="number" step="0.01" min="0" defaultValue={settings.homeDeliveryFeeFliwayMidsize} />
                </label>
                <label className="settings-field">
                  TGE
                  <input name="homeDeliveryFeeTge" type="number" step="0.01" min="0" defaultValue={settings.homeDeliveryFeeTge} />
                </label>
              </div>
            </div>

            <div className="settings-group">
              <p className="settings-group-title">Carrier-specific fees</p>
              <div className="settings-grid">
                <label className="settings-field">
                  TGE admin fee ($)
                  <input name="tgeAdminFee" type="number" step="0.01" min="0" defaultValue={settings.tgeAdminFee} />
                </label>
              </div>
            </div>

            <div className="settings-group">
              <p className="settings-group-title">Additional cost & defaults</p>
              <div className="settings-grid">
                <label className="settings-field">
                  Additional cost type
                  <select name="additionalCostType" defaultValue={settings.additionalCostType}>
                    {costTypes.map((type) => (
                      <option key={type} value={type}>
                        {costTypeLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  Additional cost value
                  <input name="additionalCostValue" type="number" step="0.01" min="0" defaultValue={settings.additionalCostValue} />
                </label>
                <label className="settings-field">
                  Default currency
                  <input name="defaultCurrency" type="text" maxLength={3} defaultValue={settings.defaultCurrency} />
                </label>
                <label className="settings-field">
                  Default service
                  <select name="defaultServiceType" defaultValue={settings.defaultServiceType}>
                    {serviceTypes.map((type) => (
                      <option key={type} value={type}>
                        {serviceLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <s-button type="submit" {...(saving ? { loading: true } : {})}>
                Save settings
              </s-button>
            </div>
          </Form>
        </div>
      </s-section>

      <s-section heading="Variant metafields">
        <div className="settings-card">
          <s-stack direction="block" gap="small">
          <s-paragraph>Namespace: {freightMetafieldNamespace}</s-paragraph>
          <ul className="meta-list">
            {metafields.map((field) => (
              <li key={field.key}>
                <span>{field.name}</span>
                <span className="meta-key">{field.key}</span>
              </li>
            ))}
          </ul>
          <Form method="post">
            <input type="hidden" name="intent" value="metafields" />
            <s-button type="submit">Create variant metafields</s-button>
          </Form>
          </s-stack>
        </div>
      </s-section>

      <s-section heading="Carrier callback registration">
        <div className="settings-card">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              Use this after deploy/reinstall to ensure Shopify calls this app for checkout shipping rates.
            </s-paragraph>
            <Form method="post">
              <input type="hidden" name="intent" value="carrier-register" />
              <s-button type="submit" {...(saving ? { loading: true } : {})}>
                Register carrier service now
              </s-button>
            </Form>
          </s-stack>
        </div>
      </s-section>
    </s-page>
  );
}
