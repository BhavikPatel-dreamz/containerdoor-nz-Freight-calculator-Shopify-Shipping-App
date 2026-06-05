import { useEffect, useState, useCallback } from "react";
import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  InlineStack,
  Button,
  Divider,
  NumberField,
  Text,
  Banner,
  ProgressIndicator,
  Box,
} from "@shopify/ui-extensions-react/admin";

const TARGET = "admin.product-variant-details.block.render";
export default reactExtension(TARGET, () => <BoxDimensionsBlock />);

type Box = { length: string; width: string; height: string; weight: string };
const NAMESPACE = "containerdoor_freight";

function BoxDimensionsBlock() {
  const api = useApi(TARGET);
  const variantId =
    (api.data as any).selected?.[0]?.id ??
    (api.data as any).variant?.id ??
    (api.data as any).variantId;

  const [boxes, setBoxes] = useState<Box[]>([
    { length: "", width: "", height: "", weight: "" },
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{
    tone: "success" | "critical";
    msg: string;
  } | null>(null);

  // ── Authenticated GraphQL helper using api.query() ──────────────────────────
  // api.query() is the correct method for admin block extensions —
  // it is automatically authenticated with the current user's session.
  async function gql(query: string, variables?: Record<string, unknown>) {
    const res = await (api as any).query(query, { variables });
    // api.query returns { data, errors } directly (no .json() needed)
    if (res?.errors?.length) {
      throw new Error(res.errors[0]?.message ?? "GraphQL error");
    }
    return res;
  }

  // ── Load existing metafields ────────────────────────────────────────────────
  const loadBoxes = useCallback(async () => {
    if (!variantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await gql(
        `query GetVariantMeta($id: ID!, $namespace: String!) {
          productVariant(id: $id) {
            metafields(first: 10, namespace: $namespace) {
              nodes { key value }
            }
          }
        }`,
        { id: variantId, namespace: NAMESPACE }
      );

      const nodes: { key: string; value: string }[] =
        res.data?.productVariant?.metafields?.nodes ?? [];
      const mf: Record<string, string> = Object.fromEntries(
        nodes.map((n: any) => [n.key, n.value])
      );

      const lengths = (mf.box_length_cm || "").split(",").filter(Boolean);
      const widths  = (mf.box_width_cm  || "").split(",").filter(Boolean);
      const heights = (mf.box_height_cm || "").split(",").filter(Boolean);
      const weights = (mf.weight_grams  || "").split(",").filter(Boolean);
      const count = Math.max(lengths.length, 1);

      setBoxes(
        Array.from({ length: count }, (_, i) => ({
          length: lengths[i] ?? "",
          width:  widths[i]  ?? "",
          height: heights[i] ?? "",
          weight: weights[i] ? String(Number(weights[i]) / 1000) : "",
        }))
      );
    } catch (e) {
      console.error("[BoxDimensions] loadBoxes error:", e);
      setBanner({ tone: "critical", msg: `Load error: ${String(e)}` });
    } finally {
      setLoading(false);
    }
  }, [variantId]);

  useEffect(() => {
    loadBoxes();
  }, [loadBoxes]);

  // ── Save metafields ─────────────────────────────────────────────────────────
  async function save() {
    if (!variantId) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await gql(
        `mutation SetMeta($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
        {
          metafields: [
            { key: "box_length_cm", value: boxes.map((b) => b.length).join(",") },
            { key: "box_width_cm",  value: boxes.map((b) => b.width).join(",")  },
            { key: "box_height_cm", value: boxes.map((b) => b.height).join(",") },
            {
              key: "weight_grams",
              value: boxes
                .map((b) => String(Math.round(Number(b.weight) * 1000)))
                .join(","),
            },
          ].map((m) => ({
            ownerId: variantId,
            namespace: NAMESPACE,
            key: m.key,
            value: m.value,
            type: "single_line_text_field",
          })),
        }
      );

      const errors = res.data?.metafieldsSet?.userErrors ?? [];
      if (errors.length > 0) {
        setBanner({ tone: "critical", msg: errors[0].message });
      } else {
        setBanner({ tone: "success", msg: "Saved successfully!" });
      }
    } catch (e) {
      console.error("[BoxDimensions] save error:", e);
      setBanner({ tone: "critical", msg: "Save failed. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  // ── Box state helpers ───────────────────────────────────────────────────────
  function update(i: number, field: keyof Box, val: string) {
    setBoxes((prev) =>
      prev.map((b, idx) => (idx === i ? { ...b, [field]: val } : b))
    );
  }
  function addBox() {
    setBoxes((prev) => [
      ...prev,
      { length: "", width: "", height: "", weight: "" },
    ]);
  }
  function removeBox(i: number) {
    setBoxes((prev) => prev.filter((_, idx) => idx !== i));
  }

  const totalCbm = boxes.reduce((sum, b) => {
    const l = Number(b.length) || 0,
      w = Number(b.width) || 0,
      h = Number(b.height) || 0;
    return sum + (l > 0 && w > 0 && h > 0 ? (l * w * h) / 1_000_000 : 0);
  }, 0);
  const totalWeight = boxes.reduce((sum, b) => sum + (Number(b.weight) || 0), 0);

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AdminBlock title="Box Dimensions">
        <InlineStack inlineAlignment="center">
          <ProgressIndicator size="small" />
        </InlineStack>
      </AdminBlock>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AdminBlock title="Box Dimensions">
      <BlockStack gap="base">
        {banner && <Banner tone={banner.tone}>{banner.msg}</Banner>}

        {/* ── HEADER ROW ── */}
        <Box paddingBlockEnd="100">
          <InlineStack gap="base" blockAlignment="center">
            <Box minWidth="10%" maxWidth="10%">
              <Text fontWeight="bold" variant="headingXs">Box</Text>
            </Box>
            <Box minWidth="20%" maxWidth="20%">
              <Text fontWeight="bold" variant="headingXs">Length (cm)</Text>
            </Box>
            <Box minWidth="20%" maxWidth="20%">
              <Text fontWeight="bold" variant="headingXs">Width (cm)</Text>
            </Box>
            <Box minWidth="20%" maxWidth="20%">
              <Text fontWeight="bold" variant="headingXs">Height (cm)</Text>
            </Box>
            <Box minWidth="20%" maxWidth="20%">
              <Text fontWeight="bold" variant="headingXs">Weight (kg)</Text>
            </Box>
            {boxes.length > 1 && (
              <Box minWidth="10%" maxWidth="10%">
                <Text> </Text>
              </Box>
            )}
          </InlineStack>
        </Box>

        <Divider />

        {/* ── BOX ROWS ── */}
        {boxes.map((box, i) => (
          <BlockStack key={i} gap="extraTight">
            <Box paddingBlock="100">
              <InlineStack gap="base" blockAlignment="center">
                <Box minWidth="10%" maxWidth="10%">
                  <Text fontWeight="bold" variant="bodySm">#{i + 1}</Text>
                </Box>
                <Box minWidth="20%" maxWidth="20%">
                  <NumberField
                    label="Length"
                    labelHidden
                    value={Number(box.length) || 0}
                    onChange={(v: number) => update(i, "length", String(v))}
                    min={0}
                    step={0.1}
                  />
                </Box>
                <Box minWidth="20%" maxWidth="20%">
                  <NumberField
                    label="Width"
                    labelHidden
                    value={Number(box.width) || 0}
                    onChange={(v: number) => update(i, "width", String(v))}
                    min={0}
                    step={0.1}
                  />
                </Box>
                <Box minWidth="20%" maxWidth="20%">
                  <NumberField
                    label="Height"
                    labelHidden
                    value={Number(box.height) || 0}
                    onChange={(v: number) => update(i, "height", String(v))}
                    min={0}
                    step={0.1}
                  />
                </Box>
                <Box minWidth="20%" maxWidth="20%">
                  <NumberField
                    label="Weight"
                    labelHidden
                    value={Number(box.weight) || 0}
                    onChange={(v: number) => update(i, "weight", String(v))}
                    min={0}
                    step={0.1}
                  />
                </Box>
                {boxes.length > 1 && (
                  <Box minWidth="10%" maxWidth="10%">
                    <Button
                      variant="plain"
                      tone="critical"
                      onPress={() => removeBox(i)}
                    >
                      Remove
                    </Button>
                  </Box>
                )}
              </InlineStack>
            </Box>
            <Divider />
          </BlockStack>
        ))}

        {/* ── ADD BOX ── */}
        <Box paddingBlockStart="100">
          <Button variant="plain" onPress={addBox}>
            + Add box
          </Button>
        </Box>

        <Divider />

        {/* ── TOTALS ── */}
        <InlineStack gap="loose" blockAlignment="center">
          <InlineStack gap="extraTight">
            <Text tone="subdued">Boxes:</Text>
            <Text fontWeight="bold">{boxes.length}</Text>
          </InlineStack>
          <InlineStack gap="extraTight">
            <Text tone="subdued">Total weight:</Text>
            <Text fontWeight="bold">{totalWeight.toFixed(1)} kg</Text>
          </InlineStack>
          <InlineStack gap="extraTight">
            <Text tone="subdued">Total CBM:</Text>
            <Text fontWeight="bold">{totalCbm.toFixed(3)}</Text>
          </InlineStack>
        </InlineStack>

        {/* ── SAVE ── */}
        <Button variant="primary" onPress={save} loading={saving}>
          Save dimensions
        </Button>
      </BlockStack>
    </AdminBlock>
  );
}