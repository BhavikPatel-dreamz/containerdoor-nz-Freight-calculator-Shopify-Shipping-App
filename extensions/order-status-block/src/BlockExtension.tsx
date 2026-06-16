import { useEffect, useState } from "react";
import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Divider,
  ProgressIndicator,
  Box,
  Button,
  TextField,
  Select,
} from "@shopify/ui-extensions-react/admin";

type LineItemRecord = {
  variantId: string;
  productTitle: string;
  carrier: string;
  customerStatus: string;
  deliveryStatus: string;
  trackingNumber: string;
  eddDate: string;
  dispatchStatus: string;
  warehouseStatus: string;
  supplierContainer: string;
  portArrivalDate: string;
  inTransitDate: string;
  depositPaid: string;
  balanceDue: string;
  notes: string;
};

type ApiResponse = {
  ok: boolean;
  lineItems: LineItemRecord[];
  error?: string;
};

const TARGET = "admin.order-details.block.render";

const CUSTOMER_STATUS_OPTIONS = [
  { value: "", label: "— Select —" },
  { value: "Pending", label: "Pending" },
  { value: "Confirmed", label: "Confirmed" },
  { value: "Dispatched", label: "Dispatched" },
  { value: "Delivered", label: "Delivered" },
  { value: "Cancelled", label: "Cancelled" },
];

const WAREHOUSE_STATUS_OPTIONS = [
  { value: "", label: "— Select —" },
  { value: "Not received", label: "Not received" },
  { value: "Received", label: "Received" },
  { value: "Processing", label: "Processing" },
  { value: "Ready to dispatch", label: "Ready to dispatch" },
  { value: "Dispatched", label: "Dispatched" },
];

const DISPATCH_STATUS_OPTIONS = [
  { value: "", label: "— Select —" },
  { value: "Not dispatched", label: "Not dispatched" },
  { value: "Booked", label: "Booked" },
  { value: "Dispatched", label: "Dispatched" },
  { value: "Failed", label: "Failed" },
];

const DELIVERY_STATUS_OPTIONS = [
  { value: "", label: "— Select —" },
  { value: "Pending", label: "Pending" },
  { value: "In transit", label: "In transit" },
  { value: "Out for delivery", label: "Out for delivery" },
  { value: "Delivered", label: "Delivered" },
  { value: "Failed", label: "Failed" },
];

export default reactExtension(TARGET, () => <FreightStatusBlock />);

function FreightStatusBlock() {
  const api = useApi(TARGET);

  const rawOrderId: string =
    (api as any)?.data?.selected?.[0]?.id ??
    (api as any)?.data?.orderId ??
    (api as any)?.orderId ??
    "";

  const numericOrderId = rawOrderId.replace("gid://shopify/Order/", "");

  const shopDomain: string =
    (api as any)?.data?.shop?.myshopifyDomain ??
    (api as any)?.shop?.myshopifyDomain ??
    (api as any)?.extension?.shop?.myshopifyDomain ??
    (api as any)?.data?.initialState?.shop?.domain ??
    "";

  const appUrl: string =
    (api as any)?.extension?.appUrl ??
    (api as any)?.appUrl ??
    // Use production Vercel deployment by default
    // "https://dd-75.dynamicdreamz.com";
    "https://containerdoor-nz-freight-calculator.vercel.app";

  const [records, setRecords] = useState<LineItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!numericOrderId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const qs = new URLSearchParams({ orderId: numericOrderId });
        if (shopDomain) qs.set("shop", shopDomain);

        const res = await fetch(`${appUrl}/api/order-status?${qs}`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data: ApiResponse = await res.json();

        if (!cancelled) {
          if (data.ok) {
            setRecords(data.lineItems);
          } else {
            setError(data.error ?? "Failed to load");
          }
        }
      } catch (e) {
        if (!cancelled) setError("Unable to load: " + String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [numericOrderId, shopDomain, appUrl]);

  const handleSaved = (variantId: string, updated: Partial<LineItemRecord>) => {
    setRecords((prev) =>
      prev.map((r) => (r.variantId === variantId ? { ...r, ...updated } : r))
    );
  };

  return (
    <AdminBlock title="Freight Status">
      {loading ? (
        <Box padding="base">
          <ProgressIndicator size="small-200" />
        </Box>
      ) : error ? (
        <Text tone="critical">{error}</Text>
      ) : records.length === 0 ? (
        <Text tone="subdued">No freight data saved for this order yet.</Text>
      ) : (
        <BlockStack gap="base">
          {records.map((r, index) => (
            <ItemCard
              key={r.variantId}
              record={r}
              isLast={index === records.length - 1}
              shop={shopDomain}
              orderId={numericOrderId}
              appUrl={appUrl}
              onSaved={(updated) => handleSaved(r.variantId, updated)}
            />
          ))}
        </BlockStack>
      )}
    </AdminBlock>
  );
}

// ─── Read-only table rows ────────────────────────────────────────────────────

function TableRow({ label, value, isLast }: { label: string; value: string; isLast: boolean }) {
  return (
    <Box
      borderColor="border"
      borderInlineStartWidth="025"
      borderInlineEndWidth="025"
      borderBlockStartWidth="025"
      borderBlockEndWidth={isLast ? "025" : "0"}
    >
      <InlineStack blockAlignment="stretch">
        <Box padding="base" minInlineSize="half" borderColor="border" borderInlineEndWidth="025" background="bg-surface-secondary">
          <Text tone="subdued">{label}</Text>
        </Box>
        <Box padding="base" minInlineSize="half">
          <Text>{value || "—"}</Text>
        </Box>
      </InlineStack>
    </Box>
  );
}

function TableHeader() {
  return (
    <Box background="bg-surface-secondary" borderColor="border" borderWidth="025">
      <InlineStack blockAlignment="stretch">
        <Box padding="base" minInlineSize="half" borderColor="border" borderInlineEndWidth="025">
          <Text fontWeight="bold">Field</Text>
        </Box>
        <Box padding="base" minInlineSize="half">
          <Text fontWeight="bold">Value</Text>
        </Box>
      </InlineStack>
    </Box>
  );
}

// ─── Item card with collapse + edit mode ─────────────────────────────────────

type EditableState = {
  customerStatus: string;
  warehouseStatus: string;
  dispatchStatus: string;
  deliveryStatus: string;
  trackingNumber: string;
  eddDate: string;
  portArrivalDate: string;
  inTransitDate: string;
  supplierContainer: string;
  depositPaid: string;
  balanceDue: string;
  notes: string;
};

function recordToFormState(r: LineItemRecord): EditableState {
  return {
    customerStatus: r.customerStatus ?? "",
    warehouseStatus: r.warehouseStatus ?? "",
    dispatchStatus: r.dispatchStatus ?? "",
    deliveryStatus: r.deliveryStatus ?? "",
    trackingNumber: r.trackingNumber ?? "",
    eddDate: r.eddDate ?? "",
    portArrivalDate: r.portArrivalDate ?? "",
    inTransitDate: r.inTransitDate ?? "",
    supplierContainer: r.supplierContainer ?? "",
    depositPaid: r.depositPaid ?? "",
    balanceDue: r.balanceDue ?? "",
    notes: r.notes ?? "",
  };
}

function ItemCard({
  record,
  isLast,
  shop,
  orderId,
  appUrl,
  onSaved,
}: {
  record: LineItemRecord;
  isLast: boolean;
  shop: string;
  orderId: string;
  appUrl: string;
  onSaved: (updated: Partial<LineItemRecord>) => void;
}) {
  const productName = record.productTitle || `Variant #${record.variantId}`;
  const badge = resolveBadge(record.customerStatus, record.deliveryStatus);

  // Collapsed by default — this is the key change to reduce block height
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditableState>(() => recordToFormState(record));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => {
    setForm(recordToFormState(record));
    setSaveError(null);
    setIsExpanded(true);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setSaveError(null);
  };

  const updateField = (field: keyof EditableState) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${appUrl}/api/order-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          orderId,
          variantId: record.variantId,
          data: form,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Save failed");
      onSaved(form);
      setIsEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // ─── Read-only rows ───────────────────────────────────────────────────────
  const dispatchDateLabel =
    record.dispatchStatus === "Dispatched" ? "Dispatched Date" : "Est. Dispatch Date";
  const dispatchDateValue =
    record.dispatchStatus === "Dispatched"
      ? record.inTransitDate || record.eddDate
      : record.eddDate;

  const rows: [string, string][] = ([
    ["Carrier", record.carrier],
    ["Customer Status", record.customerStatus],
    ["Warehouse Status", record.warehouseStatus],
    ["Dispatch Status", record.dispatchStatus],
    ["Delivery Status", record.deliveryStatus],
    ["Tracking #", record.trackingNumber],
    [dispatchDateLabel, dispatchDateValue ? formatDate(dispatchDateValue) : ""],
    ["Port Arrival", record.portArrivalDate ? formatDate(record.portArrivalDate) : ""],
    ["In Transit Date", record.inTransitDate ? formatDate(record.inTransitDate) : ""],
    ["Supplier / Container", record.supplierContainer],
    ["Deposit Paid", record.depositPaid ? `$${record.depositPaid}` : ""],
    ["Balance Due", record.balanceDue ? `$${record.balanceDue}` : ""],
    ["Notes", record.notes],
  ] as [string, string][]).filter(([, v]) => v);

  return (
    <BlockStack gap="tight">

      {/* ── Header row: always visible ── */}
      <InlineStack gap="small" blockAlignment="center" inlineAlignment="space-between">
        {/* Left: name + badge */}
        <InlineStack gap="small" blockAlignment="center">
          <Text fontWeight="bold">{productName}</Text>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </InlineStack>

        {/* Right: action buttons */}
        <InlineStack gap="small">
          {isEditing ? (
            <>
              <Button onClick={cancelEdit}>Cancel</Button>
              <Button onClick={handleSave} variant="primary" loading={saving}>
                Save
              </Button>
            </>
          ) : (
            <>
              <Button onClick={startEdit}>Edit</Button>
              <Button onClick={() => setIsExpanded((v) => !v)}>
                {isExpanded ? "Hide" : "View"}
              </Button>
            </>
          )}
        </InlineStack>
      </InlineStack>

      {saveError ? <Text tone="critical">{saveError}</Text> : null}

      {/* ── Expandable body ── */}
      {isExpanded && (
        isEditing ? (
          <BlockStack gap="base">
            {record.carrier ? (
              <Text tone="subdued">Carrier: {record.carrier}</Text>
            ) : null}

            <InlineStack gap="base" blockAlignment="end">
              <Box minInlineSize="half">
                <Select
                  label="Customer Status"
                  value={form.customerStatus}
                  onChange={updateField("customerStatus")}
                  options={CUSTOMER_STATUS_OPTIONS}
                />
              </Box>
              <Box minInlineSize="half">
                <Select
                  label="Warehouse Status"
                  value={form.warehouseStatus}
                  onChange={updateField("warehouseStatus")}
                  options={WAREHOUSE_STATUS_OPTIONS}
                />
              </Box>
            </InlineStack>

            <InlineStack gap="base" blockAlignment="end">
              <Box minInlineSize="half">
                <Select
                  label="Dispatch Status"
                  value={form.dispatchStatus}
                  onChange={updateField("dispatchStatus")}
                  options={DISPATCH_STATUS_OPTIONS}
                />
              </Box>
              <Box minInlineSize="half">
                <Select
                  label="Delivery Status"
                  value={form.deliveryStatus}
                  onChange={updateField("deliveryStatus")}
                  options={DELIVERY_STATUS_OPTIONS}
                />
              </Box>
            </InlineStack>

            <InlineStack gap="base" blockAlignment="end">
              <Box minInlineSize="half">
                <TextField
                  label="Tracking #"
                  value={form.trackingNumber}
                  onChange={updateField("trackingNumber")}
                  placeholder="e.g. NZ123456789"
                />
              </Box>
              <Box minInlineSize="half">
                <TextField
                  label="EDD (YYYY-MM-DD)"
                  value={form.eddDate}
                  onChange={updateField("eddDate")}
                  placeholder="2026-12-31"
                />
              </Box>
            </InlineStack>

            <InlineStack gap="base" blockAlignment="end">
              <Box minInlineSize="half">
                <TextField
                  label="Port Arrival (YYYY-MM-DD)"
                  value={form.portArrivalDate}
                  onChange={updateField("portArrivalDate")}
                  placeholder="2026-12-31"
                />
              </Box>
              <Box minInlineSize="half">
                <TextField
                  label="In Transit Date (YYYY-MM-DD)"
                  value={form.inTransitDate}
                  onChange={updateField("inTransitDate")}
                  placeholder="2026-12-31"
                />
              </Box>
            </InlineStack>

            <InlineStack gap="base" blockAlignment="end">
              <Box minInlineSize="half">
                <TextField
                  label="Supplier / Container"
                  value={form.supplierContainer}
                  onChange={updateField("supplierContainer")}
                  placeholder="e.g. Supplier / CONT123"
                />
              </Box>
              <Box minInlineSize="half">
                <TextField
                  label="Deposit Paid ($)"
                  value={form.depositPaid}
                  onChange={updateField("depositPaid")}
                  placeholder="0.00"
                />
              </Box>
            </InlineStack>

            <InlineStack gap="base" blockAlignment="end">
              <Box minInlineSize="half">
                <TextField
                  label="Balance Due ($)"
                  value={form.balanceDue}
                  onChange={updateField("balanceDue")}
                  placeholder="0.00"
                />
              </Box>
              <Box minInlineSize="half" />
            </InlineStack>

            <TextField
              label="Notes / internal info"
              value={form.notes}
              onChange={updateField("notes")}
              multiline={3}
              placeholder="Internal notes for this line item..."
            />
          </BlockStack>
        ) : (
          <BlockStack gap="tight">
            <TableHeader />
            {rows.map(([label, value], i) => (
              <TableRow key={label} label={label} value={value} isLast={i === rows.length - 1} />
            ))}
          </BlockStack>
        )
      )}

      {!isLast && (
        <Box paddingBlockStart="tight">
          <Divider />
        </Box>
      )}
    </BlockStack>
  );
}

type Tone = "info" | "success" | "warning" | "critical" | "attention";

function resolveBadge(cs: string, ds: string): { label: string; tone: Tone } {
  const d = ds.toLowerCase();
  const c = cs.toLowerCase();
  if (d === "delivered") return { label: "Delivered", tone: "success" };
  if (d === "out for delivery") return { label: "Out for Delivery", tone: "info" };
  if (d === "in transit") return { label: "In Transit", tone: "info" };
  if (d === "failed") return { label: "Delivery Failed", tone: "critical" };
  if (c === "dispatched") return { label: "Dispatched", tone: "info" };
  if (c === "delivered") return { label: "Delivered", tone: "success" };
  if (c === "cancelled") return { label: "Cancelled", tone: "critical" };
  if (c === "confirmed") return { label: "Confirmed", tone: "attention" };
  return { label: "Pre-Order", tone: "warning" };
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-NZ", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return d; }
}