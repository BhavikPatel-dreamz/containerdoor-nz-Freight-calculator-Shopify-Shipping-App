const ADMIN_API_VERSION = "2025-10";
const DEFAULT_CARRIER_NAME = "ContainerDoor Shipping";

type CarrierServiceRecord = {
  id: number;
  name: string;
};

type CarrierServiceListResponse = {
  carrier_services?: CarrierServiceRecord[];
};

export async function registerOrUpdateCarrierService(shop: string, accessToken: string) {
  const appUrl = normaliseAppUrl(process.env.SHOPIFY_APP_URL || "");
  if (!appUrl) {
    throw new Error("Missing SHOPIFY_APP_URL environment variable");
  }

  const callbackUrl = `${appUrl}/api/shipping-rates?shop=${encodeURIComponent(shop)}`;
  const carrierName = process.env.CARRIER_SERVICE_NAME || DEFAULT_CARRIER_NAME;

  console.log(`Registering/updating carrier service for ${shop} with callback URL ${callbackUrl}`);
  console.log(`Using Shopify API version ${ADMIN_API_VERSION} to register carrier service`);
  console.log(`Shopify app URL: ${carrierName}`);
  

  const existing = await listCarrierServices(shop, accessToken);
  const current = existing.find((service) => service.name === carrierName);

  if (current) {
    await updateCarrierService(shop, accessToken, current.id, carrierName, callbackUrl);
    return { ok: true, action: "updated", carrierServiceId: current.id };
  }

  const created = await createCarrierService(shop, accessToken, carrierName, callbackUrl);
  return { ok: true, action: "created", carrierServiceId: created.id };
}

export async function listCarrierServices(shop: string, accessToken: string) {
  const response = await fetch(
    `https://${shop}/admin/api/${ADMIN_API_VERSION}/carrier_services.json`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to list carrier services (${response.status}): ${body}`);
  }

  const json = (await response.json()) as CarrierServiceListResponse;
  return json.carrier_services ?? [];
}

function normaliseAppUrl(url: string) {
  const trimmed = url.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function createCarrierService(
  shop: string,
  accessToken: string,
  name: string,
  callbackUrl: string,
) {
  const response = await fetch(
    `https://${shop}/admin/api/${ADMIN_API_VERSION}/carrier_services.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        carrier_service: {
          name,
          callback_url: callbackUrl,
          service_discovery: true,
          format: "json",
          active: true,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create carrier service (${response.status}): ${body}`);
  }

  const json = (await response.json()) as {
    carrier_service?: { id: number };
  };

  if (!json.carrier_service?.id) {
    throw new Error("Carrier service create returned no id");
  }

  return json.carrier_service;
}

async function updateCarrierService(
  shop: string,
  accessToken: string,
  carrierServiceId: number,
  name: string,
  callbackUrl: string,
) {
  const response = await fetch(
    `https://${shop}/admin/api/${ADMIN_API_VERSION}/carrier_services/${carrierServiceId}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        carrier_service: {
          id: carrierServiceId,
          name,
          callback_url: callbackUrl,
          service_discovery: true,
          format: "json",
          active: true,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to update carrier service (${response.status}): ${body}`);
  }
}