import { describe, expect, it } from "vitest";
import { parseSender, providerRequest } from "../src/lib/mailer.ts";

const msg = { to: "cook@example.test", subject: "Your Better Plate code: 123456", text: "Your sign-in code is 123456." };

describe("email providers", () => {
  it("parses named and bare senders", () => {
    expect(parseSender("The Better Plate <login@example.test>")).toEqual({ name: "The Better Plate", email: "login@example.test" });
    expect(parseSender("login@example.test")).toEqual({ email: "login@example.test" });
  });

  it("builds a Resend request", () => {
    const r = providerRequest("resend", "k", "Plate <a@example.test>", msg);
    expect(r.url).toBe("https://api.resend.com/emails");
    expect(r.headers.Authorization).toBe("Bearer k");
    expect(r.body).toEqual({ from: "Plate <a@example.test>", to: ["cook@example.test"], subject: msg.subject, text: msg.text });
  });

  it("builds a Brevo request", () => {
    const r = providerRequest("brevo", "k", "Plate <a@example.test>", msg);
    expect(r.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(r.headers).toMatchObject({ "api-key": "k" });
    expect(r.body).toEqual({ sender: { name: "Plate", email: "a@example.test" }, to: [{ email: "cook@example.test" }], subject: msg.subject, textContent: msg.text });
  });
});
