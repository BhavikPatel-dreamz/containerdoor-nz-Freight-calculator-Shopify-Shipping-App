/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import {
  reactExtension,
  useApi,
  BlockStack,
  InlineStack,
  Box,
  Button,
  Select,
  Text,
  TextArea,
  TextField,
} from "@shopify/ui-extensions-react/admin";

type LineItemRecord = {
  variantId: string;
  productTitle: string;
  carrier: string;
  customerStatus: string;
  deliveryStatus: string;
  trackingNumber: string;
  freightRef: string;
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

type FormState = Omit<LineItemRecord, "variantId" | "productTitle">;

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

function stripGid(value: string, resource: "Order" | "ProductVariant") {
  return String(value || "").replace(`gid://shopify/${resource}/`, "").trim();
}

function resolveAppBaseUrl(api: any): string {
  const fromApi = api?.extension?.appUrl || api?.appUrl || "";
  const fromEnv =
    (typeof process !== "undefined" && (process.env.SHOPIFY_APP_URL || process.env.APP_URL)) || "";
  return String(fromApi || fromEnv || "").trim().replace(/\/+$/, "");
}

function apiUrl(appBase: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return appBase ? `${appBase}${p}` : p;
}

function toFormState(record: LineItemRecord): FormState {
  return {
    carrier: record.carrier || "",
    customerStatus: record.customerStatus || "",
    deliveryStatus: record.deliveryStatus || "",
    trackingNumber: record.trackingNumber || "",
    freightRef: record.freightRef || "",
    eddDate: record.eddDate || "",
    dispatchStatus: record.dispatchStatus || "",
    warehouseStatus: record.warehouseStatus || "",
    supplierContainer: record.supplierContainer || "",
    portArrivalDate: record.portArrivalDate || "",
    inTransitDate: record.inTransitDate || "",
    depositPaid: record.depositPaid || "",
    balanceDue: record.balanceDue || "",
    notes: record.notes || "",
  };
}

export default reactExtension(TARGET, () => <OrderStatusEditor />);

function OrderStatusEditor() {
  const api = useApi(TARGET);

  const rawOrderId =
    (api as any)?.data?.selected?.[0]?.id ??
    (api as any)?.data?.orderId ??
    (api as any)?.orderId ??
    "";

  const orderId = stripGid(rawOrderId, "Order");
  const appUrl = resolveAppBaseUrl(api);

  const [shop, setShop] = useState("");
  const [records, setRecords] = useState<LineItemRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!orderId) {
        setLoading(false);
        setError("No order selected");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        let resolvedShop = "";
        try {
          const shopRes = await (api as any).query(`query { shop { myshopifyDomain } }`);
          resolvedShop = shopRes?.data?.shop?.myshopifyDomain ?? "";
        } catch (e) {
          console.error("[OrderStatusEditor] shop query failed", e);
        }

        if (cancelled) return;

        const qs = new URLSearchParams({ orderId, ...(resolvedShop ? { shop: resolvedShop } : {}) });
        const response = await fetch(apiUrl(appUrl, `/api/order-status?${qs.toString()}`), {
          cache: "no-store",
        });
        const json: ApiResponse = await response.json();

        if (cancelled) return;

        if (!response.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${response.status}`);
        }

        const rows = json.lineItems ?? [];
        setShop(resolvedShop);
        setRecords(rows);
        setSelectedIndex((current) => (rows.length ? Math.min(current, rows.length - 1) : 0));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load order items");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [api, appUrl, orderId]);

  const selectedRecord = records[selectedIndex] ?? null;
  const [form, setForm] = useState<FormState>({
    carrier: "",
    customerStatus: "",
    deliveryStatus: "",
    trackingNumber: "",
    freightRef: "",
    eddDate: "",
    dispatchStatus: "",
    warehouseStatus: "",
    supplierContainer: "",
    portArrivalDate: "",
    inTransitDate: "",
    depositPaid: "",
    balanceDue: "",
    notes: "",
  });

  useEffect(() => {
    if (selectedRecord) {
      setForm(toFormState(selectedRecord));
      setSaveError(null);
    }
  }, [selectedRecord]);

  const lineItemOptions = useMemo(
    () =>
      records.map((record, index) => ({
        value: String(index),
        label: record.productTitle || `Variant ${record.variantId}`,
      })),
    [records],
  );

  const updateField = (field: keyof FormState) => (value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const handleSave = async () => {
    if (!selectedRecord || !orderId || !shop) {
      setSaveError("Order or shop details are unavailable");
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const nextData = {
        ...form,
        productTitle: selectedRecord.productTitle || "",
      };

      const trackingChanged =
        form.trackingNumber.trim() !== "" &&
        form.trackingNumber.trim() !== (selectedRecord.trackingNumber || "").trim();
      const eddChanged =
        form.eddDate.trim() !== "" &&
        form.eddDate.trim() !== (selectedRecord.eddDate || "").trim();

      const notifyKind = eddChanged ? "edd" : trackingChanged ? "tracking" : undefined;

      const response = await fetch(apiUrl(appUrl, "/api/order-status"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          orderId,
          variantId: selectedRecord.variantId,
          data: nextData,
          performedBy: "Shopify Admin",
          source: "shopify_admin_block",
          notifyCustomer: eddChanged || trackingChanged,
          notifyKind,
        }),
      });

      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Save failed");
      }

      setRecords((current) =>
        current.map((item, idx) =>
          idx === selectedIndex ? { ...item, ...nextData } : item,
        ),
      );
      setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Text>Loading freight details…</Text>;
  }

  if (error) {
    return <Text>{error}</Text>;
  }

  if (!selectedRecord) {
    return <Text>No freight data available for this order.</Text>;
  }

  return (
    <BlockStack gap="base">
      {records.length > 1 ? (
        <Select
          label="Line item"
          value={String(selectedIndex)}
          onChange={(value) => setSelectedIndex(Number(value))}
          options={lineItemOptions}
        />
      ) : null}

      <Text fontWeight="bold">{selectedRecord.productTitle || `Variant ${selectedRecord.variantId}`}</Text>

      {selectedRecord.carrier ? (
        <Text>Carrier: {selectedRecord.carrier} (set at checkout — not editable)</Text>
      ) : null}

      <InlineStack gap="base" blockAlignment="end">
        <Box minInlineSize="50%">
          <Select
            label="Customer Status"
            value={form.customerStatus}
            onChange={updateField("customerStatus")}
            options={CUSTOMER_STATUS_OPTIONS}
          />
        </Box>
        <Box minInlineSize="50%">
          <Select
            label="Warehouse Status"
            value={form.warehouseStatus}
            onChange={updateField("warehouseStatus")}
            options={WAREHOUSE_STATUS_OPTIONS}
          />
        </Box>
      </InlineStack>

      <InlineStack gap="base" blockAlignment="end">
        <Box minInlineSize="50%">
          <Select
            label="Dispatch Status"
            value={form.dispatchStatus}
            onChange={updateField("dispatchStatus")}
            options={DISPATCH_STATUS_OPTIONS}
          />
        </Box>
        <Box minInlineSize="50%">
          <Select
            label="Delivery Status"
            value={form.deliveryStatus}
            onChange={updateField("deliveryStatus")}
            options={DELIVERY_STATUS_OPTIONS}
          />
        </Box>
      </InlineStack>

      <InlineStack gap="base" blockAlignment="end">
        <Box minInlineSize="50%">
          <TextField
            label="Tracking #"
            value={form.trackingNumber}
            onChange={updateField("trackingNumber")}
          />
        </Box>
        <Box minInlineSize="50%">
          <TextField
            label="Freight ref"
            value={form.freightRef}
            onChange={updateField("freightRef")}
          />
        </Box>
      </InlineStack>

      <InlineStack gap="base" blockAlignment="end">
        <Box minInlineSize="50%">
          <TextField
            label="EDD (YYYY-MM-DD)"
            value={form.eddDate}
            onChange={updateField("eddDate")}
          />
        </Box>
        <Box minInlineSize="50%">
          <TextField
            label="Port Arrival (YYYY-MM-DD)"
            value={form.portArrivalDate}
            onChange={updateField("portArrivalDate")}
          />
        </Box>
      </InlineStack>

      <InlineStack gap="base" blockAlignment="end">
        <Box minInlineSize="50%">
          <TextField
            label="In Transit Date (YYYY-MM-DD)"
            value={form.inTransitDate}
            onChange={updateField("inTransitDate")}
          />
        </Box>
        <Box minInlineSize="50%">
          <TextField
            label="Supplier / Container"
            value={form.supplierContainer}
            onChange={updateField("supplierContainer")}
          />
        </Box>
      </InlineStack>

      <InlineStack gap="base" blockAlignment="end">
        <Box minInlineSize="50%">
          <TextField
            label="Deposit Paid ($)"
            value={form.depositPaid}
            onChange={updateField("depositPaid")}
          />
        </Box>
        <Box minInlineSize="50%">
          <TextField
            label="Balance Due ($)"
            value={form.balanceDue}
            onChange={updateField("balanceDue")}
          />
        </Box>
      </InlineStack>

      <TextArea
        label="Notes / internal info"
        value={form.notes}
        onChange={updateField("notes")}
        rows={3}
      />

      {saveError ? <Text>{saveError}</Text> : null}

      <Button onClick={handleSave} variant="primary" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </BlockStack>
  );
}
