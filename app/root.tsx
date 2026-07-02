import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

const appBaseHref = process.env.SHOPIFY_APP_URL
  ? new URL(process.env.SHOPIFY_APP_URL).origin + "/"
  : process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/`
  : process.env.URL
  ? new URL(process.env.URL).origin + "/"
  : "https://containerdoor-nz-freight-calculator.vercel.app/";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <base href={appBaseHref} />
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
