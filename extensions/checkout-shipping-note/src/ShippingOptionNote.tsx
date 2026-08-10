import React, { useState, useMemo } from "react";
import {
  reactExtension,
  useTarget,
  BlockStack,
  Text,
  View,
  InlineStack,
  Button,
  Badge,
} from "@shopify/ui-extensions-react/checkout";

const TARGET = "purchase.checkout.shipping-option-item.render-after";

export default reactExtension(TARGET, () => <ShippingOptionNote />);

function ShippingOptionNote() {
  // The platform injects the specific shipping option target object.
  const target = useTarget() as any;

  const title =
    target?.title ?? target?.shippingOption?.title ?? target?.shipping_rate?.title ?? "";

  // Only show for depot-style shipping option titles
  const isDepot = /depot/i.test(title ?? "");
  if (!title || !isDepot) return null;

  // Attempt to derive a stable key for the shipping option so child options
  // can be specific to the rate (use handle/id/title fallback)
  const optionKey =
    target?.id ?? target?.shippingOption?.id ?? target?.shipping_rate?.handle ?? title;

  // Demo child options keyed by carrier/title pattern. Extend as needed.
  const childOptionsByPattern = useMemo(
    () => [
      {
        test: /fliway/i,
        options: [
          { id: `${optionKey}-1`, label: "Depot Pickup - Morning", price: "$1.00" },
          { id: `${optionKey}-2`, label: "Depot Pickup - Afternoon", price: "$2.00" },
          { id: `${optionKey}-3`, label: "Depot Pickup - Afterhours", price: "$3.00" },
        ],
      },
      {
        test: /castle|nzp/i,
        options: [
          { id: `${optionKey}-a`, label: "Express Depot", price: "$4.00" },
          { id: `${optionKey}-b`, label: "Standard Depot", price: "$0.00" },
          { id: `${optionKey}-c`, label: "Economy Depot", price: "-$1.00" },
        ],
      },
    ],
    [optionKey]
  );

  // Choose matching child options set
  const childOptions =
    childOptionsByPattern.find((p) => p.test.test(title))?.options ?? [
      { id: `${optionKey}-x1`, label: "Demo Option 1", price: "$0.00" },
      { id: `${optionKey}-x2`, label: "Demo Option 2", price: "$0.00" },
      { id: `${optionKey}-x3`, label: "Demo Option 3", price: "$0.00" },
    ];

  const [selected, setSelected] = useState<string | null>(null);

  // Optional: POST selection to your app for persistence. Requires APP_URL
  async function postSelection(optionId: string) {
    try {
      const APP_URL = String(
        (typeof process !== "undefined" && (process.env.SHOPIFY_APP_URL || process.env.APP_URL)) ||
          ""
      ).trim();
      if (!APP_URL) return;
      await fetch(`${APP_URL}/api/checkout-child-selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionKey, optionId }),
      });
    } catch (e) {
      // ignore network errors for demo
      console.warn("postSelection error", e);
    }
  }

  return (
    <View padding={["none", "none", "tight", "none"]}>
      <BlockStack spacing="extraTight">
        <InlineStack spacing="extraTight">
          {childOptions.map((o) => (
            <Button
              key={o.id}
              variant={selected === o.id ? "primary" : "secondary"}
              onPress={() => {
                setSelected(o.id);
                void postSelection(o.id);
              }}
            >
              {o.label} {o.price ? ` (${o.price})` : ""}
            </Button>
          ))}
        </InlineStack>

        {selected ? (
          <InlineStack blockAlignment="center" spacing="extraTight">
            <Badge tone="info">Selected</Badge>
            <Text size="small" appearance="subdued">
              {childOptions.find((d) => d.id === selected)?.label}
            </Text>
          </InlineStack>
        ) : (
          <Text size="small" appearance="subdued">
            Choose one of the depot child options
          </Text>
        )}
      </BlockStack>
    </View>
  );
}

