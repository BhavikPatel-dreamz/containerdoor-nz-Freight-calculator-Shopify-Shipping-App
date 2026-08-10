import React, { useState, useMemo } from "react";
import {
  reactExtension,
  useTarget,
  useShippingAddress,
  useApplyAttributeChange,
  BlockStack,
  Text,
  View,
  Select,
} from "@shopify/ui-extensions-react/checkout";

const TARGET = "purchase.checkout.shipping-option-item.render-after";

export default reactExtension(TARGET, () => <ShippingOptionNote />);

// Demo Fliway depot centers with pincodes (replace with real depot data / API later)
const FLIWAY_DEPOTS = [
  // Auckland depots
  { id: "depot-akl-1010", name: "Fliway Depot - Auckland Central", address: "12 Fanshawe Street, Auckland CBD", pincode: "1010", price: "$1.00" },
  { id: "depot-akl-1023", name: "Fliway Depot - Parnell", address: "88 Parnell Road, Parnell", pincode: "1023", price: "$2.00" },
  { id: "depot-akl-1060", name: "Fliway Depot - Mount Eden", address: "45 Mount Eden Road, Mount Eden", pincode: "1060", price: "$3.00" },
  // Gisborne depots
  { id: "depot-gis-4010", name: "Fliway Depot - Gisborne Central", address: "20 Gladstone Road, Gisborne", pincode: "4010", price: "$1.00" },
  { id: "depot-gis-4010b", name: "Fliway Depot - Gisborne East", address: "5 Customhouse Street, Gisborne", pincode: "4010", price: "$2.00" },
  { id: "depot-gis-4012", name: "Fliway Depot - Elgin, Gisborne", address: "112 Childers Road, Elgin, Gisborne", pincode: "4012", price: "$3.00" },
];

function ShippingOptionNote() {
  const target = useTarget() as any;
  const shippingAddress = useShippingAddress();
  const applyAttributeChange = useApplyAttributeChange();

  const title =
    target?.title ?? target?.shippingOption?.title ?? target?.shipping_rate?.title ?? "";

  const isDepot = /depot/i.test(title ?? "");
  if (!title || !isDepot) return null;

  const optionKey =
    target?.id ?? target?.shippingOption?.id ?? target?.shipping_rate?.handle ?? title;

  const customerZip = shippingAddress?.zip ?? "";

  const sortedDepots = useMemo(() => {
    const customerZipNum = parseInt(customerZip, 10);
    const depotsWithDistance = FLIWAY_DEPOTS.map((depot) => {
      const depotZipNum = parseInt(depot.pincode, 10);
      const distance =
        !isNaN(customerZipNum) && !isNaN(depotZipNum)
          ? Math.abs(customerZipNum - depotZipNum)
          : Number.MAX_SAFE_INTEGER;
      return { ...depot, distance };
    });
    depotsWithDistance.sort((a, b) => a.distance - b.distance);
    return depotsWithDistance;
  }, [customerZip]);

  const [selected, setSelected] = useState<string>("");

  async function postSelection(optionId: string) {
    try {
      const APP_URL = String(
        (typeof process !== "undefined" &&
          (process.env.SHOPIFY_APP_URL || process.env.APP_URL)) ||
          ""
      ).trim();
      if (!APP_URL) return;
      await fetch(`${APP_URL}/api/checkout-child-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionKey, optionId, customerZip }),
      });
    } catch (e) {
      console.warn("postSelection error", e);
    }
  }

  async function handleChange(value: string) {
    setSelected(value);

    const depot = sortedDepots.find((d) => d.id === value);
    if (depot) {
      // Key + JSON shape must match extractSelectedDepotAddress() in order-webhook.server.ts
      await applyAttributeChange({
        type: "updateAttribute",
        key: "selected_depot_address",
        value: JSON.stringify({
          name: depot.name,
          address1: depot.address,
          city: "",
          zip: depot.pincode,
        }),
      });
    }

    void postSelection(value);
  }

  const selectedDepot = sortedDepots.find((d) => d.id === selected);

  return (
    <View padding={["none", "none", "tight", "none"]}>
      <BlockStack spacing="extraTight">
        <Select
          label="Choose nearest depot"
          value={selected}
          onChange={handleChange}
          options={[
            { value: "", label: "Choose option", disabled: true },
            ...sortedDepots.map((d, index) => ({
              value: d.id,
              label: `${index === 0 ? "★ " : ""}${d.name} — ${d.address} (${d.pincode})`,
            })),
          ]}
        />

        {selectedDepot ? (
          <Text size="small" appearance="subdued">
            Selected: {selectedDepot.name}, {selectedDepot.address} ({selectedDepot.pincode})
          </Text>
        ) : (
          <Text size="small" appearance="subdued">
            Nearest depot shown first based on your shipping postcode
          </Text>
        )}
      </BlockStack>
    </View>
  );
}