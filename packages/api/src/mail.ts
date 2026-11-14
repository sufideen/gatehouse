import nodemailer, { type Transporter } from "nodemailer";
import { createDevMailer, type Mailer } from "./account";

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** SMTP mailer. Works with AWS SES SMTP (eu-west-2), Postmark, Mailgun EU, etc. Never logs message bodies (they contain reset links). */
export function createSmtpMailer(o: { transport: Transporter; from: string }): Mailer {
  return {
    async send(to, subject, text) {
      // Explicit header-injection guard on top of nodemailer's own sanitising.
      if (!EMAIL.test(to)) throw new Error("Invalid recipient");
      if (/[\r\n]/.test(subject)) throw new Error("Invalid subject");
      await o.transport.sendMail({ from: o.from, to, subject, text });
    },
  };
}

export type MailerChoice = { mailer: Mailer; kind: "smtp" | "dev"; outbox?: ReturnType<typeof createDevMailer>["outbox"] };

/**
 * SMTP_URL  e.g. smtps://USER:PASS@email-smtp.eu-west-2.amazonaws.com:465   (smtp:// requires STARTTLS unless SMTP_REQUIRE_TLS=false)
 * MAIL_FROM e.g. "Gatehouse <no-reply@yourdomain.co.uk>"  (the domain must be verified with your provider; add SPF/DKIM/DMARC)
 * Without them: dev mailer outside production, hard error in production (never silently drop reset emails).
 */
export function mailerFromEnv(env: Record<string, string | undefined> = process.env): MailerChoice {
  if (env.SMTP_URL) {
    if (!env.MAIL_FROM) throw new Error("MAIL_FROM is required when SMTP_URL is set");
    const requireTLS = env.SMTP_URL.startsWith("smtp://") && env.SMTP_REQUIRE_TLS !== "false";
    const transport = nodemailer.createTransport(env.SMTP_URL, { requireTLS, connectionTimeout: 10_000, socketTimeout: 15_000 });
    return { kind: "smtp", mailer: createSmtpMailer({ transport, from: env.MAIL_FROM }) };
  }
  if (env.NODE_ENV === "production") throw new Error("SMTP_URL and MAIL_FROM are required in production");
  const dev = createDevMailer();
  return { kind: "dev", mailer: dev.mailer, outbox: dev.outbox };
}
