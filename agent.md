# Order Migration & Sync Control Center — agent log

## Current task

**TASK 5 — Full Run Mode** (complete). Next: TASK 6 (order limit).

## Task 5 — completed

Full run still uses `runOrderPipeline` (OMS ingest → Cin7 create → Monday create). Dry run stays read-only.

Migrate page (`/app/migrate-orders`):
- Full run is blocked until the user confirms a dialog: order count, **FULL RUN**, OMS / Cin7 / Monday writes, Continue / Cancel.
- Server requires `confirmFullRun=1` when `mode=full`. Missing flag does not write.
- Dry run does not need that confirmation.
- Admin **Sync to OMS** API is unchanged (staff already clicked Sync; still `mode=full` by default).

### Files changed
- `app/routes/app.migrate-orders.tsx`

### Validation
- Confirmation gate is client + server. No live Full Run against Cin7/Monday this task.

### Issues
- HTTP migrate still blocking (no live progress UI).
- Order limit not yet (Task 6).

### Pending
TASK 6 — Order limit (presets + server max).

---

## Task 4 — completed

`mode: "dry_run"` runs `runDryOrderPipeline`:
- Shopify: uses already-loaded order (GET/search only).
- OMS: reads snapshot/ops counts; **no** ingest/write.
- Cin7: `findCin7SalesOrdersForShopifyOrder` GET only; **no** POST.
- Monday: `findMondayItemByName` / SKU search only; **no** `create_item`.
- Does **not** upsert `OrderMigrateReport`.
- Still records `MigrationRun` / step logs (simulated, redacted).

UI: Dry run / Full run radios + yellow **DRY RUN — No production changes will be made** banner.

`POST /api/migrate-shopify-orders` accepts `mode: "dry_run" | "full"`.

### Files changed
- `app/lib/migration-pipeline.server.ts`
- `app/lib/migrate-shopify-oms.server.ts`
- `app/routes/api.migrate-shopify-orders.tsx`
- `app/routes/app.migrate-orders.tsx`

### Validation
- Dry path never calls ingest/create adapters. Full path unchanged.

---

## Task 3 — completed

Prisma models + helpers. Existing `OrderMigrateReport` kept for the current migrate page.


| Table | Role |
|----|---|
| `MigrationRun` | Batch: mode, orderLimit, status, started/completed, counters, createdBy |
| `MigrationOrder` | Shopify id/name, status, currentStep, duration, error, retryCount / lastRetryAt |
| `MigrationStepLog` | Per step: status, duration, redacted request/response summaries, error, retryCount |

`safeLogJson` redacts keys matching token/secret/password/authorization/email/phone/address/access.

`migrateShopifyOrdersToOms` creates a run, one `MigrationOrder` per input token (fixed list), writes step logs from the pipeline, bumps counters, finishes the run. API JSON now includes `runId`.

### Files changed
- `prisma/schema.prisma`
- `prisma/migrations/20260911_migration_run_tracking/migration.sql`
- `app/lib/migration-run.server.ts` (new)
- `app/lib/migration-pipeline.server.ts` (optional `trackingOrderId`)
- `app/lib/migrate-shopify-oms.server.ts`

### Validation
- `prisma generate` succeeded. Apply SQL with `prisma migrate deploy` on the server.

### Issues
- Dry-run still not implemented (Task 4).
- No Control Center UI yet (Task 8).

### Pending
TASK 4 — Dry run mode (simulate writes; real GET/search only).

---

## Task 2 — completed

Reusable state machine in `app/lib/migration-pipeline.server.ts`.

```text
shopify → validate → oms_sync → oms_verify → cin7_sync → cin7_verify
       → monday_sync → monday_verify → completed
```

- One order = one `runOrderPipeline` run.
- Batch helper `runOrderPipelineBatch` is sequential; `critical: true` (missing shop) aborts remaining orders; a normal order failure does not.
- Reuses `ingestShopifyOrderIntoOms`, `createCin7EntryForOrder`, `createMondayEntriesForOrder` — no duplicate adapters.
- `migrateOneShopifyOrder` now loads Shopify then calls `runOrderPipeline` (Cin7 before Monday).
- Downstream: default continues Monday if Cin7 fails (`stopOnDownstreamFailure: false`) so OMS+Monday still update (partial). Spec “stop at Cin7” is the flag `true`.
- `mode: "dry_run"` is typed but rejected until Task 4.

### Files changed
- `app/lib/migration-pipeline.server.ts` (new)
- `app/lib/migrate-shopify-oms.server.ts` (orchestrator delegates to pipeline)

### APIs/services changed
- Existing `POST /api/migrate-shopify-orders` now runs Cin7 then Monday via the pipeline (same adapters).

### Validation
- Module wiring: migrate → pipeline → existing ingest/Cin7/Monday. No live Shopify/Cin7/Monday calls this task.

### Issues
- No Migration Run table yet (Task 3).
- Dry-run not implemented (Task 4).
- Still request-blocking (no worker/SSE).

### Pending
TASK 3 — Migration database tracking (run + order + step logs).

---

## Completed work

Audited Shopify, OMS, Cin7, Monday, and the existing migrate/sync paths. **No new UI or pipeline code in this task.**

OMS is **this app** (Postgres + React Router), not an external OMS API.

---

## Shopify

| Topic | Finding |
|----|---|
| Client | `app/shopify.server.ts` — `@shopify/shopify-app-react-router`, `ApiVersion.October25`, `authenticate` / `unauthenticated.admin(shop)` GraphQL |
| Auth | Offline `Session` in Prisma (`accessToken`). Admin UI extensions can POST a staff-loaded `shopifyOrder` to bypass app-token GET |
| Order retrieval | GraphQL `orders(query:)` + `order(id:)` in `app/lib/migrate-shopify-oms.server.ts`. CLI: `scripts/search-shopify-orders.mjs` (`pnpm oms:search-orders`) |
| IDs | Numeric Shopify id (`7316…`) vs order **name** (`#CDL215343` or old `572651`). Admin URL uses numeric id |
| Pagination | Search uses `first: 25`. No migrate “take N oldest/newest” cursor job yet. `read_all_orders` is in `shopify.app.toml`; installed token historically lacked `read_orders` for old orders |
| Status | `displayFinancialStatus` / REST `financial_status`; fulfilment via snapshot |
| Webhooks | `orders/create` → enqueue `ingestShopifyOrderIntoOms` + Monday/Cin7; `orders/updated`, `orders/paid` → snapshot/index/payments. Config: `shopify.app.toml` |
| Live sync | `app/lib/shopify-sync.server.ts` — EDD/tracking metafields (`containerdoor_ops.*`), not used as migrate create path |
| Admin block | `extensions/order-status-block` — **Sync to OMS** POSTs `/api/migrate-shopify-orders` with `shopifyOrder` + `lineItems` |

**Do not duplicate:** `mapShopifyOrderNode`, `searchShopifyOrders`, `fetchShopifyOrderById`, webhook ingest.

---

## OMS (this application)

| Topic | Finding |
|----|---|
| Service | `ingestShopifyOrderIntoOms` in `app/lib/order-webhook.server.ts` |
| Writes | `saveOrderSnapshot` → `reindexOrderById` (`OrderLineItemIndex`) → `createOrderLineItemRecords` (`OrderLineItemOperationalData`) → depot backfill → freight metafield |
| Mapping | Operational unit = **line item** (letter A/B/C), not the Shopify order |
| Auth | Shopify admin session or `CRON_SECRET` / session-token JWT dest |
| Errors | Snapshot unique races swallowed; index used to require freight `shippingCode` (old orders had empty index / detail 404 — fallback to `lineItemsJson` added recently) |
| Dashboard | `/app` lists **only** `OrderLineItemIndex`. Detail `/app/order/:lineIndexId` |

Tables: `OrderSnapshot`, `OrderOperationalData`, `OrderLineItemOperationalData`, `OrderLineItemIndex`.

---

## Cin7

| Topic | Finding |
|----|---|
| Client | `app/lib/cin7.server.ts` — REST Omni `POST/GET/PUT /v1/SalesOrders` |
| Auth | Basic `CIN7_USERNAME` + `CIN7_SYNC_TOKEN`; URL `CIN7_SYNC_URL` or `CIN7_BASE_URL` |
| Mapping | Adapter `app/lib/cin7-adapter.server.ts`. Default `CIN7_SO_STRATEGY=per_line` (one SO per line, `reference` = `#OrderLetter`, `customerOrderNo` = Shopify name). Canonical id: `OrderLineItemOperationalData.cin7SalesOrderId` |
| Link-or-create | `findCin7SalesOrdersForShopifyOrder` + `pickCin7MatchForLine` then `createCin7SalesOrder` |
| Create entry | `createCin7EntryForOrder` (webhook + migrate) |
| Other APIs | `api.cin7-create`, `api.cin7-update`, `api.cin7-status`; `sync-middleware` |
| Errors | Duplicate → link; no SKU → skip; failures increment `failed` (migrate now appends `errors[]`) |
| Dry-run | **None.** Create/update are real writes. GET search is read-only |

---

## Monday.com

| Topic | Finding |
|----|---|
| Client | `app/lib/monday.server.ts` — GraphQL `https://api.monday.com/v2`, `API-Version: 2024-01` |
| Auth | `MONDAY_API_TOKEN`; board `MONDAY_BOARD_ID`; optional `MONDAY_GROUP_ID`, `MONDAY_BOARD_LINK` |
| Mapping | Pulse **name** = `#OrderName` + letter (`buildMondayPulseName`). Columns via `FIELD_DEFS` / `buildMondayRowFromOms` / `buildColumnValues`. Shopify **orderId is not a Monday column** |
| Create/update | `createMondayItem`, `updateMondayItem`, `renameMondayItem`, `createMondayUpdate` |
| Link-or-create | `findMondayItemByName`, `findMondayItemBySkuAndOrderName`. **Do not** search `items_page_by_column_values` by Shopify order id (missing `column_id` → BAD_USER_INPUT) |
| Create entry | `createMondayEntriesForOrder` |
| Other | `api.monday-sync`, `api.monday-status`, `api.monday-webhook`, `api.order-status` |
| Errors | Invalid status labels fail whole `change_multiple_column_values`; complexity budget retry |
| Dry-run | **None.** Create/update are real writes. Item search is read-only |

---

## Existing migration / jobs (reuse these)

| Piece | Location | Notes |
|----|---|---|
| Orchestrator | `migrateShopifyOrdersToOms` / `migrateOneShopifyOrder` | **Already sequential** over `namesOrIds`. Flow: search Shopify → validate lines → `ingestShopifyOrderIntoOms` → `createMondayEntriesForOrder` → `createCin7EntryForOrder` |
| API | `POST /api/migrate-shopify-orders` | Body: `shop`, `orders[]` / `order`, optional `shopifyOrder` + `lineItems` |
| UI (basic) | `app/routes/app.migrate-orders.tsx` | Search one / bulk paste / reports list / sync again. **Replace later (Task 8), do not fork a second migrate engine** |
| Per-order DB | `OrderMigrateReport` | Unique `(shop, orderId)`. `status`, `omsAction`, `mondayAction`, `cin7Action`, `stepsJson`, `linesJson`, `runCount`. **No Migration Run / batch / dry-run / duration / currentStep columns** |
| New-order path | `enqueueOrderWebhookJob` + `processQueuedOrderWebhookJobs` | Same ingest + Cin7/Monday. Cron: `scripts/order-webhook-cron.mjs` / Docker `webhook-cron` |
| Email queue | `BulkEmailJob` + `/api/bulk-notify/process` | Unrelated to order migrate |
| Bulk OMS | `app/lib/bulk-actions.server.ts` | Field updates, not Shopify historical ingest |
| Retry | Re-POST same order; report `runCount++`. No job worker, no dry-run, no order-limit, no live SSE |

**Pipeline today (one request, blocking):**

```text
Shopify load/validate → OMS ingest → Monday link/create → Cin7 link/create → OrderMigrateReport
```

Failures on Monday/Cin7 still leave OMS rows (partial). One order failure does not stop the rest of `namesOrIds`.

---

## Files inspected (no changes this task)

- `app/shopify.server.ts`, `shopify.app.toml`
- `app/lib/migrate-shopify-oms.server.ts`, `app/routes/api.migrate-shopify-orders.tsx`, `app/routes/app.migrate-orders.tsx`
- `app/lib/order-webhook.server.ts`, `app/lib/line-index.server.ts`, `app/lib/freight-orders.server.ts`
- `app/lib/cin7.server.ts`, `app/lib/cin7-adapter.server.ts`
- `app/lib/monday.server.ts`
- `prisma/schema.prisma` (`OrderMigrateReport` + OMS tables)
- `extensions/order-status-block`, webhooks under `app/routes/webhooks.orders.*`
- `ecosystem.config.cjs`, Docker crons

## APIs/services changed

None (audit only).

## Validation performed

Code inspection of migrate, webhook, Cin7, Monday, Prisma. No live API calls this task.

## Issues (known, for later tasks)

1. No **migration run** entity (batch of N orders, mode, progress).
2. No **dry-run**; Cin7/Monday have no sandbox in this codebase — dry-run must simulate writes and only use GET/search for real reads.
3. App token may still miss historical orders; staff/admin payload path exists.
4. Old orders: no freight code → dashboard/detail historically 404/empty (line-item fallback recently added).
5. Migrate HTTP is **synchronous**; Control Center live logs will need polling or a job table, not a second copy of Cin7/Monday create.
6. Monday lookup-by-order-id is unsafe; name/SKU only.

## Pending work

TASK 4 — Dry run mode.

## Next task

**TASK 4 — Dry Run Mode**
