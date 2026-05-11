import type { LoaderFunctionArgs } from "react-router";
import { exportRatesCsv } from "../models/freight.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const csv = await exportRatesCsv(session.shop);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="containerdoor-shipping-rates.csv"',
    },
  });
};
