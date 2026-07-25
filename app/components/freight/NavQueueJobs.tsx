/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";

export type QueueJobStatus = {
  jobId: string;
  status: string;
  sent: number;
  failed: number;
  total: number;
};

type RecipientRow = {
  id: string;
  email: string;
  name?: string | null;
  orderName?: string | null;
  status: string;
  error?: string | null;
  sentAt?: string | null;
};

type NavQueueJobsProps = {
  job: QueueJobStatus | null;
  shop?: string;
};

/** Top-bar queue chip — click opens popup explaining Queue + send log. */
export function NavQueueJobs({ job, shop }: NavQueueJobsProps) {
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<QueueJobStatus | null>(job);

  useEffect(() => {
    setDetail(job);
  }, [job]);

  useEffect(() => {
    if (!open || !detail?.jobId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/bulk-notify/process?jobId=${encodeURIComponent(detail.jobId)}`);
        const data = await res.json().catch(() => null);
        if (cancelled || !data?.ok || !data.job) return;
        const j = data.job;
        setDetail({
          jobId: j.id,
          status: j.status,
          sent: j.sentCount ?? 0,
          failed: j.failedCount ?? 0,
          total: j.totalRecipients ?? 0,
        });
        setRecipients(Array.isArray(j.recipients) ? j.recipients : []);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [open, detail?.jobId]);

  if (!job && !open) return null;

  const active = detail ?? job;
  const done = active ? active.sent + active.failed : 0;
  const label = !active
    ? "Idle"
    : active.status === "PENDING"
      ? "Queued…"
      : active.status === "PROCESSING"
        ? `Sending ${done}/${active.total}`
        : active.status === "COMPLETED"
          ? `Done ${active.sent}/${active.total}`
          : active.status === "FAILED"
            ? `Failed ${active.failed}`
            : active.status;

  return (
    <div className="fo-nav-queue-wrap">
      <button
        type="button"
        className="fo-nav-queue"
        onClick={() => setOpen((v) => !v)}
        title="Email send queue — click for details"
        aria-expanded={open}
      >
        <span className="fo-nav-queue-dot" />
        <span className="fo-nav-queue-label">Queue</span>
        <span className="fo-nav-queue-status">{label}</span>
      </button>

      {open && (
        <>
          <button type="button" className="fo-nav-queue-backdrop" aria-label="Close queue" onClick={() => setOpen(false)} />
          <div className="fo-nav-queue-panel" role="dialog" aria-label="Email queue">
            <div className="fo-nav-queue-panel-hdr">
              <div>
                <div className="fo-nav-queue-panel-title">Email queue</div>
                <div className="fo-nav-queue-panel-sub">
                  Background send list for customer emails (bulk notify, Note → Customer email, EDD/Tracking notify).
                  Cron picks jobs up — browser does not send.
                </div>
              </div>
              <button type="button" className="fo-modal-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            {!active ? (
              <div className="fo-nav-queue-empty">No active job right now.</div>
            ) : (
              <>
                <div className="fo-nav-queue-meta">
                  <div><span>Status</span><strong>{active.status}</strong></div>
                  <div><span>Progress</span><strong>{done} / {active.total}</strong></div>
                  <div><span>Sent</span><strong>{active.sent}</strong></div>
                  <div><span>Failed</span><strong>{active.failed}</strong></div>
                </div>
                <div className="fo-nav-queue-jobid">Job {active.jobId}{shop ? ` · ${shop}` : ""}</div>

                <div className="fo-nav-queue-log-title">Send log{loading ? "…" : ""}</div>
                {recipients.length === 0 ? (
                  <div className="fo-nav-queue-empty">
                    {loading ? "Loading recipients…" : "No recipients yet."}
                  </div>
                ) : (
                  <ul className="fo-nav-queue-log">
                    {recipients.map((r) => (
                      <li key={r.id} className={`fo-nav-queue-log-row status-${(r.status || "").toLowerCase()}`}>
                        <div className="fo-nav-queue-log-main">
                          <span className="fo-nav-queue-log-email">{r.email || "—"}</span>
                          <span className="fo-nav-queue-log-badge">{r.status}</span>
                        </div>
                        <div className="fo-nav-queue-log-sub">
                          {[r.orderName, r.name].filter(Boolean).join(" · ") || "—"}
                          {r.error ? ` · ${r.error}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
