import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <style>{`
        .app-shell {
          width: 100%;
          max-width: none;
          padding: 0 8px 16px;
          box-sizing: border-box;
        }
        .app-shell s-page {
          width: 100%;
          max-width: none;
        }
        .app-shell s-section {
          max-width: none;
        }
      `}</style>
      <s-app-nav>
        <s-link href="/app">Freight Orders</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/rates">Rates</s-link>
        <s-link href="/app/operations">Operations Summary</s-link>
      </s-app-nav>
      <div className="app-shell">
        <Outlet />
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
