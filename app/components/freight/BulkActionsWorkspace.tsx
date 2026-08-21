/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import type { FreightLineItem, FreightOrderRow } from "./types";
import { CUSTOMER_STATUS_OPTIONS } from "../../lib/status-options";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalSection,
  ActionCard,
  FormSection,
  FieldInput,
  FieldSelect,
  FieldTextArea,
  SearchableSelect,
  ToggleOption,
  ProgressPanel,
  SummaryPanel,
  AffectedItemsPanel,
  RecipientPreview,
  CompletionPanel,
} from "./ui";

export type BulkActionsPayload = {
  eddDate?: string;
  paymentStatus?: string;
  customerStatus?: string;
  supplier?: string;
  note?: string;
  noteOptions?: { sendToMonday?: boolean; sendToCin7?: boolean; addToShopify?: boolean };
  notify?: { subject: string; body: string };
  freightCsvExportCarrier?: string;
};

export type BulkActionsResult = {
  summary: { total: number; succeeded: number; failed: number };
  notifyJobId?: string;
  notifyRecipients?: number;
  results?: Array<{ orderId: string; variantId: string; success: boolean; error?: string }>;
};

type Target = { order: FreightOrderRow; item: FreightLineItem };

type Phase = "compose" | "running" | "done";

type BulkActionsWorkspaceProps = {
  open: boolean;
  onClose: () => void;
  targets: Target[];
  onRun: (payload: BulkActionsPayload) => Promise<BulkActionsResult>;
  onExportFreightCsv?: (carrier: string) => Promise<BulkActionsResult>;
  onNotifyJobQueued?: (jobId: string) => void;
};

const SUPPLIER_OPTIONS = [
  { value: "Castle", label: "Castle" },
  { value: "NZ Post", label: "NZ Post" },
  { value: "TGE", label: "TGE" },
  { value: "Mainfreight", label: "Mainfreight" },
  { value: "Fliway", label: "Fliway" },
  { value: "M2H", label: "M2H" },
  { value: "Direct", label: "Direct" },
];

const EMAIL_VARS = [
  { key: "{customer}", tip: "Customer name" },
  { key: "{order}", tip: "Order number" },
  { key: "{supplier}", tip: "Supplier" },
  { key: "{edd}", tip: "Estimated delivery" },
  { key: "{tracking}", tip: "Tracking number" },
  { key: "{product}", tip: "Product name" },
  { key: "{variants}", tip: "Variant details" },
];

export function BulkActionsWorkspace({
  open,
  onClose,
  targets,
  onRun,
  onExportFreightCsv,
  onNotifyJobQueued,
}: BulkActionsWorkspaceProps) {
  const [phase, setPhase] = useState<Phase>("compose");
  const [error, setError] = useState("");
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const [enableEdd, setEnableEdd] = useState(false);
  const [enablePayment, setEnablePayment] = useState(false);
  const [enableCustomerStatus, setEnableCustomerStatus] = useState(false);
  const [enableSupplier, setEnableSupplier] = useState(false);
  const [enableExport, setEnableExport] = useState(false);
  const [enableNote, setEnableNote] = useState(false);
  const [enableNotify, setEnableNotify] = useState(false);

  const [eddDate, setEddDate] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [customerStatus, setCustomerStatus] = useState("");
  const [supplier, setSupplier] = useState("");
  const [exportCarrier, setExportCarrier] = useState("FLIWAYLINEHAUL");
  const [noteText, setNoteText] = useState("");
  const [sendToMonday, setSendToMonday] = useState(false);
  const [sendToCin7, setSendToCin7] = useState(false);
  const [addToShopify, setAddToShopify] = useState(false);
  const [notifySubject, setNotifySubject] = useState("");
  const [notifyBody, setNotifyBody] = useState("");

  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressSteps, setProgressSteps] = useState<
    Array<{ id: string; label: string; status: "pending" | "active" | "done" | "error" }>
  >([]);
  const [currentItem, setCurrentItem] = useState<{ label: string; meta: string } | null>(null);
  const [result, setResult] = useState<BulkActionsResult | null>(null);

  const selectedCount = targets.length;

  const supplierGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of targets) {
      const key = t.item.supplierContainer?.trim() || t.item.company || "Unassigned";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ id: label, label, count }));
  }, [targets]);

  const recipients = useMemo(
    () =>
      targets.map((t) => ({
        email: t.order.email,
        name: t.order.customerName,
        orderName: t.order.shopifyOrderName,
        orderId: t.order.shopifyOrderId,
        variantId: t.item.variantId,
      })),
    [targets],
  );

  const skippedNoEmail = recipients.filter((r) => !r.email || r.email === "—").length;

  const summaryItems = [
    { id: "edd", label: "Estimated Delivery Date", active: enableEdd },
    { id: "payment", label: "Payment Status", active: enablePayment },
    { id: "customer-status", label: "Customer Status", active: enableCustomerStatus },
    { id: "supplier", label: "Supplier", active: enableSupplier },
    { id: "export", label: "Freight CSV Export", active: enableExport },
    { id: "note", label: "Internal Note", active: enableNote },
    { id: "email", label: "Customer Email", active: enableNotify },
  ];

  const hasAction = enableEdd || enablePayment || enableCustomerStatus || enableSupplier || enableExport || enableNote || enableNotify;

  function resetForm() {
    setEnableEdd(false);
    setEnablePayment(false);
    setEnableCustomerStatus(false);
    setEnableSupplier(false);
    setEnableExport(false);
    setEnableNote(false);
    setEnableNotify(false);
    setEddDate("");
    setPaymentStatus("");
    setCustomerStatus("");
    setSupplier("");
    setExportCarrier("FLIWAYLINEHAUL");
    setNoteText("");
    setSendToMonday(true);
    setSendToCin7(false);
    setAddToShopify(false);
    setNotifySubject("");
    setNotifyBody("");
    setShowEmailPreview(false);
    setShowLog(false);
    setError("");
    setPhase("compose");
    setResult(null);
    setCurrentItem(null);
    setProgressDone(0);
    setProgressTotal(0);
    setProgressSteps([]);
  }

  function handleClose() {
    if (phase === "running") return;
    resetForm();
    onClose();
  }

  function buildPayload(): BulkActionsPayload | null {
    const payload: BulkActionsPayload = {};
    if (enableEdd) {
      if (!eddDate) {
        setError("Select an estimated delivery date");
        return null;
      }
      payload.eddDate = eddDate;
    }
    if (enablePayment) payload.paymentStatus = paymentStatus;
    if (enableCustomerStatus) payload.customerStatus = customerStatus;
    if (enableSupplier) payload.supplier = supplier;
    if (enableExport) {
      if (!exportCarrier) {
        setError("Select a carrier format for CSV export");
        return null;
      }
      payload.freightCsvExportCarrier = exportCarrier;
    }
    if (enableNote) {
      if (!noteText.trim()) {
        setError("Enter an internal note");
        return null;
      }
      payload.note = noteText.trim();
      payload.noteOptions = {
        sendToMonday,
        sendToCin7,
        addToShopify,
      };
    }
    if (enableNotify) {
      if (!notifySubject.trim() || !notifyBody.trim()) {
        setError("Subject and message are required for customer emails");
        return null;
      }
      // Normalize {customer} → {name} for existing notify pipeline
      payload.notify = {
        subject: notifySubject.trim().replace(/\{customer\}/g, "{name}"),
        body: notifyBody.trim().replace(/\{customer\}/g, "{name}"),
      };
    }
    if (Object.keys(payload).length === 0) {
      setError("Enable at least one action");
      return null;
    }
    return payload;
  }

  async function handleRun() {
    setError("");
    const payload = buildPayload();
    if (!payload) return;

    if (enableExport && onExportFreightCsv) {
      try {
        setPhase("running");
        setProgressTotal(targets.length);
        setProgressDone(0);
        setProgressSteps([{ id: "export", label: "Exporting CSV", status: "active" }]);
        setCurrentItem({ label: `Carrier ${exportCarrier}`, meta: `${targets.length} selected` });
        const res = await onExportFreightCsv(exportCarrier);
        setProgressDone(targets.length);
        setProgressSteps([{ id: "export", label: "Exporting CSV", status: "done" }]);
        setResult(res);
        setPhase("done");
      } catch (e) {
        setProgressSteps([{ id: "export", label: "Exporting CSV", status: "error" }]);
        setError(e instanceof Error ? e.message : "Freight CSV export failed");
        setPhase("compose");
      }
      return;
    }

    const steps: Array<{ id: string; label: string; status: "pending" | "active" | "done" | "error" }> = [
      { id: "oms", label: "Updating OMS", status: "active" },
    ];
    if (payload.noteOptions?.sendToMonday || payload.eddDate || payload.paymentStatus !== undefined || payload.supplier !== undefined) {
      steps.push({ id: "monday", label: "Syncing Monday", status: "pending" });
    }
    if (payload.noteOptions?.addToShopify) {
      steps.push({ id: "shopify", label: "Updating Shopify note", status: "pending" });
    }
    if (payload.notify) {
      steps.push({ id: "email", label: "Queueing Emails", status: "pending" });
    }

    setPhase("running");
    setProgressTotal(targets.length);
    setProgressDone(0);
    setProgressSteps(steps);
    setCurrentItem(
      targets[0]
        ? {
            label: `Order ${targets[0].order.shopifyOrderName}`,
            meta: targets[0].item.supplierContainer || targets[0].item.company || "—",
          }
        : null,
    );

    // Animate progress while the server request runs
    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      setProgressDone((prev) => Math.min(targets.length - 1, prev + Math.max(1, Math.floor(targets.length / 12))));
      const idx = Math.min(targets.length - 1, Math.floor((tick / 12) * targets.length));
      const t = targets[idx];
      if (t) {
        setCurrentItem({
          label: `Order ${t.order.shopifyOrderName}`,
          meta: t.item.supplierContainer || t.item.company || "—",
        });
      }
      setProgressSteps((prev) => {
        const next = [...prev];
        if (tick > 3 && next[0]?.status === "active") {
          next[0] = { ...next[0], status: "done" };
          if (next[1]) next[1] = { ...next[1], status: "active" };
        }
        if (tick > 6 && next[1]?.status === "active") {
          next[1] = { ...next[1], status: "done" };
          if (next[2]) next[2] = { ...next[2], status: "active" };
        }
        return next;
      });
    }, 280);

    try {
      const res = await onRun(payload);
      window.clearInterval(timer);
      setProgressDone(targets.length);
      setProgressSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
      setResult(res);
      if (res.notifyJobId) onNotifyJobQueued?.(res.notifyJobId);
      setPhase("done");
    } catch (e) {
      window.clearInterval(timer);
      setProgressSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error" as const } : s)),
      );
      setError(e instanceof Error ? e.message : "Bulk actions failed");
      setPhase("compose");
    }
  }

  function insertVar(key: string) {
    setNotifyBody((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${key}`);
  }

  if (!open) return null;

  const completionStats = {
    updated: result?.summary.succeeded ?? 0,
    emailsQueued: result?.notifyRecipients ?? 0,
    skippedNoEmail: enableNotify ? skippedNoEmail : 0,
    failed: result?.summary.failed ?? 0,
  };

  const logText = showLog && result?.results
    ? result.results
        .map((r) => `${r.success ? "OK" : "FAIL"} ${r.orderId}/${r.variantId}${r.error ? ` — ${r.error}` : ""}`)
        .join("\n")
    : undefined;

  return (
    <Modal open={open} onClose={handleClose} width={720} closeOnOverlay={phase !== "running"}>
      <ModalHeader
        icon={<span aria-hidden>⚡</span>}
        title={`Bulk Actions (${selectedCount} selected line item${selectedCount !== 1 ? "s" : ""})`}
        subtitle={phase === "compose" ? "Choose one or more actions to run together" : undefined}
        onClose={phase === "running" ? undefined : handleClose}
        closeDisabled={phase === "running"}
      />

      <ModalBody>
        {error ? <div className="fo-ws-error">{error}</div> : null}

        {phase === "compose" && (
          <>
            <ModalSection title="Actions">
              <div className="fo-ws-actions">
                <ActionCard enabled={enableEdd} onToggle={setEnableEdd} title="Estimated Delivery Date">
                  <FormSection label="Date" htmlFor="ba-edd">
                    <FieldInput id="ba-edd" type="date" value={eddDate} onChange={(e) => setEddDate(e.target.value)} />
                  </FormSection>
                </ActionCard>

                <ActionCard enabled={enablePayment} onToggle={setEnablePayment} title="Payment Status">
                  <FormSection label="Status" htmlFor="ba-pay">
                    <FieldSelect id="ba-pay" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
                      <option value="">— clear —</option>
                      <option value="Paid">Paid</option>
                      <option value="Partial">Partial</option>
                      <option value="Pending">Pending</option>
                      <option value="Overdue">Overdue</option>
                    </FieldSelect>
                  </FormSection>
                </ActionCard>

                <ActionCard enabled={enableCustomerStatus} onToggle={setEnableCustomerStatus} title="Customer Status">
                  <FormSection label="Status" htmlFor="ba-customer-status">
                    <FieldSelect id="ba-customer-status" value={customerStatus} onChange={(e) => setCustomerStatus(e.target.value)}>
                      {CUSTOMER_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </FieldSelect>
                  </FormSection>
                </ActionCard>

                <ActionCard enabled={enableSupplier} onToggle={setEnableSupplier} title="Assign Supplier">
                  <FormSection label="Supplier" htmlFor="ba-sup">
                    <SearchableSelect
                      id="ba-sup"
                      value={supplier}
                      onChange={setSupplier}
                      options={SUPPLIER_OPTIONS}
                      placeholder="Search suppliers…"
                    />
                  </FormSection>
                </ActionCard>

                <ActionCard enabled={enableExport} onToggle={setEnableExport} title="Freight CSV Export">
                  <FormSection label="Carrier format" htmlFor="ba-export-carrier">
                    <FieldSelect id="ba-export-carrier" value={exportCarrier} onChange={(e) => setExportCarrier(e.target.value)}>
                      <option value="FLIWAYLINEHAUL">Fliway Linehaul</option>
                      <option value="FLIWAYMIDSIZE">Fliway Midsize</option>
                      <option value="FLIWAYDEPOT">Fliway Depot</option>
                      <option value="M2H">Mainfreight 2Home</option>
                      <option value="NZP">NZ Post</option>
                      <option value="NZP_AGE_RESTRICTED">NZ Post Age Restricted</option>
                      <option value="CASTLE">Castle Parcels</option>
                    </FieldSelect>
                  </FormSection>
                </ActionCard>

                <ActionCard enabled={enableNote} onToggle={setEnableNote} title="Add Internal Note">
                  <FormSection label="Note" htmlFor="ba-note">
                    <FieldTextArea
                      id="ba-note"
                      rows={4}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="e.g. Payment confirmed by CS — ready for warehouse"
                    />
                  </FormSection>
                  <div className="fo-ws-note-targets">
                    <ToggleOption
                      checked={sendToMonday}
                      onChange={setSendToMonday}
                      label="Send to Monday.com"
                      description="Visible to warehouse on the board"
                    />
                    <ToggleOption
                      checked={sendToCin7}
                      onChange={setSendToCin7}
                      label="Send to Cin7"
                      badge="Coming Soon"
                      disabled
                    />
                    <ToggleOption
                      checked={addToShopify}
                      onChange={setAddToShopify}
                      label="Add to Shopify order timeline"
                      description="Visible on the Shopify order for quick reference"
                    />
                  </div>
                </ActionCard>

                <ActionCard enabled={enableNotify} onToggle={setEnableNotify} title="Notify Customers">
                  <FormSection label="Subject" htmlFor="ba-subj">
                    <FieldInput
                      id="ba-subj"
                      value={notifySubject}
                      onChange={(e) => setNotifySubject(e.target.value)}
                      placeholder="Delivery update for order {order}"
                    />
                  </FormSection>
                  <FormSection label="Message" htmlFor="ba-body">
                    <FieldTextArea
                      id="ba-body"
                      rows={5}
                      value={notifyBody}
                      onChange={(e) => setNotifyBody(e.target.value)}
                      placeholder={"Hi {customer},\n\nYour order {order} has an update…"}
                    />
                  </FormSection>
                  <div className="fo-ws-vars">
                    <span className="fo-ws-vars-label">Variables</span>
                    <div className="fo-ws-vars-chips">
                      {EMAIL_VARS.map((v) => (
                        <button key={v.key} type="button" className="fo-ws-var-chip" title={v.tip} onClick={() => insertVar(v.key)}>
                          {v.key}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fo-ws-email-actions">
                    <button
                      type="button"
                      className="fo-btn-ghost"
                      onClick={() => setShowEmailPreview((v) => !v)}
                    >
                      {showEmailPreview ? "Hide Preview" : "Preview Email"}
                    </button>
                  </div>
                  {showEmailPreview ? (
                    <RecipientPreview
                      recipients={recipients}
                      subject={notifySubject}
                      body={notifyBody}
                    />
                  ) : null}
                </ActionCard>
              </div>
            </ModalSection>

            <div className="fo-ws-side-grid">
              <AffectedItemsPanel total={selectedCount} groups={supplierGroups} />
              <SummaryPanel items={summaryItems} />
            </div>
          </>
        )}

        {phase === "running" && (
          <ProgressPanel
            done={progressDone}
            total={progressTotal}
            steps={progressSteps}
            currentLabel={currentItem?.label}
            currentMeta={currentItem?.meta}
          />
        )}

        {phase === "done" && result && (
          <CompletionPanel
            stats={completionStats}
            onViewLog={() => setShowLog((v) => !v)}
            logText={logText}
          />
        )}
      </ModalBody>

      <ModalFooter>
        {phase === "compose" && (
          <>
            <button type="button" className="fo-btn-ghost" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="button"
              className="fo-btn-primary"
              disabled={!hasAction}
              onClick={handleRun}
            >
              Run Actions
            </button>
          </>
        )}
        {phase === "running" && (
          <span className="fo-ws-running-hint">Please wait — updates are in progress…</span>
        )}
        {phase === "done" && (
          <button
            type="button"
            className="fo-btn-primary"
            onClick={handleClose}
          >
            Close
          </button>
        )}
      </ModalFooter>
    </Modal>
  );
}
