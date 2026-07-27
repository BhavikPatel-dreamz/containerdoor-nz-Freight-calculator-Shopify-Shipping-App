/**
 * Canonical OMS status dropdown values.
 * Keep in sync with extensions/order-status-block BlockExtension.tsx Select options.
 * Exact strings are stored in OrderLineItemOperationalData — do not rename lightly.
 */

export type StatusOption = { value: string; label: string };

export const CUSTOMER_STATUS_OPTIONS: StatusOption[] = [
  { value: "", label: "— Select —" },
  { value: "Pending", label: "Pending" },
  { value: "Confirmed", label: "Confirmed" },
  { value: "Dispatched", label: "Dispatched" },
  { value: "Delivered", label: "Delivered" },
  { value: "Cancelled", label: "Cancelled" },
];

export const WAREHOUSE_STATUS_OPTIONS: StatusOption[] = [
  { value: "", label: "— Select —" },
  { value: "Not received", label: "Not received" },
  { value: "Received", label: "Received" },
  { value: "Processing", label: "Processing" },
  { value: "Ready to dispatch", label: "Ready to dispatch" },
  { value: "Dispatched", label: "Dispatched" },
];

export const DISPATCH_STATUS_OPTIONS: StatusOption[] = [
  { value: "", label: "— Select —" },
  { value: "Not dispatched", label: "Not dispatched" },
  { value: "Booked", label: "Booked" },
  { value: "Dispatched", label: "Dispatched" },
  { value: "Failed", label: "Failed" },
];

export const DELIVERY_STATUS_OPTIONS: StatusOption[] = [
  { value: "", label: "— Select —" },
  { value: "Pending", label: "Pending" },
  { value: "In transit", label: "In transit" },
  { value: "Out for delivery", label: "Out for delivery" },
  { value: "Delivered", label: "Delivered" },
  { value: "Failed", label: "Failed" },
];

export const PAYMENT_STATUS_OPTIONS: StatusOption[] = [
  { value: "", label: "— Select —" },
  { value: "Pending", label: "Pending" },
  { value: "Paid", label: "Paid" },
  { value: "Partial", label: "Partial" },
  { value: "Overdue", label: "Overdue" },
];

/** If stored value is a legacy typo / old label, still show it in the select. */
export function optionsWithCurrent(options: StatusOption[], current: string): StatusOption[] {
  const v = String(current || "").trim();
  if (!v) return options;
  if (options.some((o) => o.value === v)) return options;
  // Case-insensitive match → use canonical option value
  const ci = options.find((o) => o.value.toLowerCase() === v.toLowerCase());
  if (ci) return options;
  return [...options, { value: v, label: `${v} (current)` }];
}

/** Map legacy / mismatched casing to canonical option value when possible. */
export function normalizeStatusValue(options: StatusOption[], raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  const exact = options.find((o) => o.value === v);
  if (exact) return exact.value;
  const ci = options.find((o) => o.value.toLowerCase() === v.toLowerCase());
  if (ci) return ci.value;
  return v;
}
