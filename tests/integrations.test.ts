import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { mapTwilioStatus, parseTwilioForm, verifyTwilioSignature } from "@/lib/twilio";
import { TELE_MANAS, telHref } from "@/lib/helpline";

const TOKEN = "test-token-not-real";
const URL_ = "https://resqora.lovable.app/api/public/sms-inbound";
function sign(params: Record<string, string>) {
  const data = URL_ + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", TOKEN).update(data).digest("base64");
}

describe("Twilio SMS webhook", () => {
  const raw = "MessageSid=SM" + "a".repeat(32) + "&From=%2B919876543210&Body=HELP+Charminar";
  it("parses a HELP form body", () => {
    const p = parseTwilioForm(raw);
    expect(p["Body"]).toBe("HELP Charminar");
    expect(p["From"]).toBe("+919876543210");
  });
  it("accepts a valid signature and rejects tampering", () => {
    const p = parseTwilioForm(raw);
    const sig = sign(p);
    expect(verifyTwilioSignature(URL_, p, sig, TOKEN)).toBe(true);
    expect(verifyTwilioSignature(URL_, { ...p, Body: "SAFE" }, sig, TOKEN)).toBe(false);
    expect(verifyTwilioSignature(URL_, p, null, TOKEN)).toBe(false);
    expect(verifyTwilioSignature(URL_, p, sig, "wrong")).toBe(false);
  });
  it("only reports delivered when Twilio says delivered", () => {
    expect(mapTwilioStatus("queued")).toBe("sent");
    expect(mapTwilioStatus("sent")).toBe("sent");
    expect(mapTwilioStatus("delivered")).toBe("delivered");
    expect(mapTwilioStatus("undelivered")).toBe("failed");
    expect(mapTwilioStatus("bogus")).toBeNull();
  });
});

describe("Tele-MANAS helpline", () => {
  it("dials 14416 and the alternate number via tel: links only", () => {
    expect(telHref(TELE_MANAS.primary)).toBe("tel:14416");
    expect(telHref(TELE_MANAS.alternate)).toBe("tel:18008914416");
  });
});
