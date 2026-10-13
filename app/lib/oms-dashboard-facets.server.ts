import prisma from "../db.server";

type Facets = {
  suppliers: string[];
  warehouseStatuses: string[];
  carriers: string[];
};

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Facets }>();

/** Distinct filter dropdowns — 22k-row DISTINCT every page load is wasted. */
export async function loadOmsDashboardFacets(shop: string): Promise<Facets> {
  const hit = cache.get(shop);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const [supplierRows, warehouseStatusRows, carrierRows] = await Promise.all([
    prisma.$queryRaw<Array<{ vendor: string }>>`
      SELECT DISTINCT idx."vendor" FROM "OrderLineItemIndex" idx
      WHERE idx."shop" = ${shop} AND idx."vendor" <> ''
      ORDER BY idx."vendor" ASC
    `,
    prisma.$queryRaw<Array<{ warehouseStatus: string }>>`
      SELECT DISTINCT lower(ops."warehouseStatus") AS "warehouseStatus"
      FROM "OrderLineItemOperationalData" ops
      WHERE ops."shop" = ${shop} AND ops."warehouseStatus" <> ''
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw<Array<{ company: string }>>`
      SELECT DISTINCT idx."company" FROM "OrderLineItemIndex" idx
      WHERE idx."shop" = ${shop} AND idx."company" <> ''
      ORDER BY idx."company" ASC
    `,
  ]);

  const value: Facets = {
    suppliers: supplierRows.map((r) => r.vendor),
    warehouseStatuses: warehouseStatusRows.map((r) => r.warehouseStatus),
    carriers: carrierRows.map((r) => r.company),
  };
  cache.set(shop, { at: Date.now(), value });
  return value;
}
