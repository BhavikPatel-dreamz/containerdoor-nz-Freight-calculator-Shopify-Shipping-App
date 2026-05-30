import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import {
  carrierCompanies,
  carrierModes,
  companyLabels,
  modeLabels,
  serviceLabels,
  serviceTypes,
  toMoney,
} from "../lib/freight";
import { deleteRate, importRatesCsv, listRates, upsertRate } from "../models/freight.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const query = url.searchParams.get("q") || "";
  const companyParam = url.searchParams.get("company") || "";
  const serviceTypeParam = url.searchParams.get("serviceType") || "";

  const company = carrierCompanies.includes(companyParam as (typeof carrierCompanies)[number])
    ? companyParam
    : "";
  const serviceType = serviceTypes.includes(serviceTypeParam as (typeof serviceTypes)[number])
    ? serviceTypeParam
    : "";

  return listRates(session.shop, page, {
    query,
    company: company as "" | (typeof carrierCompanies)[number],
    serviceType: serviceType as "" | (typeof serviceTypes)[number],
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "save");

  if (intent === "delete") {
    return deleteRate(session.shop, String(formData.get("id")));
  }

  if (intent === "bulkDelete") {
    const ids = formData.getAll("ids").map(String);
    await Promise.all(ids.map((id) => deleteRate(session.shop, id)));
    return { ok: true, message: `${ids.length} rates deleted` };
  }

  if (intent === "import") {
    const file = formData.get("csv");
    if (!(file instanceof File)) return { ok: false, message: "Choose a CSV file" };
    return importRatesCsv(session.shop, await file.text());
  }

  return upsertRate(session.shop, formData);
};

export default function RatesPage() {
  const { rates, page, pageCount, total } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const query = searchParams.get("q") || "";
  const selectedCompany = searchParams.get("company") || "";
  const selectedServiceType = searchParams.get("serviceType") || "";
  const isSubmitting = navigation.state === "submitting";

  const buildPageLink = (nextPage: number) => {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    if (query) params.set("q", query);
    if (selectedCompany) params.set("company", selectedCompany);
    if (selectedServiceType) params.set("serviceType", selectedServiceType);
    return `/app/rates?${params.toString()}`;
  };

  return (
    <s-page inlineSize="large" heading="Rate management">
      <style>{`
        .top-row {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-bottom: 12px;
          flex-wrap: wrap;
        }
        .top-btn {
          border: 1px solid #d4dce4;
          border-radius: 10px;
          background: #fff;
          color: #0f2a43;
          padding: 8px 14px;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(15, 42, 67, 0.08);
        }
        .import-btn {
          position: relative;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .import-btn input[type="file"] {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }
        .add-wrap {
          border: 1px solid #dce5ef;
          border-radius: 12px;
          background: #f8fbff;
          padding: 14px;
          margin-bottom: 12px;
        }
        .rates-card {
          border: 1px solid #dce5ef;
          border-radius: 12px;
          background: #fff;
          overflow: hidden;
        }
        .rates-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid #e8eef4;
        }
        .rates-title {
          margin: 0;
          color: #0f2a43;
          font-size: 22px;
          font-weight: 700;
        }
        .summary {
          margin: 0;
          color: #486581;
          font-size: 14px;
          white-space: nowrap;
        }
        .toolbar {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          padding: 12px 16px;
          border-bottom: 1px solid #e8eef4;
        }
        .search-form {
          display: grid;
          gap: 10px;
          grid-template-columns: 2fr 1fr 1fr auto;
          flex: 1;
        }
        .search-form input,
        .search-form select,
        .rates-table input,
        .rates-table select,
        .grid-form input,
        .grid-form select {
          width: 100%;
          border: 1px solid #d3dde8;
          border-radius: 10px;
          padding: 9px 12px;
          min-height: 36px;
          box-sizing: border-box;
        }
        .table-wrap {
          width: 100%;
          overflow-x: auto;
        }
        .rates-table {
          width: 100%;
          min-width: 1320px;
          border-collapse: collapse;
          font-size: 14px;
        }
        .rates-table th,
        .rates-table td {
          border-bottom: 1px solid #eef3f8;
          padding: 12px 10px;
          vertical-align: top;
          white-space: nowrap;
        }
        .rates-table th {
          color: #486581;
          font-weight: 700;
          background: #fff;
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .range-col {
          display: grid;
          gap: 6px;
          grid-auto-flow: column;
        }
        .checkbox-row {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #52606d;
        }
        .inline-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .plain-save {
          border: 1px solid #d3dde8;
          background: #fff;
          color: #102a43;
          border-radius: 10px;
          padding: 8px 12px;
          font-weight: 600;
          height: 36px;
          cursor: pointer;
        }
        .pager {
          display: flex;
          gap: 10px;
          padding: 12px 16px;
        }
        .pager a {
          text-decoration: none;
          border: 1px solid #d3dde8;
          border-radius: 999px;
          padding: 6px 12px;
          color: #243b53;
          font-size: 14px;
        }
        .grid-form {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        }
        .grid-form label {
          display: grid;
          gap: 6px;
          color: #455a64;
          font-size: 13px;
        }
        @media (max-width: 980px) {
          .rates-head {
            flex-direction: column;
            align-items: flex-start;
          }
          .search-form {
            grid-template-columns: 1fr;
          }
          .toolbar {
            display: grid;
          }
        }
      `}</style>

      {actionData?.message ? (
        <s-banner tone={actionData.ok ? "success" : "critical"}>{actionData.message}</s-banner>
      ) : null}

      <div className="top-row">
        {selectedIds.size > 0 ? (
          <Form method="post" onSubmit={() => setSelectedIds(new Set())}>
            <input type="hidden" name="intent" value="bulkDelete" />
            {[...selectedIds].map((id) => (
              <input key={id} type="hidden" name="ids" value={id} />
            ))}
            <button className="top-btn" type="submit" style={{ color: "#c0392b", borderColor: "#c0392b" }}>
              🗑 Delete selected ({selectedIds.size})
            </button>
          </Form>
        ) : null}
        <button className="top-btn" type="button" onClick={() => setShowAddForm((value) => !value)}>
          + {showAddForm ? "Close add rate" : "Add rate"}
        </button>
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="import" />
          <label className="top-btn import-btn">
            Import CSV
            <input
              type="file"
              name="csv"
              accept=".csv,text/csv"
              onChange={(event) => {
                if (event.currentTarget.files?.length) {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>
        </Form>
      </div>

      {showAddForm ? (
        <div className="add-wrap">
          <RateForm />
        </div>
      ) : null}

      <div className="rates-card">
        <div className="rates-head">
          <h2 className="rates-title">Rates list</h2>
          <p className="summary">
            {total} active rates · page {page} of {pageCount}
          </p>
        </div>

        <div className="toolbar">
          <Form method="get" className="search-form">
            <input name="q" placeholder="Search city or postal code" defaultValue={query} />
            <select name="company" defaultValue={selectedCompany}>
              <option value="">All companies</option>
              {carrierCompanies.map((company) => (
                <option key={company} value={company}>
                  {companyLabels[company]}
                </option>
              ))}
            </select>
            <select name="serviceType" defaultValue={selectedServiceType}>
              <option value="">All services</option>
              {serviceTypes.map((serviceType) => (
                <option key={serviceType} value={serviceType}>
                  {serviceLabels[serviceType]}
                </option>
              ))}
            </select>
            <s-button type="submit">Search</s-button>
          </Form>
          <s-button href="/api/rates/export" {...(isSubmitting ? { loading: true } : {})}>
            Export CSV
          </s-button>
        </div>

        <div className="table-wrap">
          <table className="rates-table">
            <thead>
              <tr>
                <th>
                  {rates.length > 0 ? (
                    <input
                      type="checkbox"
                      onChange={(e) =>
                        setSelectedIds(e.target.checked ? new Set(rates.map((r) => r.id)) : new Set())
                      }
                      checked={selectedIds.size === rates.length && rates.length > 0}
                    />
                  ) : null}
                </th>
                <th>Company</th>
                <th>Service</th>
                <th>City</th>
                <th>Postal</th>
                <th>Weight (g)</th>
                <th>Volume (cm3)</th>
                <th>Rate</th>
                <th>Min Charge</th>
                <th>Surcharge</th>
                <th>Mode</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <InlineRateRow
                  key={rate.id}
                  rate={rate}
                  selected={selectedIds.has(rate.id)}
                  onToggle={(id) =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      next.has(id) ? next.delete(id) : next.add(id);
                      return next;
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="pager">
          {page > 1 ? <Link to={buildPageLink(page - 1)}>Previous</Link> : null}
          {page < pageCount ? <Link to={buildPageLink(page + 1)}>Next</Link> : null}
        </div>
      </div>
    </s-page>
  );
}

function InlineRateRow({
  rate,
  selected,
  onToggle,
}: {
  rate: any;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const [company, setCompany] = useState(rate.company);
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(rate.id)}
        />
      </td>
      <td>
        <Form method="post" id={`rate-${rate.id}`}>
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="id" value={rate.id} />
          <select name="company" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company">
            {carrierCompanies.map((company) => (
              <option key={company} value={company}>
                {companyLabels[company]}
              </option>
            ))}
          </select>
        </Form>
      </td>
      <td>
        <select form={`rate-${rate.id}`} name="serviceType" defaultValue={rate.serviceType} aria-label="Service">
          {serviceTypes.map((serviceType) => (
            <option key={serviceType} value={serviceType}>
              {serviceLabels[serviceType]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input form={`rate-${rate.id}`} name="city" required defaultValue={rate.city} aria-label="City" />
      </td>
      <td>
        <input form={`rate-${rate.id}`} name="postalCode" required defaultValue={rate.postalCode} aria-label="Postal code" />
      </td>
      <td>
        <div className="range-col">
          <input form={`rate-${rate.id}`} name="minWeightGrams" type="number" min="0" defaultValue={rate.minWeightGrams ?? ""} aria-label="Min weight" />
          <input form={`rate-${rate.id}`} name="maxWeightGrams" type="number" min="0" defaultValue={rate.maxWeightGrams ?? ""} aria-label="Max weight" />
        </div>
        <label className="checkbox-row">
          <input form={`rate-${rate.id}`} name="useWeightRange" type="checkbox" defaultChecked={rate.useWeightRange} /> Use
        </label>
      </td>
      <td>
        <div className="range-col">
          <input form={`rate-${rate.id}`} name="minVolumeCm3" type="number" min="0" step="any" defaultValue={rate.minVolumeCm3 ?? ""} aria-label="Min volume" />
          <input form={`rate-${rate.id}`} name="maxVolumeCm3" type="number" min="0" step="any" defaultValue={rate.maxVolumeCm3 ?? ""} aria-label="Max volume" />
        </div>
        <label className="checkbox-row">
          <input form={`rate-${rate.id}`} name="useVolumeRange" type="checkbox" defaultChecked={rate.useVolumeRange} /> Use
        </label>
      </td>
      <td>
        <input form={`rate-${rate.id}`} name="rate" type="number" step="0.01" min="0" required defaultValue={toMoney(rate.rate)} aria-label="Rate" />
      </td>
      <td>
        <input form={`rate-${rate.id}`} name="minimumCharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.minimumCharge ?? 0)} aria-label="Minimum charge" />
        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2 }}>
            Home delivery override ($)
            <input form={`rate-${rate.id}`} name="homeDeliveryFee" type="number" step="0.01" min="0" defaultValue={rate.homeDeliveryFee ?? ""} placeholder="use global" aria-label="Home delivery fee override" />
          </label>
        </div>
      </td>
      <td>
        {company !== "CASTLE" && (
          <input form={`rate-${rate.id}`} name="zoneSurcharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.zoneSurcharge)} aria-label="Zone surcharge" />
        )}
        {company === "TGE" && (
          <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2, marginTop: 4 }}>
            Transport cost ($)
            <input form={`rate-${rate.id}`} name="transportCost" type="number" step="0.01" min="0" defaultValue={toMoney((rate as any).transportCost ?? "") || ""} aria-label="Transport cost" />
          </label>
        )}
        {company === "NZP" && (
          <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2 }}>
              Signature ($)
              <input form={`rate-${rate.id}`} name="signatureSurcharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.signatureSurcharge ?? 0)} aria-label="Signature surcharge" />
            </label>
            <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2 }}>
              Rural ($)
              <input form={`rate-${rate.id}`} name="ruralSurcharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.ruralSurcharge ?? 0)} aria-label="Rural surcharge" />
            </label>
            <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2 }}>
              Age restricted ($)
              <input form={`rate-${rate.id}`} name="ageRestrictedSurcharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.ageRestrictedSurcharge ?? 0)} aria-label="Age restricted surcharge" />
            </label>
          </div>
        )}
        {company === "MAINFREIGHT" && (
          <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2, marginTop: 4 }}>
            Base fee ($)
            <input
              form={`rate-${rate.id}`}
              name="baseFee"
              type="number"
              step="0.01"
              min="0"
              defaultValue={toMoney((rate as any).baseFee ?? 0)}
              aria-label="Base fee"
            />
          </label>
        )}
        {company === "CASTLE" && (
          <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2 }}>
              Residential ($) <span style={{ fontWeight: 400 }}>(always applied)</span>
              <input form={`rate-${rate.id}`} name="zoneSurcharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.zoneSurcharge ?? 1)} aria-label="Residential surcharge" />
            </label>
            <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2 }}>
              Signature ($)
              <input form={`rate-${rate.id}`} name="signatureSurcharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.signatureSurcharge ?? 1)} aria-label="Signature surcharge" />
            </label>
            <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2 }}>
              Rural ($)
              <input form={`rate-${rate.id}`} name="ruralSurcharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.ruralSurcharge ?? 1)} aria-label="Rural surcharge" />
            </label>
            <label style={{ fontSize: 11, color: "#486581", display: "grid", gap: 2 }}>
              Waiheke ($)
              <input form={`rate-${rate.id}`} name="ageRestrictedSurcharge" type="number" step="0.01" min="0" defaultValue={toMoney(rate.ageRestrictedSurcharge ?? 1)} aria-label="Waiheke surcharge" />
            </label>
          </div>
        )}
      </td>
      <td>
        <select form={`rate-${rate.id}`} name="mode" defaultValue={rate.mode ?? ""} aria-label="Mode">
          <option value="">Any</option>
          {carrierModes.map((mode) => (
            <option key={mode} value={mode}>
              {modeLabels[mode]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <label className="checkbox-row">
          <input form={`rate-${rate.id}`} name="active" type="checkbox" defaultChecked={rate.active} /> Active
        </label>
      </td>
      <td>
        <div className="inline-actions">
          <button className="plain-save" form={`rate-${rate.id}`} type="submit">Save</button>
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={rate.id} />
            <s-button type="submit" tone="critical" variant="tertiary">Delete</s-button>
          </Form>
        </div>
      </td>
    </tr>
  );
}

function RateForm({ rate }: { rate?: any }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="save" />
      {rate?.id ? <input type="hidden" name="id" value={rate.id} /> : null}
      <div className="grid-form">
        <label>
          Company
          <select name="company" defaultValue={rate?.company ?? "FLIWAY"}>
            {carrierCompanies.map((company) => (
              <option key={company} value={company}>
                {companyLabels[company]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Service
          <select name="serviceType" defaultValue={rate?.serviceType ?? "STANDARD_DELIVERY"}>
            {serviceTypes.map((serviceType) => (
              <option key={serviceType} value={serviceType}>
                {serviceLabels[serviceType]}
              </option>
            ))}
          </select>
        </label>
        <label>
          City
          <input name="city" required defaultValue={rate?.city ?? ""} />
        </label>
        <label>
          Postal code/range
          <input name="postalCode" required defaultValue={rate?.postalCode ?? "*"} />
        </label>
        <label>
          Min weight (g)
          <input name="minWeightGrams" type="number" min="0" defaultValue={rate?.minWeightGrams ?? ""} />
        </label>
        <label>
          Max weight (g)
          <input name="maxWeightGrams" type="number" min="0" defaultValue={rate?.maxWeightGrams ?? ""} />
        </label>
        <label>
          Min volume (cm3)
          <input name="minVolumeCm3" type="number" min="0" step="any" defaultValue={rate?.minVolumeCm3 ?? ""} />
        </label>
        <label>
          Max volume (cm3)
          <input name="maxVolumeCm3" type="number" min="0" step="any" defaultValue={rate?.maxVolumeCm3 ?? ""} />
        </label>
        <label>
          Rate
          <input name="rate" type="number" step="0.01" min="0" required defaultValue={rate?.rate?.toString?.() ?? ""} />
        </label>
        <label>
          Transport cost ($) <span style={{ fontWeight: 400, color: "#90a4ae" }}>(TGE only)</span>
          <input name="transportCost" type="number" step="0.01" min="0" defaultValue={rate?.transportCost?.toString?.() ?? ""} />
        </label>
        <label>
          Minimum charge ($)
          <input name="minimumCharge" type="number" step="0.01" min="0" defaultValue={rate?.minimumCharge?.toString?.() ?? "0.00"} />
        </label>
        <label>
          Base fee ($) <span style={{ fontWeight: 400, color: "#90a4ae" }}>(Mainfreight only)</span>
          <input name="baseFee" type="number" step="0.01" min="0" defaultValue={(rate as any)?.baseFee?.toString?.() ?? "0.00"} />
        </label>
        <label>
          Home delivery fee override ($) <span style={{ fontWeight: 400, color: "#90a4ae" }}>(leave blank to use global setting)</span>
          <input name="homeDeliveryFee" type="number" step="0.01" min="0" defaultValue={rate?.homeDeliveryFee?.toString?.() ?? ""} placeholder="use global" />
        </label>
        <label>
          Zone surcharge
          <input name="zoneSurcharge" type="number" step="0.01" min="0" defaultValue={rate?.zoneSurcharge?.toString?.() ?? "0.00"} />
        </label>
        {/* NZP-only surcharge fields */}
        <label>
          Signature / Waiheke surcharge ($)
          <input name="signatureSurcharge" type="number" step="0.01" min="0" defaultValue={rate?.signatureSurcharge?.toString?.() ?? "0.00"} />
        </label>
        <label>
          Rural surcharge ($)
          <input name="ruralSurcharge" type="number" step="0.01" min="0" defaultValue={rate?.ruralSurcharge?.toString?.() ?? "0.00"} />
        </label>
        <label>
          Age restricted / Waiheke ($)
          <input name="ageRestrictedSurcharge" type="number" step="0.01" min="0" defaultValue={rate?.ageRestrictedSurcharge?.toString?.() ?? "0.00"} />
        </label>
        <label>
          Mode
          <select name="mode" defaultValue={rate?.mode ?? ""}>
            <option value="">Any</option>
            {carrierModes.map((mode) => (
              <option key={mode} value={mode}>
                {modeLabels[mode]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input name="useWeightRange" type="checkbox" defaultChecked={rate?.useWeightRange ?? false} /> Use weight range
        </label>
        <label>
          <input name="useVolumeRange" type="checkbox" defaultChecked={rate?.useVolumeRange ?? false} /> Use volume range
        </label>
        <label>
          <input name="active" type="checkbox" defaultChecked={rate?.active ?? true} /> Active
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <s-button type="submit">{rate?.id ? "Save rate" : "Add rate"}</s-button>
      </div>
    </Form>
  );
}
