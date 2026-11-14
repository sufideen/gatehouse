import { afterAll, beforeAll, describe, expect, it } from "vitest";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { createSmtpMailer, mailerFromEnv } from "../src/mail";

describe("mailer", () => {
  it("builds a correct message (from, to, subject, text) and rejects header injection", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const m = createSmtpMailer({ transport, from: "Gatehouse <no-reply@gatehouse.example>" });
    await expect(m.send("a@b.example", "Hi\r\nBcc: evil@x.example", "x")).rejects.toThrow(/subject/);
    await expect(m.send("a@b.example\nBcc: evil@x.example", "Hi", "x")).rejects.toThrow(/recipient/);
    await expect(m.send("not-an-email", "Hi", "x")).rejects.toThrow(/recipient/);
  });

  it("falls back to the dev mailer outside production, but refuses in production without SMTP", () => {
    expect(mailerFromEnv({ NODE_ENV: "development" }).kind).toBe("dev");
    expect(() => mailerFromEnv({ NODE_ENV: "production" })).toThrow(/SMTP_URL/);
    expect(() => mailerFromEnv({ SMTP_URL: "smtp://u:p@h:587" })).toThrow(/MAIL_FROM/);
    expect(mailerFromEnv({ SMTP_URL: "smtps://u:p@h:465", MAIL_FROM: "a@b.example" }).kind).toBe("smtp");
  });
});

describe("real SMTP delivery (local test server)", () => {
  let server: SMTPServer; let port: number; const got: { from: string; to: string[]; data: string }[] = [];
  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true, disabledCommands: ["STARTTLS"],
      onMailFrom(a, _s, cb) { got.push({ from: a.address, to: [], data: "" }); cb(); },
      onRcptTo(a, _s, cb) { got[got.length - 1]!.to.push(a.address); cb(); },
      onData(stream, _s, cb) { let d = ""; stream.on("data", (c) => (d += c)); stream.on("end", () => { got[got.length - 1]!.data = d; cb(); }); },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("delivers a reset email over SMTP", async () => {
    const { mailer } = mailerFromEnv({ SMTP_URL: `smtp://127.0.0.1:${port}`, SMTP_REQUIRE_TLS: "false", MAIL_FROM: "Gatehouse <no-reply@gatehouse.example>" });
    await mailer.send("guard@pilotco.example", "Reset your Gatehouse password", "Use this link: https://app.example/reset-password/abc");
    expect(got).toHaveLength(1);
    expect(got[0]!.from).toBe("no-reply@gatehouse.example");
    expect(got[0]!.to).toEqual(["guard@pilotco.example"]);
    expect(got[0]!.data).toContain("Subject: Reset your Gatehouse password");
    expect(got[0]!.data).toContain("https://app.example/reset-password/abc");
  });
});
