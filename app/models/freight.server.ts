import type {
  AppSetting,
  CarrierCompany,
  CarrierMode,
  CostType,
  ServiceType,
  ShippingRate,
} from "@prisma/client";
import prisma from "../db.server";
import {
  carrierCompanies,
  carrierModes,
  freightFormula,
  parseBoolean,
  parseDecimalString,
  parseOptionalInt,
  serviceTypes,
} from "../lib/freight";

export type RateFormResult = {
  ok: boolean;
  message: string;
};

export type RateCandidate = Pick<
  ShippingRate,
  | "id"
  | "company"
  | "serviceType"
  | "city"
  | "postalCode"
  | "useWeightRange"
  | "minWeightGrams"
  | "maxWeightGrams"
  | "useVolumeRange"
  | "minVolumeCm3"
  | "maxVolumeCm3"
  | "rate"
  | "zoneSurcharge"
  | "mode"
>;

export type FreightPackage = {
  variantId?: string;
  quantity: number;
  company: CarrierCompany;
  weightGrams: number;
  volumeCm3: number;
  boxes: number;
  hiabRequired: boolean;
};

export type CalculatedServiceRate = {
  serviceType: ServiceType;
  total: number;
  currency: string;
  packageCount: number;
  companies: CarrierCompany[];
};

export async function getAppSettings(shop: string) {
  return prisma.appSetting.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}

export async function updateAppSettings(shop: string, formData: FormData) {
  return prisma.appSetting.upsert({
    where: { shop },
    update: {
      fuelSurchargePercent: parseDecimalString(formData.get("fuelSurchargePercent")),
      additionalCostType: String(formData.get("additionalCostType") || "FIXED") as CostType,
      additionalCostValue: parseDecimalString(formData.get("additionalCostValue")),
      defaultCurrency: String(formData.get("defaultCurrency") || "NZD").toUpperCase(),
      defaultServiceType: String(formData.get("defaultServiceType") || "STANDARD_DELIVERY") as ServiceType,
    },
    create: {
      shop,
      fuelSurchargePercent: parseDecimalString(formData.get("fuelSurchargePercent")),
      additionalCostType: String(formData.get("additionalCostType") || "FIXED") as CostType,
      additionalCostValue: parseDecimalString(formData.get("additionalCostValue")),
      defaultCurrency: String(formData.get("defaultCurrency") || "NZD").toUpperCase(),
      defaultServiceType: String(formData.get("defaultServiceType") || "STANDARD_DELIVERY") as ServiceType,
    },
  });
}

export async function listRates(shop: string, page: number, query?: string) {
  const take = 25;
  const skip = Math.max(page - 1, 0) * take;
  const where = {
    shop,
    active: true,
    ...(query
      ? {
          OR: [
            { city: { contains: query, mode: "insensitive" as const } },
            { postalCode: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rates, total] = await Promise.all([
    prisma.shippingRate.findMany({
      where,
      orderBy: [{ company: "asc" }, { serviceType: "asc" }, { city: "asc" }],
      take,
      skip,
    }),
    prisma.shippingRate.count({ where }),
  ]);

  return {
    rates: rates.map((rate) => ({
      ...rate,
      rate: rate.rate.toString(),
      zoneSurcharge: rate.zoneSurcharge.toString(),
      createdAt: rate.createdAt.toISOString(),
      updatedAt: rate.updatedAt.toISOString(),
    })),
    total,
    page,
    pageCount: Math.max(Math.ceil(total / take), 1),
  };
}

export async function upsertRate(shop: string, formData: FormData) {
  const id = String(formData.get("id") || "");
  const data = readRateForm(shop, formData);

  if (id) {
    await prisma.shippingRate.update({ where: { id, shop }, data });
    return { ok: true, message: "Rate updated" };
  }

  await prisma.shippingRate.create({ data });
  return { ok: true, message: "Rate added" };
}

export async function deleteRate(shop: string, id: string) {
  await prisma.shippingRate.deleteMany({ where: { id, shop } });
  return { ok: true, message: "Rate deleted" };
}

export async function exportRatesCsv(shop: string) {
  const rates = await prisma.shippingRate.findMany({
    where: { shop },
    orderBy: [{ company: "asc" }, { serviceType: "asc" }, { city: "asc" }],
  });

  const rows = [
    [
      "company",
      "serviceType",
      "city",
      "postalCode",
      "useWeightRange",
      "minWeightGrams",
      "maxWeightGrams",
      "useVolumeRange",
      "minVolumeCm3",
      "maxVolumeCm3",
      "rate",
      "zoneSurcharge",
      "mode",
      "active",
      "id",
    ],
    ...rates.map((rate) => [
      rate.company,
      rate.serviceType,
      rate.city,
      rate.postalCode,
      String(rate.useWeightRange),
      rate.minWeightGrams ?? "",
      rate.maxWeightGrams ?? "",
      String(rate.useVolumeRange),
      rate.minVolumeCm3 ?? "",
      rate.maxVolumeCm3 ?? "",
      rate.rate.toString(),
      rate.zoneSurcharge.toString(),
      rate.mode ?? "",
      String(rate.active),
      rate.id,
    ]),
  ];

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export async function importRatesCsv(shop: string, csv: string) {
  const [headerLine, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return { ok: false, message: "CSV is empty" };

  const headers = parseCsvLine(headerLine);
  let created = 0;
  let updated = 0;

  for (const line of lines) {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    const data = {
      shop,
      company: normaliseEnum(row.company, carrierCompanies, "FLIWAY"),
      serviceType: normaliseEnum(row.serviceType, serviceTypes, "STANDARD_DELIVERY"),
      city: row.city || "All",
      postalCode: row.postalCode || "*",
      useWeightRange: normaliseBoolean(row.useWeightRange),
      minWeightGrams: toNullableInt(row.minWeightGrams),
      maxWeightGrams: toNullableInt(row.maxWeightGrams),
      useVolumeRange: normaliseBoolean(row.useVolumeRange),
      minVolumeCm3: toNullableInt(row.minVolumeCm3),
      maxVolumeCm3: toNullableInt(row.maxVolumeCm3),
      rate: parseDecimalString(row.rate),
      zoneSurcharge: parseDecimalString(row.zoneSurcharge),
      mode: row.mode ? normaliseEnum(row.mode, carrierModes, "ROAD") : null,
      active: row.active === "" ? true : normaliseBoolean(row.active),
    };
    const existing = row.id
      ? await prisma.shippingRate.findFirst({ where: { id: row.id, shop } })
      : await prisma.shippingRate.findFirst({
          where: {
            shop,
            company: data.company,
            serviceType: data.serviceType,
            city: data.city,
            postalCode: data.postalCode,
            mode: data.mode,
          },
        });

    if (existing) {
      await prisma.shippingRate.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.shippingRate.create({ data });
      created += 1;
    }
  }

  return { ok: true, message: `${created} rates created, ${updated} rates updated` };
}

export async function calculateServiceRates(
  shop: string,
  destination: { city?: string; postalCode?: string },
  packages: FreightPackage[],
) {
  const settings = await getAppSettings(shop);
  const serviceTotals = new Map<ServiceType, CalculatedServiceRate>();

  for (const freightPackage of packages) {
    const matchedRates = await findMatchingRates(shop, destination, freightPackage);
    for (const matchedRate of matchedRates) {
      const adjusted = calculateFreightRate(freightPackage, matchedRate);
      if (adjusted === null) continue;
      const existing = serviceTotals.get(matchedRate.serviceType) ?? {
        serviceType: matchedRate.serviceType,
        total: 0,
        currency: settings.defaultCurrency,
        packageCount: 0,
        companies: [],
      };
      existing.total += applySettings(adjusted, settings);
      existing.packageCount += freightPackage.boxes;
      if (!existing.companies.includes(matchedRate.company)) {
        existing.companies.push(matchedRate.company);
      }
      serviceTotals.set(matchedRate.serviceType, existing);
    }
  }

  return [...serviceTotals.values()].sort((left, right) =>
    left.serviceType.localeCompare(right.serviceType),
  );
}

export async function findMatchingRates(
  shop: string,
  destination: { city?: string; postalCode?: string },
  freightPackage: FreightPackage,
) {
  const city = destination.city?.trim();
  const postalCode = destination.postalCode?.trim();

  const rates = await prisma.shippingRate.findMany({
    where: {
      shop,
      active: true,
      company: freightPackage.company,
      OR: [
        { city: { equals: city || "", mode: "insensitive" } },
        { postalCode: postalCode || "" },
        { postalCode: "*" },
      ],
    },
  });

  return rates.filter((rate) => {
    const matchesWeight =
      !rate.useWeightRange ||
      ((rate.minWeightGrams === null || freightPackage.weightGrams >= rate.minWeightGrams) &&
        (rate.maxWeightGrams === null || freightPackage.weightGrams <= rate.maxWeightGrams));
    const matchesVolume =
      !rate.useVolumeRange ||
      ((rate.minVolumeCm3 === null || freightPackage.volumeCm3 >= rate.minVolumeCm3) &&
        (rate.maxVolumeCm3 === null || freightPackage.volumeCm3 <= rate.maxVolumeCm3));
    const matchesPostalCode = !postalCode || rate.postalCode === "*" || postalCodeInRange(postalCode, rate.postalCode);

    return matchesWeight && matchesVolume && matchesPostalCode;
  });
}

function readRateForm(shop: string, formData: FormData) {
  const useWeightRange = parseBoolean(formData.get("useWeightRange"));
  const useVolumeRange = parseBoolean(formData.get("useVolumeRange"));

  return {
    shop,
    company: String(formData.get("company") || "FLIWAY") as CarrierCompany,
    serviceType: String(formData.get("serviceType") || "STANDARD_DELIVERY") as ServiceType,
    city: String(formData.get("city") || "").trim(),
    postalCode: String(formData.get("postalCode") || "*").trim(),
    useWeightRange,
    minWeightGrams: useWeightRange ? parseOptionalInt(formData.get("minWeightGrams")) : null,
    maxWeightGrams: useWeightRange ? parseOptionalInt(formData.get("maxWeightGrams")) : null,
    useVolumeRange,
    minVolumeCm3: useVolumeRange ? parseOptionalInt(formData.get("minVolumeCm3")) : null,
    maxVolumeCm3: useVolumeRange ? parseOptionalInt(formData.get("maxVolumeCm3")) : null,
    rate: parseDecimalString(formData.get("rate")),
    zoneSurcharge: parseDecimalString(formData.get("zoneSurcharge")),
    mode: formData.get("mode") ? (String(formData.get("mode")) as CarrierMode) : null,
    active: parseBoolean(formData.get("active")),
  };
}

function calculateFreightRate(freightPackage: FreightPackage, rate: RateCandidate) {
  if (
    rate.serviceType === "DEPOT_DELIVERY" &&
    !freightFormula.depotCollectionCompanies.includes(rate.company)
  ) {
    return null;
  }

  if (rate.serviceType === "CUSTOMER_PICKUP") {
    return 0;
  }

  const cbm = freightPackage.volumeCm3 / 1_000_000;
  const baseFreight = cbm * Number(rate.rate);
  const zoneSurcharge = rate.serviceType === "STANDARD_DELIVERY" ? Number(rate.zoneSurcharge) : 0;
  const homeDeliveryFee =
    rate.serviceType === "STANDARD_DELIVERY"
      ? freightFormula.homeDeliveryFees[rate.company] ?? 0
      : 0;
  const subtotal = baseFreight + zoneSurcharge + homeDeliveryFee;
  const withMargin = subtotal * (1 + freightFormula.marginRate);

  return withMargin * (1 + freightFormula.gstRate);
}

function applySettings(baseRate: number, settings: AppSetting) {
  const withFuel = baseRate + baseRate * (Number(settings.fuelSurchargePercent) / 100);
  if (settings.additionalCostType === "PERCENTAGE") {
    return withFuel + withFuel * (Number(settings.additionalCostValue) / 100);
  }
  return withFuel + Number(settings.additionalCostValue);
}

function postalCodeInRange(postalCode: string, range: string) {
  if (range === "*" || range === postalCode) return true;
  const [start, end] = range.split("-").map((part) => Number.parseInt(part.trim(), 10));
  const numericPostalCode = Number.parseInt(postalCode, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(numericPostalCode)) {
    return false;
  }
  return numericPostalCode >= start && numericPostalCode <= end;
}

function escapeCsvCell(value: unknown) {
  const cell = String(value ?? "");
  if (!/[",\n]/.test(cell)) return cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  cells.push(current);
  return cells;
}

function normaliseEnum<T extends string>(value: string | undefined, values: readonly T[], fallback: T) {
  const normalised = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return values.includes(normalised as T) ? (normalised as T) : fallback;
}

function toNullableInt(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseBoolean(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}
