// Loads environment settings and the list of businesses this server answers for.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");

// Minimal .env loader so the server runs without extra packages.
function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2];
    if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

const env = process.env;

export const settings = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "").replace(/\/$/, ""),
  model: env.CLAUDE_MODEL || "claude-opus-5-5",
  // Phone calls need fast replies, so the live conversation runs at low effort.
  callEffort: env.CALL_EFFORT || "low",
  useFallbacks: env.USE_FALLBACKS !== "false",
  twilioSid: env.TWILIO_ACCOUNT_SID || "",
  twilioToken: env.TWILIO_AUTH_TOKEN || "",
  adminPassword: env.ADMIN_PASSWORD || "",
  dataDir: env.DATA_DIR || path.join(ROOT, "data"),
  businessesFile: env.BUSINESSES_FILE || path.join(ROOT, "config", "businesses.json"),
  // Used to sign per-call WebSocket URLs so only Twilio calls can reach the AI.
  secret: env.APP_SECRET || env.TWILIO_AUTH_TOKEN || crypto.randomBytes(32).toString("hex"),
  ttsProvider: env.TTS_PROVIDER || "",
  ttsVoice: env.TTS_VOICE || "",
};

export function wsUrl() {
  return settings.publicUrl.replace(/^http/, "ws");
}

let cache = null;
let cacheMtime = 0;

/** Returns all configured businesses. Re-reads the file when it changes. */
export function loadBusinesses() {
  // On a host like Render, the whole config can live in one environment variable.
  if (process.env.BUSINESSES_JSON) {
    if (!cache || cacheMtime !== -1) {
      const raw = JSON.parse(process.env.BUSINESSES_JSON);
      cache = (Array.isArray(raw) ? raw : raw.businesses || []).map(normalizeBusiness);
      cacheMtime = -1;
    }
    return cache;
  }
  const file = settings.businessesFile;
  if (!fs.existsSync(file)) {
    cache = [];
    return cache;
  }
  const mtime = fs.statSync(file).mtimeMs;
  if (cache && mtime === cacheMtime) return cache;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const list = Array.isArray(raw) ? raw : raw.businesses || [];
  cache = list.map(normalizeBusiness);
  cacheMtime = mtime;
  return cache;
}

export function normalizeBusiness(b) {
  return {
    industry: "general",
    timezone: "America/Denver",
    contacts: [],
    alert_numbers: [],
    services: [],
    faq: [],
    missed_call_textback: true,
    billing: { monthly_fee: 0, per_booked_job: 0, per_qualified_lead: 0 },
    ...b,
    twilio_number: normalizePhone(b.twilio_number),
    alert_numbers: (b.alert_numbers || []).map(normalizePhone),
    contacts: (b.contacts || []).map((c) => ({ ...c, phone: normalizePhone(c.phone) })),
  };
}

export function findBusinessByNumber(number) {
  const n = normalizePhone(number);
  return loadBusinesses().find((b) => b.twilio_number === n) || null;
}

export function findBusinessById(id) {
  return loadBusinesses().find((b) => b.id === id) || null;
}

/** Turns "(303) 555-1234" or "3035551234" into "+13035551234" (US default). */
export function normalizePhone(p) {
  if (!p) return "";
  const s = String(p).trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits ? "+" + digits : "";
}

export function signCall(callSid) {
  return crypto.createHmac("sha256", settings.secret).update(callSid).digest("hex").slice(0, 32);
}

export function verifyCallSignature(callSid, sig) {
  if (!callSid || !sig) return false;
  const expected = Buffer.from(signCall(callSid));
  const given = Buffer.from(String(sig));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
