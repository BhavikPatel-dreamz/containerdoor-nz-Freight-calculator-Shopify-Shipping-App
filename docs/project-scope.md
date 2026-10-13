# ContainerDoor Freight Calculator — Project Scope

**App:** `containerdoo-calculator` (Shopify embedded app)
**Client:** ContainerDoor — New Zealand freight / shipping business
**Client ID:** `787d83dca600474d64ea044ad28e4a2d`
**Hosting:** Vercel — `https://containerdoor-nz-freight-calculator.vercel.app`
**Status:** In active development (see [Out of Scope](#out-of-scope) and [Open Follow-ups](#open-follow-ups))

---

## 1. Purpose

ContainerDoor sells products whose variants ship via different carriers at different
rates. A single flat shipping rate does not work. This app computes **per-variant,
per-box freight cost at checkout** using cubic-metre volume (CBM) and weight against
carrier-specific rate tables, then packs the carrier breakdown into the order so it
can be shown to staff and customers after purchase.

### Goals
- Return accurate, per-variant shipping rates during Shopify checkout.
- Let merchants manage carrier rate rows and per-variant box dimensions in the admin.
- Surface the per-variant carrier + box breakdown on the order page (admin + customer).

### Non-goals
- Not a warehouse/inventory system.
- Not a general order-management system (OMS is a separate surface — see references).
- Does not set fixed shipping prices; all pricing is computed dynamically at request time.

---

## 2. Stack

| Layer | Technology |
|-------|------------|
| Framework | React Router 7 (framework mode) — loaders/actions server-side |
| ORM / DB | Prisma — `ShippingRate`, `AppSetting`, sessions |
| Shopify | `@shopify/shopify-app-react-router`, Polaris UI |
| Extensions | `@shopify/ui-extensions` / `-react` (admin + customer-account targets) |
| Packaging | pnpm monorepo — root app + `extensions/*` workspaces |
| Deploy | Vercel (web) + PM2 `ecosystem.config.cjs` for self-host cron |

**Access scopes:** `read_products, write_products, write_shipping, read_shipping, read_orders, write_orders`

---

## 3. Freight Domain Model

### Carriers (`CarrierCompany`)
`FLIWAYLINEHAUL`, `FLIWAYMIDSIZE`, `NZP`, `NZP_AGE_RESTRICTED`, `CASTLE`, `TGE`, `M2H`, `MAINFREIGHT`.

### Service types
`STANDARD_DELIVERY`, `DEPOT_DELIVERY`, `CUSTOMER_PICKUP`.

### Per-variant metafields (`containerdoor_freight`)
`box_length_cm`, `box_width_cm`, `box_height_cm`, `number_of_boxes`, `weight_grams`,
`courier_company`, `hiab_required`, `units_per_box`, `box_dimensions` (JSON).

### Calculation
- Formulas + constants: `app/lib/freight.ts`
- Rate matching (`RateCandidate`, `FreightPackage`): `app/models/freight.server.ts`
- Carrier-specific surcharge formulas for NZP and Castle.
- Base formula: `CBM * freight rate + zone surcharge + home-delivery fee`, then +10% margin, +15% GST.
- Full detail: [docs/freight-logic.md](freight-logic.md).

### service_code encoding (checkout → order)
Freight selection packed into the shipping-line `code`:
```
standard_delivery::TGE,MAINFREIGHT::4boxes::variantId:COMPANYxBoxes|variantId:COMPANYxBoxes|...
```
Parser of record: `app.freight-orders.tsx` `buildFreightOrderRow()`.

---

## 4. In Scope — Deliverables

### 4.1 Checkout rate engine
- Carrier Service callback `app/routes/api.shipping-rates.tsx` returns per-variant rates.
- Auto-registers Carrier Service per shop after OAuth.
- Static test-rate mode via `USE_STATIC_SHIPPING_RATES`.

### 4.2 Admin app (Polaris)
- `app._index.tsx` — home
- `app.rates.tsx` — manage carrier rate rows
- `app.settings.tsx` — app settings
- `app.freight-orders.tsx` — orders list with per-variant carrier + box breakdown

### 4.3 Admin UI extensions
- `box-dimensions-block` — edit per-variant box dimension metafields (`admin.product-variant-details.block.render`).
- `order-freight-block` — per-variant carrier + boxes on the admin order page, read from shipping-line `code`.

### 4.4 Customer-account extensions
- `order-freight-customer` — order-status block.
- `order-freight-customer-page` — full order page (own extension; `*.page.render` cannot combine with other targets).
- Customer-side shipping line exposes only `title`/`handle`/`originalPrice` (no `code`), so the breakdown is read from an **order metafield** `containerdoor_freight.freight_data`, written by the `orders/create` webhook.

### 4.5 Webhooks
- `webhooks.orders.create.tsx` — parses shipping-line `code`, writes `freight_data` order metafield.

---

## 5. Out of Scope

- OMS, Cin7, and Monday integrations (separate project surfaces, tracked in `.cursor/rules/`).
- Historical order backfill (webhook only fires on new orders).
- Live-store / `shopify app dev` end-to-end verification of the new extensions.

---

## 6. Known Constraints / Gotchas

- **pnpm ignores `package.json` `workspaces`** — packages must be listed in `pnpm-workspace.yaml`.
- **Code parser + `companyLabels` duplicated in 3 places** (extensions build in isolation, cannot import `app/`): both order-freight `src/freight.ts` files + the webhook. Keep in sync with `buildFreightOrderRow()`.
- **Scope re-approval:** `write_orders` added for order `metafieldsSet` — merchant must re-approve on next install/deploy.
- **Vercel Hobby cron** cannot run `* * * * *`; email cron disabled in `vercel.json`, runs via PM2 on self-host.

---

## 7. Open Follow-ups

- Customer-account read of the custom-namespace order metafield may need a **metafield definition granting customer-account read access**. Verify on a live order.
- Backfill `freight_data` for existing orders if customer-side display is needed historically.
- Not yet tested against a live store.

---

## 8. References

- `CLAUDE.md` — session context / conventions
- `docs/freight-logic.md` — full calculation logic
- `README.md` — carrier service registration + env vars
- `.cursor/rules/oms-*.mdc` — OMS / Cin7 / activity-log architecture
