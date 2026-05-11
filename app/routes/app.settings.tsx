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
    },
    metafields: variantFreightMetafields,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "save");

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
              access: { admin: "MERCHANT_READ_WRITE" },
            },
          },
        },
      );
      const json = await response.json();
      results.push(json.data?.metafieldDefinitionCreate?.userErrors?.[0]?.message ?? field.key);
    }

    return { message: `Variant metafield setup checked: ${results.join(", ")}` };
  }

  await updateAppSettings(session.shop, formData);
  return { message: "Settings saved" };
};

export default function SettingsPage() {
  const { settings, metafields } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <s-page heading="Settings">
      <s-section heading="Shipping defaults">
        {actionData?.message ? <s-banner tone="success">{actionData.message}</s-banner> : null}
        <Form method="post">
          <s-stack direction="block" gap="base">
            <label>
              Fuel surcharge percentage
              <input name="fuelSurchargePercent" type="number" step="0.01" min="0" defaultValue={settings.fuelSurchargePercent} />
            </label>
            <label>
              Additional cost type
              <select name="additionalCostType" defaultValue={settings.additionalCostType}>
                {costTypes.map((type) => (
                  <option key={type} value={type}>
                    {costTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Additional cost value
              <input name="additionalCostValue" type="number" step="0.01" min="0" defaultValue={settings.additionalCostValue} />
            </label>
            <label>
              Default currency
              <input name="defaultCurrency" type="text" maxLength={3} defaultValue={settings.defaultCurrency} />
            </label>
            <label>
              Default service
              <select name="defaultServiceType" defaultValue={settings.defaultServiceType}>
                {serviceTypes.map((type) => (
                  <option key={type} value={type}>
                    {serviceLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <s-button type="submit" {...(saving ? { loading: true } : {})}>
              Save settings
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Variant metafields">
        <s-stack direction="block" gap="small">
          <s-paragraph>Namespace: {freightMetafieldNamespace}</s-paragraph>
          <s-unordered-list>
            {metafields.map((field) => (
              <s-list-item key={field.key}>
                {field.name} · {field.key}
              </s-list-item>
            ))}
          </s-unordered-list>
          <Form method="post">
            <input type="hidden" name="intent" value="metafields" />
            <s-button type="submit">Create variant metafields</s-button>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}
