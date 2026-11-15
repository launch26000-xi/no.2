// Twilio webhooks (calls and texts).
import express from "express";
import twilio from "twilio";
import { settings, wsUrl, findBusinessByNumber, findBusinessById, loadBusinesses, signCall, normalizePhone } from "./config.js";
import { greetingFor } from "./prompt.js";
import { industryPack } from "./industries.js";
import { requireTwilioSignature, messenger } from "./twilio.js";
import { llm } from "./llm.js";
import * as db from "./db.js";

const { VoiceResponse, MessagingResponse } = twilio.twiml;

function sendTwiml(res, twiml) {
  res.type("text/xml").send(twiml.toString());
}

export function twilioRoutes() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false }));
  r.use(requireTwilioSignature);

  // A call comes in (directly, or forwarded from the business's own phone).
  r.post("/voice/incoming", (req, res) => {
    const vr = new VoiceResponse();
    const { To, From, CallSid } = req.body;
    const business = findBusinessByNumber(To);
    if (!business) {
      vr.say("Sorry, this number is not set up yet. Goodbye.");
      vr.hangup();
      return sendTwiml(res, vr);
    }
    // Loop guard: a transfer to an owner who doesn't answer can be forwarded straight back here.
    const ourNumbers = new Set(loadBusinesses().map((b) => b.twilio_number));
    if (ourNumbers.has(normalizePhone(From))) {
      vr.reject();
      return sendTwiml(res, vr);
    }
    const connect = vr.connect({ action: `${settings.publicUrl}/voice/after?biz=${encodeURIComponent(business.id)}` });
    const relayAttrs = {
      url: `${wsUrl()}/relay?sig=${signCall(CallSid)}`,
      welcomeGreeting: greetingFor(business),
      welcomeGreetingInterruptible: "any",
      interruptible: "any",
      dtmfDetection: true,
      hints: industryPack(business.industry).hints,
    };
    if (business.tts_provider || settings.ttsProvider) relayAttrs.ttsProvider = business.tts_provider || settings.ttsProvider;
    if (business.voice || settings.ttsVoice) relayAttrs.voice = business.voice || settings.ttsVoice;
    const relay = connect.conversationRelay(relayAttrs);
    relay.parameter({ name: "businessId", value: business.id });
    sendTwiml(res, vr);
  });

  // The AI conversation ended: transfer, hang up, or fall back to voicemail if the AI failed.
  r.post("/voice/after", (req, res) => {
    const vr = new VoiceResponse();
    const business = findBusinessById(req.query.biz);
    let handoff = null;
    try {
      handoff = req.body.HandoffData ? JSON.parse(req.body.HandoffData) : null;
    } catch {
      handoff = null;
    }
    if (handoff?.type === "transfer" && business) {
      const dial = vr.dial({
        callerId: business.twilio_number,
        timeout: 20, // shorter than most carriers' no-answer forwarding, so calls don't loop back
        action: `${settings.publicUrl}/voice/dial-status?biz=${encodeURIComponent(business.id)}&caller=${encodeURIComponent(req.body.From || "")}`,
      });
      const whisper = `Call from ${business.name} receptionist. ${handoff.summary || ""}`.slice(0, 300);
      dial.number({ url: `${settings.publicUrl}/voice/whisper?text=${encodeURIComponent(whisper)}` }, handoff.to);
      return sendTwiml(res, vr);
    }
    if (!handoff && req.body.CallStatus === "in-progress" && business) {
      // The AI connection dropped. Never lose the caller: take a voicemail.
      vr.say("Sorry, we're having a technical problem. Please leave your name, number, and what you need after the tone, and we'll call you right back.");
      vr.record({ maxLength: 120, playBeep: true, action: `${settings.publicUrl}/voice/voicemail?biz=${encodeURIComponent(business.id)}` });
      return sendTwiml(res, vr);
    }
    vr.hangup();
    sendTwiml(res, vr);
  });

  // Played only to the team member who picks up a transfer.
  r.post("/voice/whisper", (req, res) => {
    const vr = new VoiceResponse();
    vr.say(String(req.query.text || "Call from your receptionist."));
    sendTwiml(res, vr);
  });

  r.post("/voice/dial-status", async (req, res) => {
    const vr = new VoiceResponse();
    const business = findBusinessById(req.query.biz);
    if (req.body.DialCallStatus !== "completed") {
      vr.say("Sorry, they couldn't pick up right now. I've sent them your details and they'll call you back shortly. Goodbye.");
      vr.hangup();
      if (business) {
        const msg = `Missed transfer from ${business.name} receptionist. Please call back ${req.query.caller || "the caller"}. Details are in the call summary text.`;
        await Promise.all(business.alert_numbers.map((n) => messenger.sendSms(business.twilio_number, n, msg)));
      }
    } else {
      vr.hangup();
    }
    sendTwiml(res, vr);
  });

  r.post("/voice/voicemail", async (req, res) => {
    const vr = new VoiceResponse();
    vr.say("Thanks, we got your message. Goodbye.");
    vr.hangup();
    sendTwiml(res, vr);
    const business = findBusinessById(req.query.biz);
    if (!business) return;
    const { CallSid, From, To, RecordingUrl } = req.body;
    db.startCall({ callSid: CallSid, businessId: business.id, from: normalizePhone(From), to: normalizePhone(To) });
    db.updateCall(CallSid, { voicemail_url: RecordingUrl, outcome: "qualified_lead", billable: 0 });
    const msg = `🎙 Voicemail for ${business.name} from ${From}: ${RecordingUrl}.mp3`;
    await Promise.all(business.alert_numbers.map((n) => messenger.sendSms(business.twilio_number, n, msg)));
  });

  // A text message comes in.
  r.post("/sms/incoming", (req, res) => {
    sendTwiml(res, new MessagingResponse()); // answer Twilio right away; reply is sent separately
    handleSms(req.body).catch((err) => console.error("SMS handling failed:", err));
  });

  return r;
}

const OPT_OUT = /^(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|help|info)$/i;

export async function handleSms({ From, To, Body }) {
  const business = findBusinessByNumber(To);
  if (!business) return;
  const from = normalizePhone(From);
  const body = String(Body || "").trim();
  if (!body || OPT_OUT.test(body)) return; // Twilio handles opt-out keywords itself

  if (business.alert_numbers.includes(from)) {
    const month = new Date().toISOString().slice(0, 7);
    const calls = db.listCalls({ businessId: business.id, month, limit: 10000 });
    const booked = calls.filter((c) => c.outcome === "job_booked").length;
    const leads = calls.filter((c) => c.outcome === "qualified_lead").length;
    const reply = `${business.name} this month: ${calls.length} calls, ${booked} booked, ${leads} leads. Dashboard: ${settings.publicUrl}/admin`;
    return messenger.sendSms(business.twilio_number, from, reply);
  }

  db.logSms(business.id, from, "in", body);
  const history = [];
  for (const m of db.smsThread(business.id, from)) {
    const role = m.direction === "in" ? "user" : "assistant";
    const last = history.at(-1);
    if (last?.role === role) last.content += `\n${m.body}`;
    else history.push({ role, content: m.body });
  }
  while (history[0]?.role === "assistant") history.shift();
  if (!history.length) return;
  history[0].content = `[Text from ${from}]\n${history[0].content}`;

  const out = await llm.smsReply({ business, history });
  await messenger.sendSms(business.twilio_number, from, out.reply);
  db.logSms(business.id, from, "out", out.reply);

  if (out.job_request) {
    const j = out.job_request;
    db.saveLead({
      business_id: business.id,
      source: "sms",
      phone: from,
      name: j.name,
      address: j.service_address,
      service: j.job_description,
      urgency: j.urgency,
      preferred_time: j.preferred_time,
      notes: j.notes,
    });
    const tag = j.urgency === "emergency" ? "🚨 EMERGENCY " : "";
    const alert = `${tag}New job request by text\n${j.name} ${from}\n${j.job_description}\n${j.service_address}\nWhen: ${j.preferred_time || "not given"}`;
    await Promise.all(business.alert_numbers.map((n) => messenger.sendSms(business.twilio_number, n, alert)));
  }
}
