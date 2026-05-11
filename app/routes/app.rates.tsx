import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
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
  return listRates(session.shop, page, query);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "save");

  if (intent === "delete") {
    return deleteRate(session.shop, String(formData.get("id")));
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
  const query = searchParams.get("q") || "";
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Rate management">
      <style>{`
        .panel {
          border: 1px solid #d5d9dd;
          border-radius: 12px;
          padding: 14px;
          background: #fff;
        }
        .toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: end;
        }
        .search-form {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .search-form input,
        .import-form input[type="file"],
        .grid-form input,
        .grid-form select,
        .rates-table input,
        .rates-table select {
          border: 1px solid #bec5cc;
          border-radius: 8px;
          padding: 7px 9px;
          background: #fff;
          color: #1f2933;
          min-height: 34px;
        }
        .import-form {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          padding: 10px;
          border: 1px dashed #bec5cc;
          border-radius: 10px;
          background: #f8fafb;
        }
        .summary {
          margin: 0;
          color: #52606d;
          font-size: 13px;
        }
        .table-wrap {
          overflow-x: auto;
          border: 1px solid #e3e7ea;
          border-radius: 10px;
        }
        .rates-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          min-width: 1200px;
        }
        .rates-table th,
        .rates-table td {
          border-bottom: 1px solid #edf1f4;
          padding: 8px;
          vertical-align: top;
          white-space: nowrap;
        }
        .rates-table th {
          position: sticky;
          top: 0;
          background: #f4f7f9;
          color: #334e68;
          font-weight: 700;
          z-index: 1;
        }
        .range-col {
          display: grid;
          gap: 6px;
          min-width: 155px;
        }
        .checkbox-row {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #52606d;
          font-size: 12px;
        }
        .inline-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .plain-save {
          border: 1px solid #9fb3c8;
          background: #fff;
          color: #102a43;
          border-radius: 8px;
          padding: 7px 10px;
          font-weight: 600;
          cursor: pointer;
        }
        .pager {
          display: flex;
          gap: 10px;
          margin-top: 8px;
        }
        .pager a {
          text-decoration: none;
          border: 1px solid #bec5cc;
          border-radius: 999px;
          padding: 6px 12px;
          color: #243b53;
          font-size: 13px;
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
      `}</style>

      <s-section heading="Add rate">
        {actionData?.message ? (
          <s-banner tone={actionData.ok ? "success" : "critical"}>{actionData.message}</s-banner>
        ) : null}
        <div className="panel">
          <RateForm />
        </div>
      </s-section>

      <s-section heading="Rates">
        <div className="panel">
          <s-stack direction="block" gap="base">
            <div className="toolbar">
              <Form method="get" className="search-form">
              <input name="q" placeholder="City or postal code" defaultValue={query} />
              <s-button type="submit">Search</s-button>
              </Form>
              <s-button href="/api/rates/export">Export CSV</s-button>
            </div>
            <Form className="import-form" method="post" encType="multipart/form-data">
              <input type="hidden" name="intent" value="import" />
              <input type="file" name="csv" accept=".csv,text/csv" />
              <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
                Import CSV
              </s-button>
            </Form>

            <p className="summary">
              {total} active rates · page {page} of {pageCount}
            </p>

            <div className="table-wrap">
              <table className="rates-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Service</th>
                    <th>City</th>
                    <th>Postal</th>
                    <th>Weight g</th>
                    <th>Volume cm3</th>
                    <th>Rate</th>
                    <th>Zone surcharge</th>
                    <th>Mode</th>
                    <th>Active</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((rate) => (
                    <InlineRateRow key={rate.id} rate={rate} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pager">
              {page > 1 ? <Link to={`/app/rates?page=${page - 1}&q=${query}`}>Previous</Link> : null}
              {page < pageCount ? <Link to={`/app/rates?page=${page + 1}&q=${query}`}>Next</Link> : null}
            </div>
          </s-stack>
        </div>
      </s-section>
    </s-page>
  );
}

function InlineRateRow({ rate }: { rate: any }) {
  return (
    <tr>
      <td>
        <Form method="post" id={`rate-${rate.id}`}>
          <input type="hidden" name="intent" value="save" />
          <input type="hidden" name="id" value={rate.id} />
          <select name="company" defaultValue={rate.company} aria-label="Company">
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
          <input form={`rate-${rate.id}`} name="minVolumeCm3" type="number" min="0" defaultValue={rate.minVolumeCm3 ?? ""} aria-label="Min volume" />
          <input form={`rate-${rate.id}`} name="maxVolumeCm3" type="number" min="0" defaultValue={rate.maxVolumeCm3 ?? ""} aria-label="Max volume" />
        </div>
        <label className="checkbox-row">
          <input form={`rate-${rate.id}`} name="useVolumeRange" type="checkbox" defaultChecked={rate.useVolumeRange} /> Use
        </label>
      </td>
      <td>
        <input form={`rate-${rate.id}`} name="rate" type="number" step="0.01" min="0" required defaultValue={toMoney(rate.rate)} aria-label="Rate" />
      </td>
      <td>
        <input
          form={`rate-${rate.id}`}
          name="zoneSurcharge"
          type="number"
          step="0.01"
          min="0"
          defaultValue={toMoney(rate.zoneSurcharge)}
          aria-label="Zone surcharge"
        />
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
          <button className="plain-save" form={`rate-${rate.id}`} type="submit">
            Save
          </button>
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={rate.id} />
            <s-button type="submit" tone="critical" variant="tertiary">
              Delete
            </s-button>
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
          <input name="minVolumeCm3" type="number" min="0" defaultValue={rate?.minVolumeCm3 ?? ""} />
        </label>
        <label>
          Max volume (cm3)
          <input name="maxVolumeCm3" type="number" min="0" defaultValue={rate?.maxVolumeCm3 ?? ""} />
        </label>
        <label>
          Rate
          <input name="rate" type="number" step="0.01" min="0" required defaultValue={rate?.rate?.toString?.() ?? ""} />
        </label>
        <label>
          Zone surcharge
          <input name="zoneSurcharge" type="number" step="0.01" min="0" defaultValue={rate?.zoneSurcharge?.toString?.() ?? "0.00"} />
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
