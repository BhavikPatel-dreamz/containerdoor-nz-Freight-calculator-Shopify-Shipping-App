const ADMIN_API_VERSION = "2026-07";
const DEFAULT_CARRIER_NAME = "ContainerDoor Shipping";
const REQUEST_TIMEOUT_MS = 20_000;

const DELIVERY_PROFILES_QUERY = `#graphql
query DefaultDeliveryProfiles($first: Int!, $zonesFirst: Int!, $methodsFirst: Int!) {
  deliveryProfiles(first: $first) {
    edges {
      node {
        id
        default
        profileLocationGroups {
          locationGroup {
            id
          }
          locationGroupZones(first: $zonesFirst) {
            edges {
              node {
                zone {
                  id
                }
                methodDefinitions(first: $methodsFirst, type: PARTICIPANT) {
                  edges {
                    node {
                      id
                      name
                      rateProvider {
                        __typename
                        ... on DeliveryParticipant {
                          id
                          carrierService {
                            id
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const ADD_CARRIER_MUTATION = `#graphql
mutation AddCarrierServiceToDefaultProfile($id: ID!, $profile: DeliveryProfileInput!) {
  deliveryProfileUpdate(id: $id, profile: $profile) {
    userErrors {
      field
      message
    }
  }
}`;

type DeliveryProfilesResponse = {
  data?: {
    deliveryProfiles?: {
      edges?: Array<{
        node?: {
          id: string;
          default: boolean;
          profileLocationGroups?: Array<{
            locationGroup?: { id?: string };
            locationGroupZones?: {
              edges?: Array<{
                node?: {
                  zone?: { id?: string };
                  methodDefinitions?: {
                    edges?: Array<{
                      node?: {
                        id?: string;
                        name?: string;
                        rateProvider?: {
                          __typename?: string;
                          carrierService?: { id?: string };
                        };
                      };
                    }>;
                  };
                };
              }>;
            };
          }>;
        };
      }>;
    };
  };
};

type DeliveryProfileUpdateResponse = {
  data?: {
    deliveryProfileUpdate?: {
      userErrors?: Array<{ field?: string | null; message?: string }>;
    };
  };
};

type CarrierServiceRecord = {
  id: number;
  name: string;
};

type CarrierServiceListResponse = {
  carrier_services?: CarrierServiceRecord[];
};

async function fetchWithTimeout(url: string, init: RequestInit): Promise<{
  ok: boolean;
  status: number;
  json: () => unknown;
  text: () => string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      json: () => JSON.parse(body),
      text: () => body,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to Shopify timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

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

  console.log(`[debug] fetching existing carrier services for ${shop}...`);
  const existing = await listCarrierServices(shop, accessToken);
  console.log(`[debug] existing carrier services fetched: ${existing.length} found`);
  const current = existing.find((service) => service.name === carrierName);
  console.log(
    current
      ? `Carrier service already exists for ${shop}, updating id=${current.id}`
      : `Carrier service not found for ${shop}, creating`,
  );

  let carrierServiceId: number;
  if (current) {
    console.log(`[debug] updating carrier service id=${current.id}...`);
    await updateCarrierService(shop, accessToken, current.id, carrierName, callbackUrl);
    carrierServiceId = current.id;
    console.log(`Carrier service updated id=${carrierServiceId}`);
  } else {
    console.log(`[debug] creating carrier service...`);
    const created = await createCarrierService(shop, accessToken, carrierName, callbackUrl);
    carrierServiceId = created.id;
    console.log(`Carrier service created id=${carrierServiceId}`);
  }

  try {
    await ensureCarrierServiceOnDefaultProfile(shop, accessToken, carrierServiceId, carrierName);
  } catch (error) {
    console.error(
      `Failed to add carrier service ${carrierServiceId} to the default shipping profile for ${shop}`,
      error,
    );
  }

  console.log(`[debug] carrier registration flow complete for ${shop} (id=${carrierServiceId})`);
  return { ok: true, action: current ? "updated" : "created", carrierServiceId };
}

export async function listCarrierServices(shop: string, accessToken: string) {
  console.log(`[debug] GET ${ADMIN_API_VERSION}/carrier_services.json for ${shop}`);
  const response = await fetchWithTimeout(
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
    const body = response.text();
    throw new Error(`Failed to list carrier services (${response.status}): ${body}`);
  }

  const json = response.json() as CarrierServiceListResponse;
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
  const response = await fetchWithTimeout(
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
    const body = response.text();
    throw new Error(`Failed to create carrier service (${response.status}): ${body}`);
  }

  const json = response.json() as {
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
  const response = await fetchWithTimeout(
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
    const body = response.text();
    throw new Error(`Failed to update carrier service (${response.status}): ${body}`);
  }
}

async function graphqlRequest<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  console.log(`[debug] GraphQL ${ADMIN_API_VERSION} request for ${shop}`);
  const response = await fetchWithTimeout(
    `https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  let json: unknown;
  try {
    json = response.json();
  } catch {
    throw new Error(`Shopify GraphQL request returned non-JSON response (${response.status}): ${response.text()}`);
  }

  if (!response.ok) {
    throw new Error(`Shopify GraphQL request failed (${response.status}): ${JSON.stringify(json)}`);
  }

  const envelope = json as { errors?: Array<{ message: string }> };
  if (envelope.errors?.length) {
    throw new Error(`Shopify GraphQL request errors: ${envelope.errors.map((e) => e.message).join("; ")}`);
  }

  return json as T;
}

export async function ensureCarrierServiceOnDefaultProfile(
  shop: string,
  accessToken: string,
  carrierServiceId: number,
  carrierName: string,
) {
  const carrierServiceGid = `gid://shopify/DeliveryCarrierService/${carrierServiceId}`;
  console.log(`Checking default shipping profile for carrier service ${carrierServiceId} on ${shop}`);

  const result = await graphqlRequest<DeliveryProfilesResponse>(
    shop,
    accessToken,
    DELIVERY_PROFILES_QUERY,
    { first: 10, zonesFirst: 100, methodsFirst: 50 },
  );
  console.log(`Fetched delivery profiles for ${shop}`);

  const profiles = result.data?.deliveryProfiles?.edges?.map((edge) => edge.node) ?? [];
  const defaultProfile = profiles.find((profile) => profile?.default);
  if (!defaultProfile?.id) {
    console.log(`No default shipping profile found for ${shop}`);
    return;
  }
  console.log(`Default shipping profile id=${defaultProfile.id} for ${shop}`);

  const zonesToAdd: Array<{ locationGroupId: string; zoneId: string }> = [];
  for (const profileGroup of defaultProfile.profileLocationGroups ?? []) {
    const locationGroupId = profileGroup.locationGroup?.id;
    if (!locationGroupId) {
      continue;
    }
    for (const groupZone of profileGroup.locationGroupZones?.edges ?? []) {
      const zoneId = groupZone.node?.zone?.id;
      if (!zoneId) {
        continue;
      }
      const alreadyAdded = (groupZone.node?.methodDefinitions?.edges ?? []).some((edge) => {
        const provider = edge.node?.rateProvider;
        return (
          provider?.__typename === "DeliveryParticipant" && provider.carrierService?.id === carrierServiceGid
        );
      });
      if (!alreadyAdded) {
        zonesToAdd.push({ locationGroupId, zoneId });
      }
    }
  }

  if (zonesToAdd.length === 0) {
    console.log(`Carrier service ${carrierServiceId} already present in the default shipping profile for ${shop}`);
    return;
  }
  console.log(`Adding carrier service ${carrierServiceId} to ${zonesToAdd.length} zone(s) for ${shop}`);

  const mutationResult = await graphqlRequest<DeliveryProfileUpdateResponse>(
    shop,
    accessToken,
    ADD_CARRIER_MUTATION,
    {
      id: defaultProfile.id,
      profile: {
        locationGroupsToUpdate: zonesToAdd.map(({ locationGroupId, zoneId }) => ({
          id: locationGroupId,
          zonesToUpdate: [
            {
              id: zoneId,
              methodDefinitionsToCreate: [
                {
                  name: carrierName,
                  active: true,
                  participant: {
                    carrierServiceId: carrierServiceGid,
                    adaptToNewServices: true,
                  },
                },
              ],
            },
          ],
        })),
      },
    },
  );

  const userErrors = mutationResult.data?.deliveryProfileUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      `Failed to add carrier service to default shipping profile: ${userErrors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  console.log(
    `Added carrier service ${carrierServiceId} to ${zonesToAdd.length} zone(s) of the default shipping profile for ${shop}`,
  );
}