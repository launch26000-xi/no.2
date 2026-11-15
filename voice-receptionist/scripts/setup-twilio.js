// One-time setup for a business: buys a Twilio number (or uses one you have), writes the
// business into config/businesses.json, points the number at your server, and prints the
// code to dial on the owner's cell phone so unanswered calls forward to the receptionist.
//
// Usage: npm run setup            (asks questions)
//        npm run setup -- --list  (shows configured businesses)
import readline from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { settings, loadBusinesses, normalizePhone } from "../src/config.js";
import { twilioClient, syncNumberWebhooks } from "../src/twilio.js";
import { INDUSTRIES } from "../src/industries.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = "") => (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def;

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
}

function readConfig() {
  const file = settings.businessesFile;
  if (!fs.existsSync(file)) return { businesses: [] };
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(raw) ? { businesses: raw } : raw;
}

export function forwardingInstructions(twilioNumber) {
  const digits = twilioNumber.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return `
On the business owner's cell phone, dial ONE of these (then press call) to forward
calls they don't answer, decline, or miss to the receptionist:

  Verizon:                *71${digits}           (turn off: *73)
  AT&T / T-Mobile / most others (GSM):
     no answer:           **61*1${digits}#
     busy / declined:     **67*1${digits}#
     phone off / no signal: **62*1${digits}#
     all three at once:   **004*1${digits}#      (turn off: ##004#)
  Landline / VoIP office lines: use the provider's "forward on no answer" or "call
  forward busy/no answer" setting and enter ${twilioNumber}.

Or put ${twilioNumber} on the business's website, Google Business Profile, and truck
wraps so the receptionist answers every call directly (owner gets live transfers).
`;
}

async function main() {
  if (process.argv.includes("--list")) {
    for (const b of loadBusinesses()) console.log(`${b.id}\t${b.twilio_number}\t${b.name}`);
    return;
  }
  const client = twilioClient();
  if (!client) {
    console.log("Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env first (from console.twilio.com).");
    return;
  }

  console.log("\nNew receptionist client\n");
  const name = await ask("Business name", "Demo Plumbing");
  const industry = await ask(`Trade (${Object.keys(INDUSTRIES).join(", ")})`, "plumbing");
  const ownerName = await ask("Owner's first name", "Owner");
  const ownerCell = normalizePhone(await ask("Owner's cell phone (gets alerts and transfers)"));
  const serviceArea = await ask("Service area", "");
  const hours = await ask("Business hours", "Mon-Fri 8am-5pm");
  const timezone = await ask("Time zone", "America/Denver");
  let twilioNumber = normalizePhone(await ask("Existing Twilio number to use (blank = buy a new one)", ""));

  if (!twilioNumber) {
    const areaCode = await ask("Area code for the new number", ownerCell.slice(2, 5) || "303");
    const found = await client.availablePhoneNumbers("US").local.list({ areaCode: Number(areaCode), voiceEnabled: true, smsEnabled: true, limit: 1 });
    if (!found.length) throw new Error(`No numbers available in area code ${areaCode}. Try a nearby one.`);
    const ok = await ask(`Buy ${found[0].friendlyName} (about $1.15/month)? yes/no`, "yes");
    if (!/^y/i.test(ok)) return;
    const bought = await client.incomingPhoneNumbers.create({ phoneNumber: found[0].phoneNumber, friendlyName: `${name} receptionist` });
    twilioNumber = bought.phoneNumber;
    console.log(`Bought ${twilioNumber}`);
  }

  const cfg = readConfig();
  const id = slug(name);
  const entry = {
    id,
    name,
    industry,
    owner_name: ownerName,
    twilio_number: twilioNumber,
    alert_numbers: ownerCell ? [ownerCell] : [],
    contacts: ownerCell ? [{ name: ownerName, role: "owner", phone: ownerCell, when: "it's an emergency, an existing customer with an active job, or the caller insists on speaking with the owner" }] : [],
    service_area: serviceArea,
    hours,
    timezone,
    services: [],
    pricing_notes: "",
    booking_policy: "Take the caller's preferred day and time window; the team confirms by text within the hour during business hours.",
    faq: [],
    missed_call_textback: true,
    billing: { monthly_fee: 297, per_booked_job: 25, per_qualified_lead: 10 },
  };
  cfg.businesses = (cfg.businesses || []).filter((b) => b.id !== id);
  cfg.businesses.push(entry);
  fs.mkdirSync(path.dirname(settings.businessesFile), { recursive: true });
  fs.writeFileSync(settings.businessesFile, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`Saved ${id} to ${settings.businessesFile}. Edit it to add services, prices, and FAQs.`);

  if (settings.publicUrl) {
    for (const line of await syncNumberWebhooks()) console.log(line);
  } else {
    console.log("PUBLIC_URL is not set yet; the server connects the number automatically when it starts with PUBLIC_URL set.");
  }
  console.log("\nIf your server runs on Render or another host, set its BUSINESSES_JSON variable to this one line:\n");
  console.log(JSON.stringify(cfg));
  console.log(forwardingInstructions(twilioNumber));
}

main()
  .catch((err) => console.error("Setup failed:", err.message))
  .finally(() => rl.close());
