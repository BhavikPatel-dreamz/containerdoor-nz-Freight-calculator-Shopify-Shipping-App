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

// Fliway depot branches
const FLIWAY_DEPOTS = [
  { id: "fliway-whangarei", name: "Fliway Depot - Whangarei", address: "14 South End Avenue, Raumunga", pincode: "0110" },
  { id: "fliway-auckland", name: "Fliway Depot - Auckland", address: "66 Westney Road, Mangere", pincode: "2022" },
  { id: "fliway-hamilton", name: "Fliway Depot - Hamilton", address: "28 Earthmover Cres", pincode: "3200" },
  { id: "fliway-tauranga", name: "Fliway Depot - Tauranga", address: "351 Matakokiri Drive, Tauriko", pincode: "3171" },
  { id: "fliway-napier", name: "Fliway Depot - Napier", address: "41 Rangitane Road, Whakatu", pincode: "4172" },
  { id: "fliway-palmerston-north", name: "Fliway Depot - Palmerston North", address: "34 El Prado Drive", pincode: "4414" },
  { id: "fliway-new-plymouth", name: "Fliway Depot - New Plymouth", address: "117 De Havilland Drive", pincode: "4312" },
  { id: "fliway-wellington", name: "Fliway Depot - Wellington", address: "7 Barley Mow Lane, Silverstream", pincode: "5019" },
  { id: "fliway-blenheim", name: "Fliway Depot - Blenheim", address: "5 Manchester Street, Riverlands", pincode: "7274" },
  { id: "fliway-christchurch", name: "Fliway Depot - Christchurch", address: "24 Innovation Road, Islington", pincode: "8042" },
  { id: "fliway-cromwell", name: "Fliway Depot - Cromwell", address: "8 Harvest Drive", pincode: "9310" },
  { id: "fliway-dunedin", name: "Fliway Depot - Dunedin", address: "10A Strathallan Street", pincode: "9012" },
];

// Mainfreight / 2Home depot branches
const MAINFREIGHT_DEPOTS = [
  { id: "mainfreight-kaitaia", name: "Mainfreight Depot - Kaitaia", address: "149 North Road, Kaitaia", pincode: "0482" },
  { id: "mainfreight-whangarei", name: "Mainfreight Depot - Whangarei", address: "33 Fertilizer Road, Port Whangarei", pincode: "0110" },
  { id: "mainfreight-auckland", name: "Mainfreight Depot - Auckland", address: "18 Savill Drive, Auckland", pincode: "2024" },
  { id: "mainfreight-thames", name: "Mainfreight Depot - Thames", address: "79 Kopu Road, Kopu", pincode: "3578" },
  { id: "mainfreight-hamilton", name: "Mainfreight Depot - Hamilton", address: "107 Ruffell Road, Hamilton", pincode: "3200" },
  { id: "mainfreight-tauranga", name: "Mainfreight Depot - Tauranga", address: "3 Te Kakau Place, Papamoa", pincode: "3175" },
  { id: "mainfreight-rotorua", name: "Mainfreight Depot - Rotorua", address: "Biak Street, Mangakakahi, Rotorua", pincode: "3015" },
  { id: "mainfreight-taupo", name: "Mainfreight Depot - Taupo", address: "7 Keehan Drive, Taupo", pincode: "3379" },
  { id: "mainfreight-gisborne", name: "Mainfreight Depot - Gisborne", address: "310 Lytton Road, Awapuni, Gisborne", pincode: "4010" },
  { id: "mainfreight-napier", name: "Mainfreight Depot - Napier", address: "27 Tyne Street, Pandora, Napier", pincode: "4110" },
  { id: "mainfreight-new-plymouth", name: "Mainfreight Depot - New Plymouth", address: "74 Corbett Road, Bell Block", pincode: "4312" },
  { id: "mainfreight-whanganui", name: "Mainfreight Depot - Whanganui", address: "3 Peter Robb Lane, Whanganui", pincode: "4501" },
  { id: "mainfreight-palmerston-north", name: "Mainfreight Depot - Palmerston North", address: "605 Tremaine Avenue, Palmerston North", pincode: "4414" },
  { id: "mainfreight-levin", name: "Mainfreight Depot - Levin", address: "112–124 Cambridge Street South, Levin", pincode: "5510" },
  { id: "mainfreight-wellington", name: "Mainfreight Depot - Wellington", address: "81 Aotea Quay, Wellington", pincode: "6011" },
  { id: "mainfreight-nelson", name: "Mainfreight Depot - Nelson", address: "47 Parkers Road, Tahunanui, Nelson", pincode: "7011" },
  { id: "mainfreight-blenheim", name: "Mainfreight Depot - Blenheim", address: "14 Sutherland Terrace, Blenheim", pincode: "7201" },
  { id: "mainfreight-christchurch", name: "Mainfreight Depot - Christchurch", address: "160 Waterloo Road, Hornby, Christchurch", pincode: "8042" },
  { id: "mainfreight-greymouth", name: "Mainfreight Depot - Greymouth", address: "23 Arney Street, Greymouth", pincode: "7805" },
  { id: "mainfreight-timaru", name: "Mainfreight Depot - Timaru", address: "25 Treneglos Street, Timaru", pincode: "7910" },
  { id: "mainfreight-oamaru", name: "Mainfreight Depot - Oamaru", address: "20 Pukeuri-Oamaru Road, Oamaru", pincode: "9494" },
  { id: "mainfreight-dunedin", name: "Mainfreight Depot - Dunedin", address: "9 Strathallan Street, Dunedin", pincode: "9012" },
  { id: "mainfreight-cromwell", name: "Mainfreight Depot - Cromwell", address: "22–24 McNulty Road, Cromwell", pincode: "9310" },
  { id: "mainfreight-invercargill", name: "Mainfreight Depot - Invercargill", address: "29–43 Spey Street, Invercargill", pincode: "9810" },
];

function ShippingOptionNote() {
  const target = useTarget() as any;
  const shippingAddress = useShippingAddress();
  const applyAttributeChange = useApplyAttributeChange();

  const title =
    target?.title ?? target?.shippingOption?.title ?? target?.shipping_rate?.title ?? "";

  const isDepot = /depot/i.test(title ?? "");

  // Pick the correct depot list based on which carrier's title matched
  const isMainfreight = /mainfreight|2home/i.test(title ?? "");
  const DEPOT_LIST = isMainfreight ? MAINFREIGHT_DEPOTS : FLIWAY_DEPOTS;

  const optionKey =
    target?.id ?? target?.shippingOption?.id ?? target?.shipping_rate?.handle ?? title;

  const customerZip = shippingAddress?.zip ?? "";

  // NOTE: hooks must always run in the same order on every render, so they
  // stay above the early "return null" below (Rules of Hooks). Previously
  // the early return happened before these hooks, which could silently
  // break rendering for specific shipping options (e.g. Mainfreight).
  const sortedDepots = useMemo(() => {
    const customerZipNum = parseInt(customerZip, 10);
    const depotsWithDistance = DEPOT_LIST.map((depot) => {
      const depotZipNum = parseInt(depot.pincode, 10);
      const distance =
        !isNaN(customerZipNum) && !isNaN(depotZipNum)
          ? Math.abs(customerZipNum - depotZipNum)
          : Number.MAX_SAFE_INTEGER;
      return { ...depot, distance };
    });
    depotsWithDistance.sort((a, b) => a.distance - b.distance);
    return depotsWithDistance;
  }, [customerZip, isMainfreight]);

  const [selected, setSelected] = useState<string>("");

  if (!title || !isDepot) return null;

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