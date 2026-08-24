/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CarrierCompany } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

export type FreightCsvCarrier =
  | "FLIWAYLINEHAUL"
  | "FLIWAYMIDSIZE"
  | "FLIWAYDEPOT"
  | "M2H"
  | "NZP"
  | "NZP_AGE_RESTRICTED"
  | "CASTLE";

export type FreightCsvExportItem = {
  orderId: string;
  variantId: string;
};

export const FREIGHT_CSV_CARRIERS: FreightCsvCarrier[] = [
  "FLIWAYLINEHAUL",
  "FLIWAYMIDSIZE",
  "FLIWAYDEPOT",
  "M2H",
  "NZP",
  "NZP_AGE_RESTRICTED",
  "CASTLE",
];

const csvLabelMap: Record<FreightCsvCarrier, string> = {
  FLIWAYLINEHAUL: "Fliway Linehaul",
  FLIWAYMIDSIZE: "Fliway Midsize",
  FLIWAYDEPOT: "Fliway Depot",
  M2H: "Mainfreight 2Home",
  NZP: "NZ Post",
  NZP_AGE_RESTRICTED: "NZ Post Age Restricted",
  CASTLE: "Castle Parcels",
};

const DEFAULT_FROM = {
  company: "Container Door",
  address1: "123 Pilkington Road",
  address2: "",
  suburb: "Panmure",
  postcode: "1072",
  readyDate: "",
};

function escapeCsvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    if (char === "\r") continue;
    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function normalizeHeader(raw: string): string {
  return raw.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function getOrderReference(row: any, fallback = "") {
  const candidates = [
    row["orderid"],
    row["orderreference"],
    row["ordername"],
    row["purchaseid"],
    row["deliveryreference"],
    row["custorderref"],
    row["senderref"],
    row["receiverref"],
    row["consignmentnotenumber"],
    row["mftid"],
    row["reference"],
    row["code"],
    fallback,
  ];
  return candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function getTracking(row: any) {
  const candidates = [
    row["trackingnumber"],
    row["connote"],
    row["connotenumber"],
    row["shipmentid"],
    row["consignmentnotenumber"],
    row["mftid"],
    row["code"],
    row["tracking"],
    row["reference"],
  ];
  return candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function getCustomerName(row: any) {
  return (
    row["toname"] ||
    row["customername"] ||
    row["name"] ||
    row["tocompanyname"] ||
    row["receivername"] ||
    row["to_companyname"] ||
    ""
  );
}

function getAddress(row: any) {
  const street =
    row["destinationstreet"] ||
    row["toaddress1"] ||
    row["streetaddress"] ||
    row["receiveraddr1"] ||
    row["to_address1"] ||
    row["address1"] ||
    "";
  const suburb =
    row["destinationsuburb"] ||
    row["tosuburb"] ||
    row["suburb"] ||
    row["receiversuburb"] ||
    row["to_suburb"] ||
    "";
  const postcode =
    row["destinationpostcode"] ||
    row["topostcode"] ||
    row["postcode"] ||
    row["receiverpostalcode"] ||
    row["to_postcode"] ||
    "";

  return { street, suburb, postcode };
}

async function loadSelectedLineItem(shop: string, orderId: string, variantId: string) {
  const [indexRow, opsRow, snapshot] = await Promise.all([
    prisma.orderLineItemIndex.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
    }),
    prisma.orderLineItemOperationalData.findUnique({
      where: { shop_orderId_variantId: { shop, orderId, variantId } },
    }),
    prisma.orderSnapshot.findUnique({
      where: { shop_orderId: { shop, orderId } },
    }),
  ]);

  return {
    indexRow,
    opsRow,
    snapshot,
  };
}

const EXPORT_TEMPLATE: Record<FreightCsvCarrier, string[]> = {
  FLIWAYLINEHAUL: [
    "ConnoteNo (prefix CNDR)",
    "To_CompanyName",
    "To_Address1",
    "To_Address2",
    "To_Suburb",
    "To_POSTCode",
    "AddressType (RES)",
    "CustOrderRef",
    "MobilePhone",
    "PhoneNumber",
    "To_EmailAddress",
    "ToATL (Y or N)",
    "Goods Type",
    "PartNumber_Description",
    "Total Cartons",
    "Total Weight",
    "Total Cubic",
    "Del_instructions",
    "PickUp_Instructions",
    "From_CompanyName",
    "From_Address1",
    "From_Address2",
    "From_Suburb",
    "From_POSTCode",
    "Ready Date",
    "PICKUP",
    "OFD",
    "DELIVERY",
    "Account",
  ],
  FLIWAYMIDSIZE: [
    "ConnoteNo (prefix CNDR)",
    "To_CompanyName",
    "To_Address1",
    "To_Address2",
    "To_Suburb",
    "To_POSTCode",
    "AddressType (RES)",
    "CustOrderRef",
    "MobilePhone",
    "PhoneNumber",
    "To_EmailAddress",
    "ToATL (Y or N)",
    "Goods Type",
    "PartNumber_Description",
    "Total Cartons",
    "Total Weight",
    "Total Cubic",
    "Del_instructions",
    "PickUp_Instructions",
    "From_CompanyName",
    "From_Address1",
    "From_Address2",
    "From_Suburb",
    "From_POSTCode",
    "Ready Date",
    "PICKUP",
    "OFD",
    "DELIVERY",
    "Account",
  ],
  FLIWAYDEPOT: [
    "ConnoteNo (prefix CNDR)",
    "To_CompanyName",
    "To_Address1",
    "To_Address2",
    "To_Suburb",
    "To_POSTCode",
    "AddressType (RES)",
    "CustOrderRef",
    "MobilePhone",
    "PhoneNumber",
    "To_EmailAddress",
    "ToATL (Y or N)",
    "Goods Type",
    "PartNumber_Description",
    "Total Cartons",
    "Total Weight",
    "Total Cubic",
    "Del_instructions",
    "PickUp_Instructions",
    "From_CompanyName",
    "From_Address1",
    "From_Address2",
    "From_Suburb",
    "From_POSTCode",
    "Ready Date",
    "PICKUP",
    "OFD",
    "DELIVERY",
    "Account",
  ],
  M2H: [
    "MFTID",
    "Consignment Note Number",
    "Consignment Date",
    "Profile Name",
    "Carrier Code",
    "ServiceRequired",
    "ServiceType",
    "Sender Ref",
    "Receiver Ref",
    "Charge Code",
    "Charge Name",
    "Charge Addr1",
    "Charge Addr2",
    "Charge Suburb",
    "Charge City",
    "Charge Postal Code",
    "Charge State",
    "Charge Phone",
    "Sender Code",
    "Sender Name",
    "Sender Addr1",
    "Sender Addr2",
    "Sender Suburb",
    "Sender City",
    "Sender Postal Code",
    "Sender State",
    "Sender Phone",
    "Email Docs To",
    "Receiver Code",
    "Receiver Name",
    "Receiver Addr1",
    "Receiver Addr2",
    "Receiver Suburb",
    "Receiver City",
    "Receiver Postal Code",
    "Receiver State",
    "Receiver Phone",
    "Delivery Instructions",
    "Total Number of Chep",
    "Total Number of Loscam",
    "Delivery Bookin",
    "Bookin Required Date",
    "Bookin From Time",
    "Bookin To Time",
    "Bookin Reference",
    "Filler",
    "Filler",
    "Filler",
    "Filler",
    "Filler",
    "Line Number",
    "STC",
    "Number of Items",
    "Description/Product Code",
    "Cust DG Ref",
    "Commodity",
    "Height",
    "Width",
    "Length",
    "M3",
    "KG",
    "Notification  Email  Addresses",
    "Email Notification Types",
  ],
  NZP: [
    "Purchase ID",
    "Date",
    "To Name",
    "Destination Building",
    "Destination Street",
    "Destination Suburb",
    "Destination City",
    "Postcode",
    "State",
    "Country",
    "Email",
    "Phone",
    "Item",
    "Price",
    "Instructions",
    "Weight",
    "Shipping Method",
    "Reference",
    "SKU",
    "Qty",
    "Company",
    "Signature Required",
    "ATL",
    "T Code",
    "Package H",
    "Width",
    "Length",
    "Carrier",
    "Product",
    "Unit Type",
    "Declared Value Currency",
    "Color",
    "Size",
  ],
  NZP_AGE_RESTRICTED: [
    "Purchase ID",
    "Date",
    "To Name",
    "Destination Building",
    "Destination Street",
    "Destination Suburb",
    "Destination City",
    "Postcode",
    "State",
    "Country",
    "Email",
    "Phone",
    "Item",
    "Price",
    "Instructions",
    "Weight",
    "Shipping Method",
    "Reference",
    "SKU",
    "Qty",
    "Company",
    "Signature Required",
    "ATL",
    "T Code",
    "Package H",
    "Width",
    "Length",
    "Carrier",
    "Product",
    "Unit Type",
    "Declared Value Currency",
    "Color",
    "Size",
  ],
  CASTLE: [
    "Delivery Reference",
    "Name",
    "Building",
    "Street Address",
    "Suburb",
    "State",
    "PostCode",
    "Country",
    "Contact",
    "Phone",
    "Goods Desc",
    "Currency",
    "Value",
    "Part 1 Cubic",
    "Part 1 Kg",
    "Part 2 Cubic",
    "Part 2 Kg",
    "Part 3 Cubic",
    "Part 3 Kg",
    "Email",
    "Delivery Instructions",
    "Saturday Delivery",
    "Shipment Id(reserved)",
  ],
};

function toCarrierCompanyLabel(carrier: FreightCsvCarrier): string {
  return csvLabelMap[carrier];
}

function parseFreightTotalsFromShippingCode(code?: string | null): { weightKg: string; cubicM3: string } {
  const empty = { weightKg: "0", cubicM3: "0" };
  if (!code) return empty;

  const segments = code.split("::");
  if (segments.length < 2) return empty;

  const weightSegment = segments[segments.length - 2] ?? "";
  const cubicSegment = segments[segments.length - 1] ?? "";

  const weightMatch = weightSegment.match(/(-?\d+(?:\.\d+)?)\s*kg/i);
  const cubicMatch = cubicSegment.match(/(-?\d+(?:\.\d+)?)\s*cbm/i);

  if (!weightMatch && !cubicMatch) {
    return empty;
  }

  const weightKg = weightMatch ? Number(weightMatch[1]).toFixed(2) : "0";
  const cubicM3 = cubicMatch ? Number(cubicMatch[1]).toFixed(4) : "0";

  return { weightKg, cubicM3 };
}

function buildFliwayCustOrderRef(orderName: string, quantity: number | string, productName: string) {
  const base = `#${String(orderName || "").replace(/^#/, "")} ${String(quantity || 1).trim()} ${String(productName || "").trim()}`.replace(/\s+/g, " ").trim();
  return base.length > 20 ? base.slice(0, 20).trim().replace(/\s+$/, "") : base;
}

async function loadNzpBoxDimensions(shop: string, variantId: string) {
  const empty = { height: "", width: "", length: "" };

  if (!variantId) {
    return empty;
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      query VariantBoxDimensions($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            id
            metafields(first: 20, namespace: "containerdoor_freight") {
              nodes { key value }
            }
          }
        }
      }`,
      { variables: { id: `gid://shopify/ProductVariant/${variantId}` } },
    );
    const json = await response.json();
    const fields = Object.fromEntries(
      (json.data?.node?.metafields?.nodes ?? []).map((field: { key: string; value: string }) => [field.key, field.value]),
    );

    const height = String(fields.box_height_cm ?? "").trim();
    const width = String(fields.box_width_cm ?? "").trim();
    const length = String(fields.box_length_cm ?? "").trim();

    return {
      height: height || "",
      width: width || "",
      length: length || "",
    };
  } catch {
    return empty;
  }
}

async function loadSelectedDepotFromOrder(shop: string, orderId: string) {
  const cleanOrderId = String(orderId ?? "").replace(/^gid:\/\/shopify\/Order\//, "").trim();
  if (!cleanOrderId) return null;

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
      query OrderDepotSelection($id: ID!) {
        node(id: $id) {
          ... on Order {
            noteAttributes(first: 50) {
              edges {
                node {
                  key
                  value
                }
              }
            }
          }
        }
      }`,
      { variables: { id: `gid://shopify/Order/${cleanOrderId}` } },
    );
    const json = await response.json();
    const raw = (json.data?.node?.noteAttributes?.edges ?? [])
      .map((edge: { node?: { key?: string; value?: string } }) => edge.node)
      .find((node) => node?.key === "selected_depot_address")?.value;

    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return {
      address1: String(parsed.address1 ?? "").trim(),
      city: String(parsed.city ?? "").trim(),
      zip: String(parsed.zip ?? "").trim(),
      name: String(parsed.name ?? "").trim(),
    };
  } catch {
    return null;
  }
}

async function buildExportRow(shop: string, item: FreightCsvExportItem, carrier: FreightCsvCarrier) {
  const { indexRow, opsRow, snapshot } = await loadSelectedLineItem(shop, item.orderId, item.variantId);
  const customerName = indexRow?.customerName || [snapshot?.shippingFirstName, snapshot?.shippingLastName].filter(Boolean).join(" ") || "";
  const email = indexRow?.email || snapshot?.email || "";
  const mobilePhone = indexRow?.phone || snapshot?.phone || "";
  const city = indexRow?.city || snapshot?.shippingCity || "";
  const postalCode = indexRow?.zip || snapshot?.shippingZip || "";
  const address = snapshot ? [snapshot.shippingAddress1, snapshot.shippingCity, snapshot.shippingProvince, snapshot.shippingZip].filter(Boolean).join(", ") : "";
  const product = indexRow?.productTitle || opsRow?.productTitle || "";
  const sku = indexRow?.sku || "";
  const tracking = opsRow?.trackingNumber || "";
  const freightRef = opsRow?.freightRef || "";
  const eddDate = opsRow?.eddDate || "";
  const boxes = String(indexRow?.boxes ?? 0);
  const amount = String(indexRow?.amount ?? 0);

  const baseRow: Record<string, string> = {
    orderId: String(item.orderId),
    orderName: String(indexRow?.orderName || snapshot?.orderName || item.orderId),
    customerName,
    email,
    city,
    postalCode,
    address,
    product,
    sku,
    variantId: String(item.variantId),
    company: toCarrierCompanyLabel(carrier),
    tracking,
    freightRef,
    eddDate,
    boxes,
    amount,
  };

  if (carrier === "FLIWAYLINEHAUL" || carrier === "FLIWAYMIDSIZE" || carrier === "FLIWAYDEPOT") {
    const linehaulMobilePhone = mobilePhone || "";
    if (carrier === "FLIWAYLINEHAUL") {
      return [
        `CNDR${baseRow.orderName.replace(/[^a-zA-Z0-9]/g, "") || baseRow.orderId}`,
        customerName || baseRow.orderName,
        snapshot?.shippingAddress1 || "",
        snapshot?.shippingAddress2 || "",
        snapshot?.shippingCity || city,
        snapshot?.shippingZip || postalCode,
        "RES",
        baseRow.orderName,
        linehaulMobilePhone,
        "",
        email,
        "N",
        "Carton",
        product || `${sku || "Freight item"}`,
        boxes,
        "0",
        "0",
        "",
        "",
        DEFAULT_FROM.company,
        DEFAULT_FROM.address1,
        DEFAULT_FROM.address2,
        DEFAULT_FROM.suburb,
        DEFAULT_FROM.postcode,
        eddDate,
        email,
        email,
        email,
        "30002764",
      ];
    }

    if (carrier === "FLIWAYMIDSIZE") {
      const freightTotals = parseFreightTotalsFromShippingCode(snapshot?.shippingCode);
      const orderRef = String(baseRow.orderName || baseRow.orderId || "");
      const productRef = product || sku || "Freight item";
      const custOrderRef = buildFliwayCustOrderRef(orderRef, boxes, productRef);
      const shippingCity = String(snapshot?.shippingCity || city || "").trim();
      const shippingAddress2Raw = String(snapshot?.shippingAddress2 || "").trim();
      const address2 = shippingAddress2Raw && shippingAddress2Raw.toLowerCase() !== shippingCity.toLowerCase() ? shippingAddress2Raw : "";
      const suburb = shippingCity || "";

      return [
        `CNDR${baseRow.orderName.replace(/[^a-zA-Z0-9]/g, "") || baseRow.orderId}`,
        customerName || baseRow.orderName,
        snapshot?.shippingAddress1 || "",
        address2,
        suburb,
        snapshot?.shippingZip || postalCode,
        "RES",
        custOrderRef,
        linehaulMobilePhone,
        "",
        email,
        "N",
        "Carton",
        `${baseRow.orderName || baseRow.orderId} - ${productRef}`,
        boxes,
        freightTotals.weightKg,
        freightTotals.cubicM3,
        snapshot?.deliveryInstructions || "",
        "",
        DEFAULT_FROM.company,
        DEFAULT_FROM.address1,
        DEFAULT_FROM.address2,
        DEFAULT_FROM.suburb,
        DEFAULT_FROM.postcode,
        eddDate,
        email,
        email,
        email,
        "30002764",
      ];
    }

    const selectedDepotAddress1 = String(opsRow?.depotAddress1 || "").trim();
    const selectedDepotCity = String(opsRow?.depotCity || "").trim();
    const selectedDepotZip = String(opsRow?.depotZip || "").trim();
    const fallbackDepot = !selectedDepotAddress1 && !selectedDepotCity && !selectedDepotZip ? await loadSelectedDepotFromOrder(shop, item.orderId) : null;
    const resolvedDepotAddress1 = selectedDepotAddress1 || fallbackDepot?.address1 || "";
    const resolvedDepotCity = selectedDepotCity || fallbackDepot?.city || "";
    const resolvedDepotZip = selectedDepotZip || fallbackDepot?.zip || "";

    // Fliway Depot CSV: split the selected depot address on the LAST comma so
    // "41 Rangitane Road, Whakatu" becomes Address1="41 Rangitane Road", Suburb="Whakatu".
    let depotCsvAddress1 = resolvedDepotAddress1;
    let depotCsvSuburb = resolvedDepotCity;
    if (!depotCsvSuburb) {
      const lastCommaIndex = depotCsvAddress1.lastIndexOf(",");
      if (lastCommaIndex !== -1) {
        depotCsvSuburb = depotCsvAddress1.slice(lastCommaIndex + 1).trim();
        depotCsvAddress1 = depotCsvAddress1.slice(0, lastCommaIndex).trim();
      }
    }

    // No selected depot on this line item — export the row with empty depot
    // address fields rather than failing the whole export.

    const freightTotals = parseFreightTotalsFromShippingCode(snapshot?.shippingCode);
    const orderRef = String(baseRow.orderName || baseRow.orderId || "");
    const productRef = product || sku || "Freight item";
    const custOrderRef = buildFliwayCustOrderRef(orderRef, boxes, productRef);
    const depotInstructionLabel = resolvedDepotCity || fallbackDepot?.name || "";

    return [
      `CNDR${baseRow.orderName.replace(/[^a-zA-Z0-9]/g, "") || baseRow.orderId}`,
      customerName || baseRow.orderName,
      depotCsvAddress1,
      "",
      depotCsvSuburb,
      resolvedDepotZip,
      "RES",
      custOrderRef,
      mobilePhone || "",
      "",
      email,
      "N",
      "Carton",
      `${baseRow.orderName || baseRow.orderId} - ${productRef}`,
      boxes,
      freightTotals.weightKg,
      freightTotals.cubicM3,
      `Depot Collection${depotInstructionLabel ? ` - ${depotInstructionLabel}` : ""}`,
      "",
      DEFAULT_FROM.company,
      DEFAULT_FROM.address1,
      DEFAULT_FROM.address2,
      DEFAULT_FROM.suburb,
      DEFAULT_FROM.postcode,
      eddDate,
      email,
      email,
      email,
      "30002764",
    ];
  }

  if (carrier === "M2H") {
    const cleanOrderReference = String(baseRow.orderName || baseRow.orderId).replace(/[^a-zA-Z0-9]/g, "") || "000000";
    const senderRefBase = String(sku || product || "Freight item").trim();
    const senderRef = senderRefBase.length > 20 ? senderRefBase.slice(0, 20).trim() : senderRefBase;
    const receiverCode = "";
    const receiverName = customerName || baseRow.orderName;
    const receiverAddr1 = String(snapshot?.shippingAddress1 || address || "").trim();
    const receiverAddr2 = String(snapshot?.shippingAddress2 || "").trim();
    const receiverSuburb = String(snapshot?.shippingCity || city || "").trim();
    const receiverCity = String(snapshot?.shippingCity || city || "").trim();
    const receiverPostalCode = String(snapshot?.shippingZip || postalCode || "").trim();
    const receiverState = String(snapshot?.shippingProvince || snapshot?.shippingCity || "").trim();
    const receiverPhone = String(indexRow?.phone || snapshot?.phone || "").trim();
    const freightTotals = parseFreightTotalsFromShippingCode(snapshot?.shippingCode);
    const boxDimensions = await loadNzpBoxDimensions(shop, item.variantId);
    const deliveryInstructions = String(snapshot?.deliveryInstructions || "").trim();
    const senderCode = "CONDOOR14";
    const senderName = "Container Door";
    const senderAddr1 = "123 Pilkington Road";
    const senderAddr2 = "";
    const senderSuburb = "Panmure";
    const senderCity = "Auckland";
    const senderPostalCode = "1072";
    const senderState = "";
    const senderPhone = "09 526 5098";

    return [
      "1370981",
      `CDL${cleanOrderReference}`,
      "",
      "",
      "MF",
      "M2H",
      "LCL",
      senderRef,
      product || baseRow.orderName || "Freight item",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      senderCode,
      senderName,
      senderAddr1,
      senderAddr2,
      senderSuburb,
      senderCity,
      senderPostalCode,
      senderState,
      senderPhone,
      "",
      receiverCode,
      receiverName,
      receiverAddr1,
      receiverAddr2,
      receiverSuburb,
      receiverCity,
      receiverPostalCode,
      receiverState,
      receiverPhone,
      deliveryInstructions,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "1",
      "",
      String(boxes ?? 1),
      sku || product || "Freight item",
      "",
      "",
      boxDimensions.height || "",
      boxDimensions.width || "",
      boxDimensions.length || "",
      freightTotals.cubicM3,
      freightTotals.weightKg,
      email,
      "PickedUp;OnDeliveryVehicle;Delivered",
    ];
  }

  if (carrier === "NZP") {
    const serviceName = "CP Online Parcel";
    const tCode = "CPOLP";
    const freightTotals = parseFreightTotalsFromShippingCode(snapshot?.shippingCode);
    const shipmentDate = new Date().toLocaleDateString("en-NZ");
    const destinationBuilding = String((snapshot as any)?.shippingCompany || "").trim();
    const destinationSuburb = String(snapshot?.shippingAddress2 || snapshot?.shippingCity || city || "").trim();
    const destinationCity = String(snapshot?.shippingCity || city || "").trim();
    const destinationState = String(snapshot?.shippingProvince || "").trim();
    const phoneNumber = String(indexRow?.phone || snapshot?.phone || "").trim();
    const deliveryInstructions = String(snapshot?.deliveryInstructions || "").trim();
    const boxDimensions = await loadNzpBoxDimensions(shop, item.variantId);
    const packageHeight = boxDimensions.height;
    const packageWidth = boxDimensions.width;
    const packageLength = boxDimensions.length;
    const colour = String((indexRow as any)?.variantTitle || product || "").trim();
    const size = "";

    return [
      baseRow.orderName || baseRow.orderId,
      shipmentDate,
      customerName || baseRow.orderName,
      destinationBuilding,
      snapshot?.shippingAddress1 || address,
      destinationSuburb,
      destinationCity,
      snapshot?.shippingZip || postalCode,
      destinationState,
      "NZ",
      email,
      phoneNumber,
      product,
      amount,
      deliveryInstructions,
      freightTotals.weightKg,
      serviceName,
      baseRow.orderName || baseRow.orderId,
      sku,
      boxes,
      "Container Door",
      "Yes",
      "No",
      tCode,
      packageHeight || "",
      packageWidth || "",
      packageLength || "",
      "CourierPost",
      product,
      "Carton",
      "NZD",
      colour,
      size,
    ];
  }

  if (carrier === "NZP_AGE_RESTRICTED") {
    const serviceName = "NZ Post Age Restricted";
    const tCode = "CPOL18R";
    const freightTotals = parseFreightTotalsFromShippingCode(snapshot?.shippingCode);
    const shipmentDate = new Date().toLocaleDateString("en-NZ");
    const destinationBuilding = String((snapshot as any)?.shippingCompany || "").trim();
    const destinationSuburb = String(snapshot?.shippingAddress2 || snapshot?.shippingCity || city || "").trim();
    const destinationCity = String(snapshot?.shippingCity || city || "").trim();
    const destinationState = String(snapshot?.shippingProvince || "").trim();
    const phoneNumber = String(indexRow?.phone || snapshot?.phone || "").trim();
    const deliveryInstructions = String(snapshot?.deliveryInstructions || "").trim();
    const boxDimensions = await loadNzpBoxDimensions(shop, item.variantId);
    const packageHeight = boxDimensions.height;
    const packageWidth = boxDimensions.width;
    const packageLength = boxDimensions.length;
    const colour = String((indexRow as any)?.variantTitle || product || "").trim();
    const size = "";

    return [
      baseRow.orderName || baseRow.orderId,
      shipmentDate,
      customerName || baseRow.orderName,
      destinationBuilding,
      snapshot?.shippingAddress1 || address,
      destinationSuburb,
      destinationCity,
      snapshot?.shippingZip || postalCode,
      destinationState,
      "NZ",
      email,
      phoneNumber,
      product,
      amount,
      deliveryInstructions,
      freightTotals.weightKg,
      serviceName,
      baseRow.orderName || baseRow.orderId,
      sku,
      boxes,
      "Container Door",
      "Yes",
      "No",
      tCode,
      packageHeight || "",
      packageWidth || "",
      packageLength || "",
      "CourierPost",
      product,
      "Carton",
      "NZD",
      colour,
      size,
    ];
  }

  if (carrier === "CASTLE") {
    const deliveryReference = String(baseRow.orderId || baseRow.orderName || "").replace(/^#/, "").trim();
    const building = String((snapshot as any)?.shippingCompany || "").trim();
    const streetAddress = String(snapshot?.shippingAddress1 || address || "").trim();
    const suburb = String(snapshot?.shippingAddress2 || snapshot?.shippingCity || city || "").trim();
    const state = String(snapshot?.shippingProvince || snapshot?.shippingCity || city || "").trim();
    const phone = String(indexRow?.phone || snapshot?.phone || "").trim();
    const freightTotals = parseFreightTotalsFromShippingCode(snapshot?.shippingCode);
    const deliveryInstructions = String(snapshot?.deliveryInstructions || "").trim();

    return [
      deliveryReference,
      customerName || baseRow.orderName,
      building,
      streetAddress,
      suburb,
      state,
      snapshot?.shippingZip || postalCode,
      "NZ",
      customerName || baseRow.orderName,
      phone,
      product,
      "NZD",
      amount,
      freightTotals.cubicM3,
      freightTotals.weightKg,
      "",
      "",
      "",
      "",
      email,
      deliveryInstructions,
      "",
      "",
    ];
  }

  return [
    baseRow.orderName || baseRow.orderId,
    customerName || baseRow.orderName,
    address,
    city,
    postalCode,
    product,
    sku,
    boxes,
    tracking,
    freightRef,
    eddDate,
    carrier,
  ];
}

function isSupportedCarrier(carrier: string): carrier is FreightCsvCarrier {
  return FREIGHT_CSV_CARRIERS.includes(carrier as FreightCsvCarrier);
}

export type FreightCsvExportSkipped = {
  orderId: string;
  variantId: string;
  error: string;
};

export async function exportFreightCsv(shop: string, carrier: string, items: FreightCsvExportItem[]) {
  if (!items.length) {
    throw new Error("No operational line items selected for export");
  }

  if (!isSupportedCarrier(carrier)) {
    throw new Error(`Unsupported freight CSV carrier: ${carrier}`);
  }

  const csvHeaders =
    carrier === "CASTLE"
      ? EXPORT_TEMPLATE[carrier]
      : carrier === "FLIWAYLINEHAUL" || carrier === "FLIWAYMIDSIZE" || carrier === "FLIWAYDEPOT" || carrier === "NZP" || carrier === "NZP_AGE_RESTRICTED" || carrier === "M2H"
        ? EXPORT_TEMPLATE[carrier]
        : [...EXPORT_TEMPLATE[carrier], "Carrier"];
  const rows = [csvHeaders];
  const skipped: FreightCsvExportSkipped[] = [];

  for (const item of items) {
    let record: string[];
    try {
      record = await buildExportRow(shop, item, carrier);
    } catch (error) {
      // A single unusable line item (e.g. no selected Fliway depot) must not
      // abort the whole export — skip it and let the caller report it.
      skipped.push({
        orderId: String(item.orderId),
        variantId: String(item.variantId),
        error: error instanceof Error ? error.message : "Export row failed",
      });
      continue;
    }
    const nextRow =
      carrier === "CASTLE"
        ? record
        : carrier === "FLIWAYLINEHAUL" || carrier === "FLIWAYMIDSIZE" || carrier === "FLIWAYDEPOT" || carrier === "NZP" || carrier === "NZP_AGE_RESTRICTED" || carrier === "M2H"
          ? record
          : [...record, toCarrierCompanyLabel(carrier)];
    rows.push(nextRow);
  }

  if (skipped.length && skipped.length === items.length) {
    // Nothing could be exported — surface the underlying reason.
    throw new Error(skipped[0]?.error || "No selected line items could be exported");
  }

  return {
    csv: rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n"),
    skipped,
  };
}

function findMatchingOmsRecord(shop: string, row: Record<string, string>, carrier: FreightCsvCarrier) {
  const refCandidates = [
    getOrderReference(row),
    row["purchaseid"],
    row["deliveryreference"],
    row["custorderref"],
    row["reference"],
    row["senderref"],
    row["receiverref"],
    row["mftid"],
    row["consignmentnotenumber"],
    row["code"],
  ].filter(Boolean);

  return Promise.all(
    refCandidates.map(async (candidate) => {
      const trimmed = String(candidate).trim();
      const matches = await prisma.$queryRaw<any[]>`
        SELECT idx."orderId", idx."variantId", idx."orderName", idx."customerName", idx."sku", idx."productTitle", idx."company"
        FROM "OrderLineItemIndex" idx
        WHERE idx."shop" = ${shop}
          AND (
            lower(idx."orderName") = lower(${trimmed})
            OR lower(idx."orderName") LIKE lower(${`%${trimmed}%`})
            OR lower(idx."customerName") LIKE lower(${`%${trimmed}%`})
            OR lower(idx."sku") LIKE lower(${`%${trimmed}%`})
            OR lower(idx."productTitle") LIKE lower(${`%${trimmed}%`})
          )
        ORDER BY idx."createdAt" DESC
        LIMIT 10
      `;
      return matches;
    }),
  ).then((results) => {
    const flat = results.flat();
    const unique = new Map<string, any>();
    for (const item of flat) {
      unique.set(`${item.orderId}:${item.variantId}`, item);
    }
    return [...unique.values()].slice(0, 10);
  });
}

export async function previewFreightCsvImport(shop: string, carrier: string, csvText: string) {
  if (!isSupportedCarrier(carrier)) {
    return {
      ok: false,
      validRows: 0,
      invalidRows: 0,
      rowsUpdated: 0,
      errors: [`Unsupported freight carrier type: ${carrier}`],
      previewRows: [],
    };
  }

  const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    return {
      ok: false,
      validRows: 0,
      invalidRows: 0,
      rowsUpdated: 0,
      errors: ["CSV is empty or missing header and row data"],
      previewRows: [],
    };
  }

  const headers = parseCsvLine(lines[0]);
  const headerMap = new Map<string, string>();
  for (const [index, header] of headers.entries()) {
    headerMap.set(normalizeHeader(header), String(index));
  }

  const requiredHeaders = EXPORT_TEMPLATE[carrier].map((header) => normalizeHeader(header));
  const missing = requiredHeaders.filter((header) => !headerMap.has(header));
  if (missing.length) {
    return {
      ok: false,
      validRows: 0,
      invalidRows: lines.length - 1,
      rowsUpdated: 0,
      errors: [`Missing required CSV columns: ${missing.join(", ")}`],
      previewRows: [],
    };
  }

  const previewRows: Array<{ index: number; orderName: string; match: string; tracking: string; carrier: string; valid: boolean; errors: string[]; }> = [];
  let validRows = 0;
  let invalidRows = 0;

  for (let index = 1; index < lines.length; index++) {
    const cells = parseCsvLine(lines[index]);
    const row: Record<string, string> = {};
    for (const [header, rawIndex] of headerMap.entries()) {
      row[header] = cells[Number(rawIndex)] ?? "";
    }

    const orderReference = getOrderReference(row);
    const tracking = getTracking(row);
    const orderLabel = orderReference || tracking || `row ${index}`;
    const errors: string[] = [];

    if (!orderReference) {
      errors.push("Missing order/reference identifier");
    }

    let match = "unmatched";
    if (orderReference) {
      const candidateMatches = await findMatchingOmsRecord(shop, row, carrier);
      if (candidateMatches.length === 1) {
        match = `${candidateMatches[0].orderId}:${candidateMatches[0].variantId}`;
      } else if (candidateMatches.length > 1) {
        match = `${candidateMatches.length} possible matches`;
      } else {
        errors.push("No matching OMS order/line item found");
      }
    }

    const valid = errors.length === 0;
    if (valid) validRows += 1; else invalidRows += 1;

    previewRows.push({
      index,
      orderName: orderLabel,
      match,
      tracking: tracking || "",
      carrier,
      valid,
      errors,
    });
  }

  return {
    ok: validRows > 0 && invalidRows === 0,
    validRows,
    invalidRows,
    rowsUpdated: validRows,
    errors: previewRows.filter((row) => !row.valid).flatMap((row) => row.errors.map((err) => `Row ${row.index}: ${err}`)),
    previewRows,
  };
}

export async function applyFreightCsvImport(shop: string, carrier: string, csvText: string) {
  const preview = await previewFreightCsvImport(shop, carrier, csvText);
  if (!preview.ok) {
    return { ok: false, applied: 0, errors: preview.errors, preview };
  }

  const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");
  const headers = parseCsvLine(lines[0]);
  const headerMap = new Map<string, string>();
  for (const [index, header] of headers.entries()) {
    headerMap.set(normalizeHeader(header), String(index));
  }

  let applied = 0;
  const errors: string[] = [];

  for (let index = 1; index < lines.length; index++) {
    const cells = parseCsvLine(lines[index]);
    const row: Record<string, string> = {};
    for (const [header, rawIndex] of headerMap.entries()) {
      row[header] = cells[Number(rawIndex)] ?? "";
    }

    const refCandidate = getOrderReference(row);
    if (!refCandidate) {
      errors.push(`Row ${index}: Missing order reference; skipped`);
      continue;
    }

    const matches = await findMatchingOmsRecord(shop, row, carrier as FreightCsvCarrier);
    if (matches.length !== 1) {
      errors.push(`Row ${index}: No unique OMS match found; skipped`);
      continue;
    }

    const match = matches[0];
    const updateData: Record<string, string> = {
      carrier: carrier,
    };
    const tracking = getTracking(row);
    if (tracking) updateData.trackingNumber = tracking;
    const freightRef = row["reference"] || row["receiverref"] || row["senderref"] || "";
    if (freightRef) updateData.freightRef = freightRef;
    const edd = row["readydate"] || row["date"] || row["consignmentdate"] || "";
    if (edd) updateData.eddDate = edd;

    try {
      await prisma.orderLineItemOperationalData.update({
        where: {
          shop_orderId_variantId: {
            shop,
            orderId: match.orderId,
            variantId: match.variantId,
          },
        },
        data: {
          carrier: carrier as CarrierCompany,
          ...(updateData.trackingNumber ? { trackingNumber: updateData.trackingNumber } : {}),
          ...(updateData.freightRef ? { freightRef: updateData.freightRef } : {}),
          ...(updateData.eddDate ? { eddDate: updateData.eddDate } : {}),
        },
      });
      applied += 1;
    } catch (error) {
      errors.push(`Row ${index}: ${error instanceof Error ? error.message : "Update failed"}`);
    }
  }

  return {
    ok: applied > 0 && errors.length === 0,
    applied,
    errors,
    preview,
  };
}

export function getFreightCsvCarrierLabel(carrier: string) {
  return csvLabelMap[carrier as FreightCsvCarrier] ?? carrier;
}
