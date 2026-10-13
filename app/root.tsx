import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return {
    origin: new URL(request.url).origin,
    shopifyAppUrl: process.env.SHOPIFY_APP_URL,
  };
}

export default function App() {
  const { origin, shopifyAppUrl } = useLoaderData() as {
    origin: string;
    shopifyAppUrl?: string;
  };
  const baseHref = shopifyAppUrl || origin;

  return (
    <html lang="en">
      <head>
        <base href={`${baseHref}/`} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
