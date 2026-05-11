# ContainerDoor Freight Logic

## Variant Metafields

Namespace: `containerdoor_freight`

Required variant-level fields:

- `box_length_cm`
- `box_width_cm`
- `box_height_cm`
- `number_of_boxes`
- `weight_grams`
- `courier_company`
- `hiab_required`
- `units_per_box`

## Rate Record Fields

Each shipping rate row supports:

- company: `FLIWAY | NZP | CASTLE | TGE | M2H | MAINFREIGHT`
- serviceType: `STANDARD_DELIVERY | DEPOT_DELIVERY | CUSTOMER_PICKUP`
- city
- postalCode (single value, `*`, or numeric range like `1000-1999`)
- optional weight range
- optional volume range
- rate (base freight rate used with CBM)
- zoneSurcharge
- mode: `AIR | ROAD` (optional)
- active

## Calculation Formulas

### Standard Delivery (Home Delivery)

`CBM * Freight Rate + Zone Surcharge + Home Delivery Fee`, then:

- add 10% margin
- add 15% GST

Home delivery fee defaults:

- FLIWAY: 45
- TGE: 25

### Depot Delivery

`CBM * Freight Rate`, then:

- add 10% margin
- add 15% GST

Depot is only supported for:

- FLIWAY
- MAINFREIGHT
- TGE

### Global App Settings

After a service subtotal is built for the full cart:

- apply fuel surcharge percent
- apply additional cost (fixed or percent)

## Multi-item Cart Behavior

For each cart item:

1. Resolve dimensions/courier from variant metafields (fallback to line-item properties if present).
2. Calculate required boxes using `number_of_boxes` or `ceil(quantity / units_per_box)`.
3. Calculate package weight and volume.
4. Find matching rates by company + destination + optional weight/volume filters.
5. Select the cheapest matching rate per service type for that package.

For the full cart:

- only show a service when every package has at least one matching rate for that service
- sum package amounts service-wise
- apply global settings once per service total

## Checkout Rate Response

Returned rates include:

- service name/code
- total price (minor units)
- currency
- description with selected couriers and total package count

## Order Sync Hook (Cin7 / Monday)

Webhook route: `/webhooks/orders/create`

When an order is created, the app sends a normalized payload to optional endpoints:

- `CIN7_SYNC_URL` (Bearer token optional: `CIN7_SYNC_TOKEN`)
- `MONDAY_SYNC_URL` (Bearer token optional: `MONDAY_SYNC_TOKEN`)

Freight values are read from line-item properties if present:

- `courier_company`
- `freight_service_type`
- `number_of_boxes`
- `units_per_box`
- `weight_grams`
- `volume_cm3`
- `hiab_required`
- `freight_charge`

## Notes

- Carrier service callbacks can return shipping options but cannot directly persist Shopify line-item properties.
- To guarantee freight data is written at line-item level in the order, set line-item properties before checkout (theme/cart UI) or use an order-edit workflow after checkout.