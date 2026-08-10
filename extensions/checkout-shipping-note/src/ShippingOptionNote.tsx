import React, { useState } from "react";
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

  // Local selection state for demo options (does not change Shopify selection)
  const [selected, setSelected] = useState<string | null>(null);

  const demoOptions = [
    { id: "test1", label: "Test 1" },
    { id: "test2", label: "Test 2" },
    { id: "test3", label: "Test 3" },
  ];

  return (
    <View padding={["none", "none", "tight", "none"]}>
      <BlockStack spacing="extraTight">
        <InlineStack spacing="extraTight">
          {demoOptions.map((o) => (
            <Button
              key={o.id}
              variant={selected === o.id ? "primary" : "secondary"}
              onPress={() => setSelected(o.id)}
            >
              {o.label}
            </Button>
          ))}
        </InlineStack>

        {selected ? (
          <InlineStack blockAlignment="center" spacing="extraTight">
            <Badge tone="info">Selected</Badge>
            <Text size="small" appearance="subdued">
              {demoOptions.find((d) => d.id === selected)?.label}
            </Text>
          </InlineStack>
        ) : (
          <Text size="small" appearance="subdued">
            Choose a demo option
          </Text>
        )}
      </BlockStack>
    </View>
  );
}
