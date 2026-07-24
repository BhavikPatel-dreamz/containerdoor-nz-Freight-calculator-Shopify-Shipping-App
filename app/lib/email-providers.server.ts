/* eslint-disable @typescript-eslint/no-explicit-any */
// ─── Email Provider Abstraction ──────────────────────────────────────────────
// Switch providers by changing EMAIL_PROVIDER env var + corresponding API key.
// Supported: resend, ses, sendgrid, postmark, mailgun, smtp

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface EmailSendResult {
  id?: string;
  success: boolean;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

// ─── Resend ──────────────────────────────────────────────────────────────────

class ResendProvider implements EmailProvider {
  readonly name = "resend";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const { Resend } = await import("resend");
    const resend = new Resend(this.apiKey);
    const result = await (resend.emails as any).send({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true, id: result.data?.id };
  }
}

// ─── SMTP (nodemailer) ──────────────────────────────────────────────────────

class SmtpProvider implements EmailProvider {
  readonly name = "smtp";
  private host: string;
  private port: number;
  private user?: string;
  private pass?: string;

  constructor(opts: { host: string; port?: number; user?: string; pass?: string }) {
    this.host = opts.host;
    this.port = opts.port ?? 587;
    this.user = opts.user;
    this.pass = opts.pass;
  }

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: this.host,
      port: this.port,
      secure: this.port === 465,
      auth: this.user && this.pass ? { user: this.user, pass: this.pass } : undefined,
    });
    const info = await transport.sendMail({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { success: true, id: info.messageId };
  }
}

// ─── SendGrid (stub — implement when needed) ────────────────────────────────

class SendGridProvider implements EmailProvider {
  readonly name = "sendgrid";
  private apiKey: string;
  constructor(apiKey: string) { this.apiKey = apiKey; }
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    // TODO: implement with @sendgrid/mail
    throw new Error("SendGrid provider not yet implemented. Set EMAIL_PROVIDER=resend or smtp.");
  }
}

// ─── Postmark (stub) ────────────────────────────────────────────────────────

class PostmarkProvider implements EmailProvider {
  readonly name = "postmark";
  private serverToken: string;
  constructor(serverToken: string) { this.serverToken = serverToken; }
  async send(_msg: EmailMessage): Promise<EmailSendResult> {
    throw new Error("Postmark provider not yet implemented. Set EMAIL_PROVIDER=resend or smtp.");
  }
}

// ─── Mailgun (stub) ─────────────────────────────────────────────────────────

class MailgunProvider implements EmailProvider {
  readonly name = "mailgun";
  private apiKey: string;
  private domain: string;
  constructor(apiKey: string, domain: string) { this.apiKey = apiKey; this.domain = domain; }
  async send(_msg: EmailMessage): Promise<EmailSendResult> {
    throw new Error("Mailgun provider not yet implemented. Set EMAIL_PROVIDER=resend or smtp.");
  }
}

// ─── AWS SES (stub) ─────────────────────────────────────────────────────────

class SesProvider implements EmailProvider {
  readonly name = "ses";
  constructor(_config: any) {}
  async send(_msg: EmailMessage): Promise<EmailSendResult> {
    throw new Error("SES provider not yet implemented. Set EMAIL_PROVIDER=resend or smtp.");
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function getEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();

  switch (provider) {
    case "resend": {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) throw new Error("RESEND_API_KEY not configured");
      return new ResendProvider(apiKey);
    }
    case "smtp": {
      const host = process.env.SMTP_HOST;
      if (!host) throw new Error("SMTP_HOST not configured");
      return new SmtpProvider({
        host,
        port: Number(process.env.SMTP_PORT || "587"),
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      });
    }
    case "sendgrid": {
      const apiKey = process.env.SENDGRID_API_KEY;
      if (!apiKey) throw new Error("SENDGRID_API_KEY not configured");
      return new SendGridProvider(apiKey);
    }
    case "postmark": {
      const token = process.env.POSTMARK_SERVER_TOKEN;
      if (!token) throw new Error("POSTMARK_SERVER_TOKEN not configured");
      return new PostmarkProvider(token);
    }
    case "mailgun": {
      const apiKey = process.env.MAILGUN_API_KEY;
      const domain = process.env.MAILGUN_DOMAIN;
      if (!apiKey || !domain) throw new Error("MAILGUN_API_KEY and MAILGUN_DOMAIN not configured");
      return new MailgunProvider(apiKey, domain);
    }
    case "ses": {
      return new SesProvider({});
    }
    default:
      throw new Error(`Unknown EMAIL_PROVIDER: ${provider}. Supported: resend, smtp, sendgrid, postmark, mailgun, ses`);
  }
}

export function getFromEmail(): string {
  return process.env.SMTP_FROM || "ContainerDoor <noreply@containerdoor.co.nz>";
}
