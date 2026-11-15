// Twilio helpers: sending texts, checking webhook signatures, and pointing phone numbers at this server.
import twilio from "twilio";
import { settings, loadBusinesses } from "./config.js";

let client;
export function twilioClient() {
  if (!settings.twilioSid || !settings.twilioToken) return null;
  client ??= twilio(settings.twilioSid, settings.twilioToken);
  return client;
}

// Swappable for tests.
export const messenger = {
  async sendSms(from, to, body) {
    const c = twilioClient();
    if (!c || !to) {
      console.log(`[sms not sent: no Twilio credentials] ${from} -> ${to}: ${body}`);
      return null;
    }
    try {
      return await c.messages.create({ from, to, body: body.slice(0, 1500) });
    } catch (err) {
      console.error(`SMS to ${to} failed:`, err.message);
      return null;
    }
  },
};

/** Express middleware: rejects webhook requests that weren't signed by Twilio. */
export function requireTwilioSignature(req, res, next) {
  if (!settings.twilioToken || process.env.SKIP_TWILIO_SIGNATURE === "true") return next();
  const signature = req.header("X-Twilio-Signature") || "";
  const url = settings.publicUrl + req.originalUrl;
  if (twilio.validateRequest(settings.twilioToken, signature, url, req.body || {})) return next();
  console.warn(`Rejected unsigned request to ${req.originalUrl}`);
  res.status(403).send("Forbidden");
}

/** Points every configured business number's voice and SMS webhooks at this server. */
export async function syncNumberWebhooks() {
  const c = twilioClient();
  if (!c || !settings.publicUrl) return [];
  const results = [];
  for (const b of loadBusinesses()) {
    if (!b.twilio_number) continue;
    try {
      const [num] = await c.incomingPhoneNumbers.list({ phoneNumber: b.twilio_number, limit: 1 });
      if (!num) {
        results.push(`${b.id}: ${b.twilio_number} is not in this Twilio account`);
        continue;
      }
      const voiceUrl = `${settings.publicUrl}/voice/incoming`;
      const smsUrl = `${settings.publicUrl}/sms/incoming`;
      if (num.voiceUrl !== voiceUrl || num.smsUrl !== smsUrl) {
        await c.incomingPhoneNumbers(num.sid).update({ voiceUrl, voiceMethod: "POST", smsUrl, smsMethod: "POST" });
        results.push(`${b.id}: webhooks updated for ${b.twilio_number}`);
      } else {
        results.push(`${b.id}: ${b.twilio_number} already connected`);
      }
    } catch (err) {
      results.push(`${b.id}: could not update ${b.twilio_number}: ${err.message}`);
    }
  }
  return results;
}
