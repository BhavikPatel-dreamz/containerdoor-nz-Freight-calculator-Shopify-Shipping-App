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
  parseDecimalStringFull,
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
  | "minimumCharge"
  | "homeDeliveryFee"
  | "signatureSurcharge"
  | "ruralSurcharge"
  | "ageRestrictedSurcharge"
  | "mode"
  | "baseFee"
  | "transportCost"
>;

 
export type FreightPackage = {
  variantId?: string;
  quantity: number;
  company: CarrierCompany;
  weightGrams: number;
  volumeCm3: number;
  boxes: number;
  hiabRequired: boolean;
  homeDelivery: boolean;
  nzpSignature: boolean;
  nzpRural: boolean;
  nzpAgeRestricted: boolean;
  castleSignature: boolean;
  castleRural: boolean;
  castleWaiheke: boolean;
};

export type CalculatedServiceRate = {
  serviceType: ServiceType;
  total: number;
  currency: string;
  packageCount: number;
  companies: CarrierCompany[];
  // NEW: per-variant breakdown for internal visibility
  lineItemBreakdown: Array<{
    variantId: string;
    company: CarrierCompany;
    amount: number;
    boxes: number;
  }>;
};

export async function getAppSettings(shop: string) {
  return prisma.appSetting.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}

export async function updateAppSettings(shop: string, formData: FormData) {
  const data = {
    fuelSurchargePercent: parseDecimalString(formData.get("fuelSurchargePercent")),
    additionalCostType: String(formData.get("additionalCostType") || "FIXED") as CostType,
    additionalCostValue: parseDecimalString(formData.get("additionalCostValue")),
    defaultCurrency: String(formData.get("defaultCurrency") || "NZD").toUpperCase(),
    defaultServiceType: String(formData.get("defaultServiceType") || "STANDARD_DELIVERY") as ServiceType,
    // ADD THESE:
    fafFliway: parseDecimalString(formData.get("fafFliway")),
    fafFliwayMidsize: parseDecimalString(formData.get("fafFliwayMidsize")),
    fafMainfreight: parseDecimalString(formData.get("fafMainfreight")),
    fafTge: parseDecimalString(formData.get("fafTge")),
    fafM2h: parseDecimalString(formData.get("fafM2h")),
    tgeAdminFee: parseDecimalString(formData.get("tgeAdminFee")),
    homeDeliveryFeeFliway: parseDecimalString(formData.get("homeDeliveryFeeFliway")),
    homeDeliveryFeeFliwayMidsize: parseDecimalString(formData.get("homeDeliveryFeeFliwayMidsize")),
    homeDeliveryFeeTge: parseDecimalString(formData.get("homeDeliveryFeeTge")),
    mainfreightDepotFee: parseDecimalString(formData.get("mainfreightDepotFee")),
    marginRate: parseDecimalString(formData.get("marginRate")),
    gstRate: parseDecimalString(formData.get("gstRate")),  
  };

  return prisma.appSetting.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
}

export async function listRates(
  shop: string,
  page: number,
  filters?: {
    query?: string;
    company?: CarrierCompany | "";
    serviceType?: ServiceType | "";
  },
) {
  const take = 100;
  const skip = Math.max(page - 1, 0) * take;
  const query = filters?.query?.trim();
  const company = filters?.company || "";
  const serviceType = filters?.serviceType || "";
  const where = {
    shop,
    active: true,
    ...(company ? { company } : {}),
    ...(serviceType ? { serviceType } : {}),
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
  // load settings so computedTransportCost can use any carrier-specific depot fees
  const settings = await getAppSettings(shop);

  return {
    rates: rates.map((rate) => ({
      ...rate,
      rate: rate.rate.toString(),
      baseFee: (rate as any).baseFee?.toString() ?? "0",
      // If a transportCost is stored use that; otherwise compute an example transport cost
      transportCost: (rate as any).transportCost?.toString() ?? null,
      // Auto-computed transport cost example for CBM = 1.028 when volume-based
      computedTransportCost: (() => {
        const sampleCbm = 1.028;
        try {
          // If rate uses weight ranges we cannot compute a CBM-based example
          if (rate.useWeightRange) return null;
          const baseValue = sampleCbm; // CBM
          const baseFee = rate.company === "MAINFREIGHT" ? Number((rate as any).baseFee ?? 0) : 0;
          const depotFee = rate.company === "MAINFREIGHT" && rate.serviceType === "DEPOT_DELIVERY"
            ? Number((settings as any).mainfreightDepotFee ?? 25)
            : 0;
          const rawBaseFreight = (baseValue * Number(rate.rate)) + baseFee + depotFee;
          if (rate.company === "TGE") {
            const tgeMinCharge = Number(rate.zoneSurcharge ?? 0);
            const baseFreightTge = tgeMinCharge > 0 ? Math.max(rawBaseFreight, tgeMinCharge) : rawBaseFreight;
            return baseFreightTge.toFixed(2);
          }
          const rawTransportCost = rawBaseFreight + Number(rate.zoneSurcharge ?? 0);
          const minimumCharge = Number(rate.minimumCharge ?? 0);
          const baseFreight = minimumCharge > 0 ? Math.max(rawTransportCost, minimumCharge) : rawTransportCost;
          return baseFreight.toFixed(2);
        } catch (e) {
          return null;
        }
      })(),
      zoneSurcharge: rate.zoneSurcharge.toString(),
      minimumCharge: rate.minimumCharge.toString(),
      homeDeliveryFee: rate.homeDeliveryFee?.toString() ?? null,
      signatureSurcharge: rate.signatureSurcharge.toString(),
      ruralSurcharge: rate.ruralSurcharge.toString(),
      ageRestrictedSurcharge: rate.ageRestrictedSurcharge.toString(),
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

  if (!isServiceSupportedByCompany(data.company, data.serviceType)) {
    return {
      ok: false,
      message: "Depot delivery is only available for Fliway, Mainfreight, and Team Global Express.",
    };
  }

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
      "transportCost",
      "baseFee",
      "zoneSurcharge",
      "minimumCharge",
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
      ((rate as any).baseFee ?? 0).toString(),
      ((rate as any).transportCost ?? "").toString(),
      rate.zoneSurcharge.toString(),
      rate.minimumCharge.toString(),
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
    const minWeightGrams = toNullableInt(row.minWeightGrams);
    const maxWeightGrams = toNullableInt(row.maxWeightGrams);
    const minVolumeCm3 = toNullableInt(row.minVolumeCm3);
    const maxVolumeCm3 = toNullableInt(row.maxVolumeCm3);
    const useWeightRange = normaliseBoolean(row.useWeightRange);
    const useVolumeRange = normaliseBoolean(row.useVolumeRange);


    const data = {
      shop,
      company: normaliseEnum(row.company, carrierCompanies, "FLIWAYLINEHAUL"),
      serviceType: normaliseEnum(row.serviceType, serviceTypes, "STANDARD_DELIVERY"),
      city: row.city || "All",
      postalCode: row.postalCode || "*",
      useWeightRange,
      minWeightGrams,
      maxWeightGrams,
      useVolumeRange,
      minVolumeCm3,
      maxVolumeCm3,
      rate: parseDecimalStringFull(row.rate),
      baseFee: parseDecimalStringFull(row.baseFee ?? "0"),
      transportCost: row.transportCost ? parseDecimalStringFull(row.transportCost) : null,
      zoneSurcharge: parseDecimalStringFull(row.zoneSurcharge),
      minimumCharge: parseDecimalStringFull(row.minimumCharge ?? "0"),
      mode: row.mode ? normaliseEnum(row.mode, carrierModes, "ROAD") : null,
      active: row.active === "" ? true : normaliseBoolean(row.active),
    };
    if (!isServiceSupportedByCompany(data.company, data.serviceType)) {
      continue;
    }

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
            minWeightGrams: data.minWeightGrams,
            maxWeightGrams: data.maxWeightGrams,
            minVolumeCm3: data.minVolumeCm3,
            maxVolumeCm3: data.maxVolumeCm3,
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

  const packagesByVariant = new Map<string, FreightPackage[]>();
  for (const pkg of packages) {
    const key = pkg.variantId ?? "";
    const group = packagesByVariant.get(key) ?? [];
    group.push(pkg);
    packagesByVariant.set(key, group);
  }

  // For each service type, accumulate cheapest-per-variant totals
  // serviceType -> { total, packageCount, lineItems, coveredVariants }
  const serviceAccum = new Map<ServiceType, {
      total: number;
      packageCount: number;
      coveredVariants: number;
      lineItemBreakdown: Array<{
        variantId: string;
        company: CarrierCompany;
        amount: number;
        boxes: number;
      }>;
    }
  >();

  for (const [variantId, variantPackages] of packagesByVariant) {
    // For each serviceType, find the cheapest company across all packages for this variant
    // Each package in variantPackages has its own allowed company
    const bestByService = new Map<ServiceType, { company: CarrierCompany; amount: number; boxes: number }>();

    for (const freightPackage of variantPackages) {
      const matchedRates = await findMatchingRates(shop, destination, freightPackage);
      console.log(`[DEBUG] matched rate serviceTypes: ${matchedRates.map(r => r.serviceType).join(", ")}`);

      for (const matchedRate of matchedRates) {
        const amount = calculateFreightRate(freightPackage, matchedRate, settings);
        if (amount === null) continue;

        const current = bestByService.get(matchedRate.serviceType);
        if (!current || amount < current.amount) {
          bestByService.set(matchedRate.serviceType, {
            company: matchedRate.company,
            amount,
            boxes: freightPackage.boxes,
          });
        }
      }
    }

    // Accumulate into serviceAccum
    for (const [serviceType, best] of bestByService) {
      const existing = serviceAccum.get(serviceType) ?? {
        total: 0,
        packageCount: 0,
        coveredVariants: 0,
        lineItemBreakdown: [],
      };
      existing.total += best.amount;
      existing.packageCount += best.boxes;
      existing.coveredVariants += 1;
      existing.lineItemBreakdown.push({
        variantId,
        company: best.company,
        amount: best.amount,
        boxes: best.boxes,
      });
      serviceAccum.set(serviceType, existing);
    }
  }

  const completeServiceRates: CalculatedServiceRate[] = [];

  for (const [serviceType, accum] of serviceAccum) {
    // Only include if every variant is covered
    if (accum.coveredVariants !== packagesByVariant.size) continue;

    const companies = [...new Set(accum.lineItemBreakdown.map((l) => l.company))];

    completeServiceRates.push({
      serviceType,
      total: applySettings(accum.total, settings),
      currency: settings.defaultCurrency,
      packageCount: accum.packageCount,
      companies,
      lineItemBreakdown: accum.lineItemBreakdown,
    });
  }

  return completeServiceRates.sort((a, b) => a.serviceType.localeCompare(b.serviceType));
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
    },
  });


  console.log(`[DEBUG] findMatchingRates company:${freightPackage.company} volumeCm3:${freightPackage.volumeCm3} weightGrams:${freightPackage.weightGrams} postalCode:${postalCode} city:${city}`);
console.log(`[DEBUG] DB rates found for company: ${rates.length}`);

  return rates.filter((rate) => {
    const matchesWeight =
      !rate.useWeightRange ||
      ((rate.minWeightGrams === null || freightPackage.weightGrams >= rate.minWeightGrams) &&
        (rate.maxWeightGrams === null || freightPackage.weightGrams <= rate.maxWeightGrams));
    const matchesVolume =
      !rate.useVolumeRange ||
      ((rate.minVolumeCm3 === null || freightPackage.volumeCm3 >= rate.minVolumeCm3) &&
        (rate.maxVolumeCm3 === null || freightPackage.volumeCm3 <= rate.maxVolumeCm3));
    const matchesPostalCode =
      !postalCode || rate.postalCode === "*" || postalCodeInRange(postalCode, rate.postalCode);
    const matchesCity = !city || cityMatches(city, rate.city);
     console.log(`[DEBUG] rate id:${rate.id} matchesWeight:${matchesWeight} matchesVolume:${matchesVolume} matchesPostalCode:${matchesPostalCode} matchesCity:${matchesCity}`);

    return matchesWeight && matchesVolume && matchesPostalCode && matchesCity;
  });
}

function readRateForm(shop: string, formData: FormData) {
  const minWeightGrams = parseOptionalInt(formData.get("minWeightGrams"));
  const maxWeightGrams = parseOptionalInt(formData.get("maxWeightGrams"));
  const minVolumeCm3 = parseOptionalInt(formData.get("minVolumeCm3"));
  const maxVolumeCm3 = parseOptionalInt(formData.get("maxVolumeCm3")); 

  // FIX: Only use the checkbox value — do NOT auto-force true based on min/max presence
  const useWeightRange = parseBoolean(formData.get("useWeightRange"));
  const useVolumeRange = parseBoolean(formData.get("useVolumeRange"));

  return {
    shop,
    company: String(formData.get("company") || "FLIWAY") as CarrierCompany,
    serviceType: String(formData.get("serviceType") || "STANDARD_DELIVERY") as ServiceType,
    city: String(formData.get("city") || "").trim(),
    postalCode: String(formData.get("postalCode") || "*").trim(),
    useWeightRange,
    minWeightGrams,
    maxWeightGrams,
    useVolumeRange,
    minVolumeCm3,
    maxVolumeCm3,
    rate: parseDecimalString(formData.get("rate")),
    zoneSurcharge: parseDecimalString(formData.get("zoneSurcharge")),
    minimumCharge: parseDecimalString(formData.get("minimumCharge")),
    homeDeliveryFee: formData.get("homeDeliveryFee") !== "" && formData.get("homeDeliveryFee") !== null
      ? parseDecimalString(formData.get("homeDeliveryFee"))
      : null,
    signatureSurcharge: parseDecimalString(formData.get("signatureSurcharge")),
    ruralSurcharge: parseDecimalString(formData.get("ruralSurcharge")),
    ageRestrictedSurcharge: parseDecimalString(formData.get("ageRestrictedSurcharge")),
    baseFee: parseDecimalString(formData.get("baseFee")),
    transportCost: formData.get("transportCost") !== "" && formData.get("transportCost") !== null
      ? parseDecimalString(formData.get("transportCost"))
      : null,
    mode: formData.get("mode") ? (String(formData.get("mode")) as CarrierMode) : null,
    active: parseBoolean(formData.get("active")),
  };
}

function calculateFreightRate(freightPackage: FreightPackage, rate: RateCandidate, settings: AppSetting) {
  if (
    rate.serviceType === "DEPOT_DELIVERY" &&
    !freightFormula.depotCollectionCompanies.includes(rate.company)
  ) {
    return null;
  }

  if (rate.serviceType === "CUSTOMER_PICKUP") {
    return 0;
  }

  // NEW: NZP uses weight/CBM lookup table pricing
  if (rate.company === "NZP") {
    return calculateNzpRate(freightPackage, rate, settings);
  }

  // NEW: Castle Parcels uses CBM lookup table pricing
  if (rate.company === "CASTLE") {
    return calculateCastleRate(freightPackage, rate, settings);
  }

  // NEW: pick base value depending on which range the rate uses
  const baseValue = rate.useWeightRange
    ? freightPackage.weightGrams / 1000        // kg
    : freightPackage.volumeCm3 / 1_000_000;    // CBM
  const baseFee = rate.company === "MAINFREIGHT" ? Number((rate as any).baseFee ?? 0) : 0;

  const depotFee = rate.company === "MAINFREIGHT" && rate.serviceType === "DEPOT_DELIVERY"
    ? Number((settings as any).mainfreightDepotFee ?? 25)
    : 0;

  const rawBaseFreight = (baseValue * Number(rate.rate)) + baseFee + depotFee;
  const computedRawTransportCost = rawBaseFreight + (rate.company === "TGE" ? 0 : Number(rate.zoneSurcharge));
  // If a transportCost is stored on the rate, treat it as a user-provided override
  const storedTransport = (rate as any).transportCost !== null && (rate as any).transportCost !== undefined
    ? Number((rate as any).transportCost)
    : NaN;
  const rawTransportCost = Number.isFinite(storedTransport) ? storedTransport : computedRawTransportCost;
  const minimumCharge = Number(rate.minimumCharge ?? 0);
  const baseFreight = minimumCharge > 0 ? Math.max(rawTransportCost, minimumCharge) : rawTransportCost;
  const tgeMinCharge = rate.company === "TGE" ? Number(rate.zoneSurcharge) : 0;
  // For TGE, when a stored transport override exists we compare it against the TGE minimum,
  // otherwise fall back to the previous rawBaseFreight-based logic
  const baseFreightTge = Number.isFinite(storedTransport)
    ? (tgeMinCharge > 0 ? Math.max(storedTransport, tgeMinCharge) : storedTransport)
    : (tgeMinCharge > 0 ? Math.max(rawBaseFreight, tgeMinCharge) : rawBaseFreight);
  const adminFee = rate.company === "TGE" ? Number(settings.tgeAdminFee ?? 12.69) : 0;
  const resolvedHomeDeliveryFee =
  rate.homeDeliveryFee !== null && rate.homeDeliveryFee !== undefined
    ? Number(rate.homeDeliveryFee)
    : resolveHomeDeliveryFee(rate.company, settings);
const homeDeliveryFee =
  rate.serviceType === "STANDARD_DELIVERY" && resolvedHomeDeliveryFee > 0
    ? resolvedHomeDeliveryFee
    : 0;
  const fafRate = resolveFafRate(rate.company, settings);
  const effectiveBase = rate.company === "TGE" ? baseFreightTge : baseFreight;
  const withFaf = (effectiveBase + adminFee) * (1 + fafRate);
  const subtotal = withFaf + homeDeliveryFee;
  const marginRate = Number(settings.marginRate ?? 10) / 100;
  const gstRate = Number(settings.gstRate ?? 15) / 100;
  const withMargin = subtotal * (1 + marginRate);
  const final = withMargin * (1 + gstRate);

  console.log(`[CALC] rateId:${rate.id} serviceType:${rate.serviceType} company:${rate.company}`);
  console.log(`[CALC] baseValue:${baseValue} × rate:${rate.rate} = rawBaseFreight:${rawBaseFreight} rawTransport:${rawTransportCost} minCharge:${minimumCharge} → effectiveBase:${effectiveBase}`);
  console.log(`[CALC] adminFee:${adminFee} homeDeliveryFee:${homeDeliveryFee} fafRate:${fafRate}`);
  console.log(`[CALC] (${effectiveBase} + ${adminFee}) × ${1 + fafRate} = withFaf:${withFaf}`);
  console.log(`[CALC] withFaf:${withFaf} + homeDelivery:${homeDeliveryFee} = subtotal:${subtotal}`);
  console.log(`[CALC] subtotal:${subtotal} × margin:${1 + marginRate} = withMargin:${withMargin}`);
  console.log(`[CALC] withMargin:${withMargin} × gst:${1 + gstRate} = FINAL:${final}`);

  return final;
}

// NEW: NZP rate calculation
// rate.rate = base charge (max of kg-bracket and CBM-bracket rate, pre-stored)
// rate.zoneSurcharge = additional surcharges (rural, signature etc) pre-stored per zone row
function calculateNzpRate(freightPackage: FreightPackage, rate: RateCandidate, settings: AppSetting) {
  const baseCharge = Number(rate.rate);
  const signatureFee = freightPackage.nzpSignature ? Number(rate.signatureSurcharge) : 0;
  const ruralFee = freightPackage.nzpRural ? Number(rate.ruralSurcharge) : 0;
  const ageRestrictedFee = freightPackage.nzpAgeRestricted ? Number(rate.ageRestrictedSurcharge) : 0;
  const additionalCharges = signatureFee + ruralFee + ageRestrictedFee;
  console.log(`[NZP] base:${baseCharge} signature:${signatureFee} rural:${ruralFee} ageRestricted:${ageRestrictedFee}`);
  const subtotal = (baseCharge + additionalCharges) * (1 + freightFormula.nzp.totalVariableRate);
  const marginRate = Number(settings.marginRate ?? 10) / 100;
  const gstRate = Number(settings.gstRate ?? 15) / 100;
  const withMargin = subtotal * (1 + marginRate);
  return withMargin * (1 + gstRate);
}

// NEW: Castle Parcels rate calculation
// rate.rate = CBM bracket base charge
// rate.zoneSurcharge = additional surcharges (residential always, rural/signature/waiheke where applicable)
function calculateCastleRate(freightPackage: FreightPackage, rate: RateCandidate, settings: AppSetting) {
  const baseCharge = Number(rate.rate);
  const residentialFee = Number(rate.zoneSurcharge);
  const signatureFee = freightPackage.castleSignature ? 1.00 : 0;
  const ruralFee = freightPackage.castleRural ? 1.00 : 0;
  const waihekeFee = freightPackage.castleWaiheke ? 1.00 : 0;
  const subtotal = (baseCharge + residentialFee + signatureFee + ruralFee + waihekeFee)
    * (1 + freightFormula.castle.totalVariableRate);
  const marginRate = Number(settings.marginRate ?? 10) / 100;
  const gstRate = Number(settings.gstRate ?? 15) / 100;
  const withMargin = subtotal * (1 + marginRate);
  return withMargin * (1 + gstRate);
}

function applySettings(baseRate: number, settings: AppSetting) {
  // FAF is now applied per-carrier in calculateFreightRate via resolveFafRate.
  // fuelSurchargePercent is the fallback for NZP/CASTLE and is already applied there.
  // This function only applies the shop-level additional cost markup.
  if (settings.additionalCostType === "PERCENTAGE") {
    return baseRate + baseRate * (Number(settings.additionalCostValue) / 100);
  }
  return baseRate + Number(settings.additionalCostValue);
}

//resolve FAF rate for a carrier from DB settings, fall back to fuelSurchargePercent
export function resolveFafRate(company: CarrierCompany, settings: AppSetting): number {
  const carrierFafMap: Partial<Record<CarrierCompany, string>> = {
    FLIWAYLINEHAUL: "fafFliway",
    FLIWAYMIDSIZE:  "fafFliwayMidsize",
    MAINFREIGHT:    "fafMainfreight",
    TGE:            "fafTge",
    M2H:            "fafM2h",
  };
  const field = carrierFafMap[company];
  if (field && field in settings) {
    return Number((settings as unknown as Record<string, unknown>)[field]) / 100;
  }
  // NZP, CASTLE, and any future carriers fall back to fuelSurchargePercent
  return Number(settings.fuelSurchargePercent) / 100;
}

// Resolve global home delivery fee for a carrier from DB settings
export function resolveHomeDeliveryFee(company: CarrierCompany, settings: AppSetting): number {
  const map: Partial<Record<CarrierCompany, string>> = {
    FLIWAYLINEHAUL: "homeDeliveryFeeFliway",
    FLIWAYMIDSIZE:  "homeDeliveryFeeFliwayMidsize",
    TGE:            "homeDeliveryFeeTge",
  };
  const field = map[company];
  if (field && field in settings) {
    return Number((settings as unknown as Record<string, unknown>)[field]);
  }
  return 0;
}

function postalCodeInRange(postalCode: string, range: string) {
  if (range === "*" || range === postalCode) return true;
  const [start, end] = range.split("-").map((part) => Number.parseInt(part.trim(), 10));
  const numericPostalCode = Number.parseInt(postalCode.trim(), 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(numericPostalCode)) {
    return false;
  }
  return numericPostalCode >= start && numericPostalCode <= end;
}

function cityMatches(destinationCity: string, rateCity: string) {
  const normalisedRateCity = rateCity.trim().toLowerCase();
  if (!normalisedRateCity || normalisedRateCity === "*" || normalisedRateCity === "all") {
    return true;
  }
  return destinationCity.trim().toLowerCase() === normalisedRateCity;
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

function isServiceSupportedByCompany(company: CarrierCompany, serviceType: ServiceType) {
  return (
    serviceType !== "DEPOT_DELIVERY" ||
    freightFormula.depotCollectionCompanies.includes(company)
  );
}
