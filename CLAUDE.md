# CLAUDE.md

Project context for Claude Code. Read this first — it saves re-discovering the codebase each session.

## What this app is

Shopify app **containerdoo-calculator** for **ContainerDoor**, a New Zealand freight/shipping business. It calculates per-variant freight cost at checkout. Different product variants ship via different carriers at different rates, so freight is computed **per variant / per box** using CBM (cubic-metre volume) + weight against carrier rate tables.

- Client ID: `787d83dca600474d64ea044ad28e4a2d`
- Hosted on Vercel: `https://containerdoor-nz-freight-calculator.vercel.app`
- Embedded admin app.

## Stack

- **React Router 7** (framework mode) — routes in `app/routes/`, loaders/actions server-side.
- **Prisma** — `prisma/schema.prisma`, client via `app/db.server.ts`. Stores `ShippingRate`, `AppSetting`, sessions.
- **Shopify App** — `@shopify/shopify-app-react-router`, auth via `app/shopify.server.ts`. Polaris UI.
- **pnpm monorepo** — root app + `extensions/*` as workspaces.
- Dev: `cloudflared tunnel run <name> & shopify app dev --tunnel-url=...` (see `package.json` `dev` script).

### pnpm workspace gotcha (IMPORTANT)
pnpm **ignores** the `workspaces` field in `package.json`. Workspace packages must be listed in `pnpm-workspace.yaml` under `packages:`. If extension deps (e.g. `@shopify/ui-extensions-react`) fail to resolve during `shopify app dev` build, check that `pnpm-workspace.yaml` has:
```yaml
packages:
  - 'extensions/*'
```
Then run `pnpm install`. (This was the cause of the `Could not resolve "@shopify/ui-extensions-react/admin"` error.)

## Access scopes
`read_products,write_products,write_shipping,read_shipping,read_orders` (in `shopify.app.toml`). Add `read_orders`/`read_all_orders` etc. there if a new feature needs more.

## Freight domain model

### Carriers (`CarrierCompany` enum, see `app/lib/freight.ts`)
`FLIWAYLINEHAUL`, `FLIWAYMIDSIZE`, `NZP`, `NZP_AGE_RESTRICTED`, `CASTLE`, `TGE`, `M2H`, `MAINFREIGHT`. Human labels in `companyLabels`.

### Service types
`STANDARD_DELIVERY`, `DEPOT_DELIVERY`, `CUSTOMER_PICKUP`.

### Per-variant metafields — namespace `containerdoor_freight`
Defined in `variantFreightMetafields` (`app/lib/freight.ts`):
`box_length_cm`, `box_width_cm`, `box_height_cm`, `number_of_boxes`, `weight_grams`, `courier_company` (list, one of the carriers), `hiab_required`, `units_per_box`, `box_dimensions` (JSON).

### Calculation
`app/lib/freight.ts` (formulas, constants) + `app/models/freight.server.ts` (rate matching: `RateCandidate`, `FreightPackage`). NZP and Castle have carrier-specific surcharge formulas (`freightFormula`).

## Key files / routes

| Path | Purpose |
|------|---------|
| `app/routes/api.shipping-rates.tsx` | Carrier Service callback — returns checkout shipping rates |
| `app/routes/app._index.tsx` | App home |
| `app/routes/app.rates.tsx` | Manage carrier rate rows |
| `app/routes/app.settings.tsx` | App settings |
| `app/routes/app.freight-orders.tsx` | **Admin page** listing orders with per-variant carrier + box breakdown |
| `app/routes/webhooks.orders.create.tsx` | Order create webhook |
| `app/lib/freight.ts` | Carrier lists, labels, metafield defs, formulas, parse helpers |
| `app/models/freight.server.ts` | Rate matching + freight calc |
| `extensions/box-dimensions-block/` | Admin UI extension: edit box-dimension metafields on a variant |

### service_code encoding (checkout → order)
Freight selection is packed into the shipping line `code`:
```
standard_delivery::TGE,MAINFREIGHT::4boxes::variantId:COMPANYxBoxes|variantId:COMPANYxBoxes|...
```
Prefixes: `standard_delivery::`, `depot_delivery::`, `customer_pickup::`. `app.freight-orders.tsx` `buildFreightOrderRow()` parses this — reuse that parser for any order-display feature.

## Extensions

### Existing: `box-dimensions-block`
- Type `ui_extension`, target `admin.product-variant-details.block.render`.
- Lets merchant set box L/W/H + weight metafields per variant.
- Deps pinned to `@shopify/ui-extensions` + `@shopify/ui-extensions-react` `2025.7.3`.

## Order-page freight extensions (built)

Two extensions show freight info per variant on the order page:

### `extensions/order-freight-block` — ADMIN
- Target `admin.order-details.block.render`, `@shopify/ui-extensions-react/admin`, API `2025-07`.
- Reads `order.shippingLines.nodes[].code` directly via the authenticated `api.query()` hook, parses with `src/freight.ts` `parseFreightCode()`, displays per-variant carrier + boxes.
- Merchant must manually add the block to the order page (Shopify UI extensions aren't auto-placed).

### `extensions/order-freight-customer` — CUSTOMER ACCOUNT (order status block)
- Target `customer-account.order-status.block.render`, `@shopify/ui-extensions-react/customer-account`, API `2025-07`.

### `extensions/order-freight-customer-page` — CUSTOMER ACCOUNT (full order page)
- Target `customer-account.order.page.render`. **Gotcha:** the full-page `*.page.render` target "cannot be combined with any other targets" — it must live in its own extension. Shares the same `OrderFreight.tsx`/`freight.ts` (copied, not imported — separate builds).

Both customer extensions:
- **Key constraint:** the customer-account `ShippingLine` object exposes ONLY `title`/`handle`/`originalPrice` — **NOT `code`**. So the freight breakdown can't be read customer-side from the shipping line.
- **Workaround:** the `orders/create` webhook (`app/routes/webhooks.orders.create.tsx` → `writeFreightMetafield`) parses the shipping-line `code` and writes a JSON **order metafield** `containerdoor_freight.freight_data`. The customer extension reads that metafield via the Customer Account GraphQL API (`shopify://customer-account/api/2025-07/graphql.json`).

### Supporting changes
- `shopify.app.toml`: added `orders/create` webhook subscription + `write_orders` scope (needed for `metafieldsSet` on an order). **Merchant must re-approve the updated scope** on next install/deploy.
- The `code` parser + `companyLabels` are **duplicated** in three places (extensions build in isolation, can't import `app/`): `extensions/order-freight-block/src/freight.ts`, `extensions/order-freight-customer/src/freight.ts`, and the webhook. Keep them in sync with `app/routes/app.freight-orders.tsx` `buildFreightOrderRow()`.

### Open follow-ups
- Customer Account API reading a custom-namespace order metafield may require a **metafield definition granting customer-account read access**. The extension declares `[[extensions.metafields]]` in its toml; verify the metafield is actually readable on a live order (if not, create a metafield definition with `MetafieldAccess` for customer account).
- Existing orders won't have the metafield (webhook only fires on new orders) — backfill via a script if historical orders need it customer-side.
- Not yet tested against a live store / `shopify app dev`.

## Conventions
- Caveman mode active in chat (terse). Code, commits, docs = normal English.
- Commit/PR only when asked. Branch off `main`.
- en-NZ formatting / NZD currency for customer-facing freight display.
