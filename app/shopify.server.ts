import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { registerOrUpdateCarrierService } from "./lib/carrier-service.server";
import prisma from "./db.server";

function shouldAutoRegisterCarrierService() {
  const value = String(process.env.AUTO_REGISTER_CARRIER_SERVICE || "true").toLowerCase();
  return value !== "false" && value !== "0";
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "https://containerdoor-nz-freight-calculator.vercel.app",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session }) => {
      if (!shouldAutoRegisterCarrierService()) {
        return;
      }

      if (!session.shop || !session.accessToken || session.isOnline) {
        return;
      }

      try {
        const result = await registerOrUpdateCarrierService(session.shop, session.accessToken);
        console.log(
          `Carrier service ${result.action} for ${session.shop} (id=${result.carrierServiceId})`,
        );
      } catch (error) {
        console.error(`Carrier service registration failed for ${session.shop}`, error);
      }
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
