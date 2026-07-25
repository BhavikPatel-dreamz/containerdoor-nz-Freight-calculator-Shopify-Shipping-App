type Recipient = {
  email: string;
  name: string;
  orderName: string;
};

type RecipientPreviewProps = {
  recipients: Recipient[];
  subject: string;
  body: string;
  maxList?: number;
};

function personalize(template: string, r: Recipient) {
  return template
    .replace(/\{customer\}|\{name\}/g, r.name || "Customer")
    .replace(/\{order\}/g, r.orderName || "")
    .replace(/\{supplier\}/g, "—")
    .replace(/\{edd\}/g, "—")
    .replace(/\{tracking\}|\{carrier\}/g, "—")
    .replace(/\{link\}/g, "[order link]");
}

export function RecipientPreview({
  recipients,
  subject,
  body,
  maxList = 8,
}: RecipientPreviewProps) {
  const sample = recipients[0];
  const withEmail = recipients.filter((r) => r.email && r.email !== "—");
  const skipped = recipients.length - withEmail.length;

  return (
    <div className="fo-recipient-preview">
      <div className="fo-recipient-meta">
        <span>{withEmail.length} will receive email</span>
        {skipped > 0 ? <span className="fo-recipient-skipped">{skipped} skipped (no email)</span> : null}
      </div>

      {sample ? (
        <div className="fo-email-preview">
          <div className="fo-email-preview-row">
            <strong>To:</strong> {sample.email || "—"}
          </div>
          <div className="fo-email-preview-row">
            <strong>Subject:</strong> {personalize(subject, sample) || "(no subject)"}
          </div>
          <hr />
          <div className="fo-email-preview-body">{personalize(body, sample) || "(empty)"}</div>
        </div>
      ) : (
        <p className="fo-form-hint">No recipients selected.</p>
      )}

      <div className="fo-recipient-list">
        {recipients.slice(0, maxList).map((r, i) => (
          <div key={`${r.orderName}-${i}`} className="fo-recipient-row">
            <span>{r.name || "—"}</span>
            <span className={!r.email || r.email === "—" ? "is-muted" : ""}>
              {r.email && r.email !== "—" ? r.email : "no email"}
            </span>
          </div>
        ))}
        {recipients.length > maxList ? (
          <div className="fo-recipient-more">+{recipients.length - maxList} more</div>
        ) : null}
      </div>
    </div>
  );
}

type CompletionStats = {
  updated: number;
  emailsQueued: number;
  skippedNoEmail: number;
  failed?: number;
};

type CompletionPanelProps = {
  stats: CompletionStats;
  onViewLog?: () => void;
  logText?: string;
};

export function CompletionPanel({ stats, onViewLog, logText }: CompletionPanelProps) {
  return (
    <div className="fo-completion-panel">
      <div className="fo-completion-hero">✅ Completed</div>
      <ul className="fo-completion-stats">
        <li>
          <strong>{stats.updated}</strong> Updated
        </li>
        {stats.emailsQueued > 0 ? (
          <li>
            <strong>{stats.emailsQueued}</strong> Emails Queued
          </li>
        ) : null}
        {stats.skippedNoEmail > 0 ? (
          <li>
            <strong>{stats.skippedNoEmail}</strong> Customers skipped
            <span className="fo-completion-note">(No email address)</span>
          </li>
        ) : null}
        {stats.failed && stats.failed > 0 ? (
          <li className="is-error">
            <strong>{stats.failed}</strong> Failed
          </li>
        ) : null}
      </ul>
      {onViewLog ? (
        <button type="button" className="fo-btn-ghost" onClick={onViewLog}>
          View Log
        </button>
      ) : null}
      {logText ? <pre className="fo-completion-log">{logText}</pre> : null}
    </div>
  );
}
