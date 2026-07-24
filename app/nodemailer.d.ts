declare module "nodemailer" {
  interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }
  interface SendMailOptions {
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }
  interface Transporter {
    sendMail(options: SendMailOptions): Promise<any>;
  }
  function createTransport(options: TransportOptions): Transporter;
  export { createTransport, Transporter, SendMailOptions, TransportOptions };
}
