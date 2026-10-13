-- Dashboard list: facet DISTINCT + tab filters at ~22k line items.
CREATE INDEX IF NOT EXISTS "OrderLineItemIndex_shop_vendor_idx"
  ON "OrderLineItemIndex" ("shop", "vendor");

CREATE INDEX IF NOT EXISTS "OrderLineItemIndex_shop_company_idx"
  ON "OrderLineItemIndex" ("shop", "company");

CREATE INDEX IF NOT EXISTS "OrderLineItemOperationalData_shop_warehouseStatus_idx"
  ON "OrderLineItemOperationalData" ("shop", "warehouseStatus");
