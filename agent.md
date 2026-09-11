# Order Sync (single + bulk) — agent log

New product direction: **one single-order processor**, reused by Sync Next and Bulk. Not a separate Control Center workflow.

## Current task

**TASK 4 — Shopify Order Selection** (complete). Next: TASK 5 (persistent cursor / last processed position).

## Task 4 — completed

`findNextEligibleShopifyOrder` now scans Shopify **oldest-first** with GraphQL pagination (`pageInfo.endCursor`).

Completed = `OrderMigrateReport.status === success` **or** every operational line has Cin7 + Monday ids. Those orders are skipped so Sync Next does not re-process #1001, #1002, …

Explicit **Sync Order** (search pick) still syncs a chosen order even if complete.

Page size 50, max 20 pages per click (timeout guard). Persisted resume cursor is Task 5 — this task still starts the scan at the oldest order each time, but **skips** completed ones.

### Files changed
- `app/lib/migrate-shopify-oms.server.ts`
- `app/routes/app.migrate-orders.tsx`
- `app/lib/process-shopify-order.server.ts`

### Database
None.

### Validation
Linter not run against live Shopify. Query uses standard `orders(first, after, sortKey: CREATED_AT, reverse: false)` + `pageInfo`.

### Next task
**TASK 5 — Persistent cursor** so the next run does not re-walk skipped pages from Shopify order 1.

---

## Task 3 — completed

`/app/migrate-orders` is **Order Sync**.

- **Sync Next Order** — finds one eligible order on the first Shopify page (oldest `createdAt`, skip already synced) then `processShopifyOrder` once.
- **Sync Order** — search, pick one, same service, still one order.
- Result: Order name + ✓/✗/○ Shopify, OMS, Cin7, Monday + status + failed step/error + step log.
- Does **not** loop. Bulk paste is unchanged and separate.

Temporary next-order helper (replaced in Task 4): first 25 Shopify orders only; no persisted cursor.

### Files changed
- `app/routes/app.migrate-orders.tsx`
- `app/routes/app.tsx` (nav label)
- `app/lib/migrate-shopify-oms.server.ts` (`findNextEligibleShopifyOrder`, `summarizeSyncSystems`)
- `app/lib/process-shopify-order.server.ts` (re-exports)

### Database
None.

### Validation
Linter clean. Could not click Shopify admin in this environment.

### Next task
**TASK 4 — Shopify order selection** (pagination, skip completed, not only first 25).

---

## Task 2 — completed

One public function:

```text
processShopifyOrder({ shop, shopifyOrderId })
```

Import from `app/lib/process-shopify-order.server.ts` (implementation in `migrate-shopify-oms.server.ts`).

Steps: load Shopify (GraphQL / admin node / webhook payload) → `runOrderPipeline` (OMS → Cin7 → Monday, or dry-run reads) → optional `OrderMigrateReport`.

Callers:
- Bulk / migrate page / `POST /api/migrate-shopify-orders` → `migrateShopifyOrdersToOms` → **processShopifyOrder** per token (sequential)
- Admin Sync → same API
- `orders/create` webhook worker → **processShopifyOrder** with payload (`persistReport: false`). OMS failure still fails the job; Cin7/Monday line failures do not (same as before). Webhook step order is now **Cin7 then Monday**, matching the pipeline.

Do not call `ingestShopifyOrderIntoOms` / Cin7 / Monday create from new UI or bulk code.

### Files changed
- `app/lib/process-shopify-order.server.ts` (new re-export)
- `app/lib/migrate-shopify-oms.server.ts` (`processShopifyOrder`)
- `app/lib/order-webhook.server.ts` (worker uses the service)

### Database
None.

### Validation
Wiring only. No live Shopify/Cin7/Monday calls.

### Issues
- No Sync Next / next-eligible picker yet (Task 3–4).
- Bulk still uses a pasted list, not a Shopify cursor.
- HTTP still blocking.

### Next task
**TASK 3 — Single Order Sync Button** (process exactly one order, show step result). No bulk cursor yet.

---

## Task 1 — completed (audit only, no code)


### 1. Shopify order retrieval

| Path | What it does |
|----|----|
| GraphQL search | `searchShopifyOrders` in `app/lib/migrate-shopify-oms.server.ts` — `orders(first: 25, query, sortKey: CREATED_AT)` |
| GraphQL by id | `fetchShopifyOrderById` / `ORDER_BY_ID_QUERY` — full line items + shipping |
| Map | `mapShopifyOrderNode` → REST-shaped `OrderPayload` (same type as webhooks) |
| Staff bypass | Admin block POSTs `shopifyOrder` + `lineItems` so app token GET is not required |
| Webhook | `orders/create` enqueue `ShopifyWebhookJob`; worker uses **webhook payload**, not a fresh GraphQL GET |
| CLI | `scripts/search-shopify-orders.mjs` |

**Gaps:** search is `first: 25` with **no `pageInfo` / cursor**. No “next unprocessed Shopify order” scanner. No persisted Shopify pagination cursor.

### 2. Single-order sync logic (already exists)

Canonical **write** adapters (do not duplicate):

```text
ingestShopifyOrderIntoOms
createCin7EntryForOrder      // per_line default
createMondayEntriesForOrder
```

**Callers today (not one function):**

| Caller | Order of steps |
|----|----|
| Webhook worker `order-webhook.server.ts` | OMS → **Monday → Cin7** |
| `runOrderPipeline` (`migration-pipeline.server.ts`) | Shopify/validate → OMS → **Cin7 → Monday** |
| `migrateOneShopifyOrder` | load Shopify GraphQL → `runOrderPipeline` |
| `migrateShopifyOrdersToOms` | sequential loop over **user-supplied names/ids** |
| Admin **Sync to OMS** | `POST /api/migrate-shopify-orders` → migrate batch of 1 (often with payload) |
| Migrate page `/app/migrate-orders` | search + pick + bulk paste + dry/full confirm |

`runOrderPipeline` is already the closest thing to `processShopifyOrder()`. Bulk migrate calls it per order. **Do not invent a second adapter.** Task 2 should **name/wrap** this as the single service and make webhook/bulk/UI all call it (webhook still Monday-first today — unify to Cin7 then Monday per spec).

Dry run: `runDryOrderPipeline` — OMS simulated; Cin7 GET search; Monday name/SKU search; no POST/`create_item`.

### 3. OMS

`ingestShopifyOrderIntoOms`: `saveOrderSnapshot` → `reindexOrderById` → `createOrderLineItemRecords` → depot backfill → `writeFreightMetafield`.

Operational unit = **line** (A/B/C), not the Shopify order. `getOperationalLines` uses freight shipping code, else Shopify line items (old orders).

### 4. Cin7

`createCin7EntryForOrder` → `createCin7EntriesPerLine` unless `CIN7_SO_STRATEGY=grouped`.

Idempotency: skip if `isLinkedCin7Id(ops.cin7SalesOrderId)`; else `findCin7SalesOrdersForShopifyOrder` + match reference/SKU; POST only if missing. Stores `cin7SalesOrderId` / code / ref on **line** ops. P2002 retries on order-ops upsert.

No Cin7 sandbox.

### 5. Monday

`createMondayEntriesForOrder`: skip if `mondayItemId` already set (rename pulse); else `findMondayItemByName` / `findMondayItemBySkuAndOrderName`; else `createMondayItem`. Pending marker to reduce double-create. Lookup-by-Shopify-order-id was removed (unsafe).

No Monday sandbox.

### 6. Database / mapping

| Table | Role |
|----|----|
| `OrderSnapshot` | Shopify order copy (`shop`+`orderId` unique) |
| `OrderLineItemIndex` | dashboard rows |
| `OrderLineItemOperationalData` | **canonical** `mondayItemId`, `cin7SalesOrderId` per variant |
| `OrderOperationalData` | statuses + **legacy** order-level Cin7 id |
| `OrderMigrateReport` | last migrate outcome per order (upsert) |
| `MigrationRun` / `MigrationOrder` / `MigrationStepLog` | last Control Center batch tracking |
| `CommunicationLog` | OMS activity (not migrate pipeline) |
| `ShopifyWebhookJob` | async create-webhook worker |

**Missing for this spec:** `ShopifySyncState` (cursor, last order id, RUNNING/STOPPED). `MigrationRun` is a **fixed token list**, not “scan Shopify from last position”.

### 7. Sync status

Per order: `OrderMigrateReport.status` (`success` / `partial` / `failed`) + `MigrationOrder.status` + pipeline `steps[]`. Per line: cin7/monday ids. **No store-level “where we left off in Shopify’s order list”.**

Completed OMS presence ≠ Cin7/Monday done. Eligible-for-bulk must combine snapshot + line mappings + report/run status.

### 8. Logs

Pipeline: `MigrationStepLog` (redacted) + migrate page step list. Adapters: `console.log`. Activity UI: `CommunicationLog` only. No live SSE. HTTP migrate is **blocking**.

### 9. Retry / idempotency

- Cin7/Monday **link-or-create** (good for Task 18).
- Re-run migrate upserts `OrderMigrateReport` (`runCount++`).
- Webhook job retries (`ShopifyWebhookJob` attempts).
- No “retry failed order first then continue cursor”.
- Bulk migrate **does not skip** already-successful orders unless the user doesn’t list them.

### 10. Reuse (do not duplicate)

- `mapShopifyOrderNode`, search, fetch-by-id
- `ingestShopifyOrderIntoOms`, `createCin7EntryForOrder`, `createMondayEntriesForOrder`
- `runOrderPipeline` / `runDryOrderPipeline` (wrap as `processShopifyOrder`)
- Line mappings on `OrderLineItemOperationalData`
- `POST /api/migrate-shopify-orders` as the HTTP entry (simplify later)
- Sequential `runOrderPipelineBatch` / migrate `for` loop
- Dry-run semantics already defined

### 11. Must add (later tasks — not this task)

- **One exported** `processShopifyOrder(shopifyOrderId)` used by Sync Next, Bulk, Retry, admin Sync
- **Next eligible order** + Shopify **pagination**
- **Persistent cursor** (`ShopifySyncState`) — resume after stop/crash/refresh
- Simple UI: Sync Next + Bulk (limit, dry/full, confirm, stop) — **not** Control Center complexity
- Server-side bulk job (survives browser close) + lock one bulk per shop
- Unify webhook step order with pipeline (Cin7 then Monday)
- Skip completed on bulk; explicit Sync Again
- Stop after current order; retry failed then continue

### Files inspected (no changes this task except this log)

- `app/lib/migrate-shopify-oms.server.ts`, `migration-pipeline.server.ts`, `order-webhook.server.ts`
- `app/lib/cin7.server.ts` / `cin7-adapter.server.ts`, `monday.server.ts`
- `app/routes/api.migrate-shopify-orders.tsx`, `app.migrate-orders.tsx`
- `extensions/order-status-block` (Sync to OMS)
- `prisma/schema.prisma`

### Validation

Code inspection only. No live Shopify/Cin7/Monday calls.

### Issues (known)

1. Two step orders (webhook Monday-first vs pipeline Cin7-first).
2. No Shopify cursor / next-unprocessed selection.
3. Bulk HTTP is request-scoped; refresh loses UI; process may still be in-flight on that request only.
4. Historical GET can 404 without `read_orders`; staff payload path exists.
5. Previous Control Center tasks (limits, confirm, dry run UI) sit on **paste/search lists**, not sequential Shopify scan.

### Next task

**TASK 2 — Create ONE Single-Order Sync Service** (`processShopifyOrder`). Reuse `runOrderPipeline`. Do not build bulk cursor or new UI yet.

---

# Previous log — Control Center (superseded direction)

The following tasks were for a Migration Control Center. New work uses **simple Order Sync** (single + bulk over one processor). Keep for history.

## Control Center Task 5 — completed

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
