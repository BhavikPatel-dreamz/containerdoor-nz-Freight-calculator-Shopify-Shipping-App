import {
  reactExtension,
  useShippingOptionTarget,
  useAttributes,
  useApplyAttributeChange,
  BlockStack,
  ChoiceList,
  Choice,
  Text,
} from "@shopify/ui-extensions-react/checkout";

// TODO: replace with real depot data (per city / postcode) once available.
const DEMO_DEPOTS = [
  { id: "auckland-1", name: "Fliway Depot - Penrose", address1: "12 Penrose Rd", city: "Auckland", zip: "1061" },
  { id: "auckland-2", name: "Fliway Depot - Mt Wellington", address1: "45 Mt Wellington Hwy", city: "Auckland", zip: "1060" },
  { id: "auckland-3", name: "Fliway Depot - Manukau", address1: "8 Manukau Station Rd", city: "Auckland", zip: "2104" },
];

const DEPOT_ATTRIBUTE_KEY = "selected_depot_address";

export default reactExtension(
  "purchase.checkout.shipping-option-item.render-after",
  () => <DepotChildSelector />,
);

function DepotChildSelector() {
  // useShippingOptionTarget() returns a wrapper object, not the option itself.
  // Real shape: { shippingOptionTarget, isTargetSelected, renderMode }
  const { shippingOptionTarget, isTargetSelected } = useShippingOptionTarget();
  const applyAttributeChange = useApplyAttributeChange();
  const attributes = useAttributes();

  const title = shippingOptionTarget?.title ?? "";
  const isDepotOption = /depot collection/i.test(title);

  if (!isDepotOption || !isTargetSelected) return null;

  const current = attributes.find((a) => a.key === DEPOT_ATTRIBUTE_KEY)?.value ?? "";

  const handleChange = async (depotId: string) => {
    const depot = DEMO_DEPOTS.find((d) => d.id === depotId);
    if (!depot) return;
    await applyAttributeChange({
      type: "updateAttribute",
      key: DEPOT_ATTRIBUTE_KEY,
      value: JSON.stringify(depot),
    });
  };

  return (
    <BlockStack spacing="tight" padding={["tight", "none", "none", "none"]}>
      <Text size="small" appearance="subdued">
        Choose your nearest depot
      </Text>
      <ChoiceList
        name="depot-child-selector"
        value={current ? (JSON.parse(current).id as string) : undefined}
        onChange={handleChange}
      >
        <BlockStack spacing="extraTight">
          {DEMO_DEPOTS.map((depot) => (
            <Choice id={depot.id} key={depot.id}>
              {`${depot.name} — ${depot.address1}, ${depot.city} ${depot.zip}`}
            </Choice>
          ))}
        </BlockStack>
      </ChoiceList>
    </BlockStack>
  );
}