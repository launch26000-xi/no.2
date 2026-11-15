// Handles one live phone call over Twilio ConversationRelay.
// Twilio turns the caller's speech into text and sends it here; we stream Claude's reply
// back as text, which Twilio speaks. Protocol: https://www.twilio.com/docs/voice/conversationrelay
import { findBusinessById, findBusinessByNumber, verifyCallSignature, normalizePhone } from "./config.js";
import { llm, ToolInputs } from "./llm.js";
import { callContextNote, greetingFor } from "./prompt.js";
import * as db from "./db.js";
import { messenger } from "./twilio.js";
import { finalizeCall } from "./postcall.js";

const MS_PER_CHAR_SPOKEN = 70; // rough text-to-speech pace, used to let goodbyes finish before hanging up

export class CallSession {
  constructor(ws, { sig } = {}) {
    this.ws = ws;
    this.sig = sig;
    this.business = null;
    this.callSid = "";
    this.from = "";
    this.to = "";
    this.messages = [];
    this.transcript = [];
    this.inflight = null; // AbortController for the reply being generated
    this.queue = Promise.resolve();
    this.pendingAction = null;
    this.leadAlerts = 0;
    this.ended = false;
    this.interruptNote = "";
  }

  send(obj) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  log(role, text) {
    if (text && text.trim()) this.transcript.push({ role, text: text.trim(), at: new Date().toISOString() });
  }

  async handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "setup":
        return this.onSetup(msg);
      case "prompt":
        if (msg.last === false) return; // partial transcript; wait for the full sentence
        this.log("caller", msg.voicePrompt);
        return this.respond(msg.voicePrompt || "");
      case "dtmf":
        this.log("caller", `[pressed ${msg.digit}]`);
        return this.respond(`[The caller pressed ${msg.digit} on their keypad]`);
      case "interrupt":
        this.cancelInflight();
        if (msg.utteranceUntilInterrupt) {
          this.interruptNote = `[You were interrupted. The caller only heard: "${msg.utteranceUntilInterrupt}"]`;
        }
        return;
      case "error":
        console.error(`[${this.callSid}] ConversationRelay error:`, msg.description);
        return;
      default:
        return;
    }
  }

  onSetup(msg) {
    this.callSid = msg.callSid;
    this.from = normalizePhone(msg.from);
    this.to = normalizePhone(msg.to);
    if (!verifyCallSignature(this.callSid, this.sig)) {
      console.warn(`Rejected relay connection with a bad signature for ${this.callSid}`);
      this.ws.close();
      return;
    }
    const bizId = msg.customParameters?.businessId;
    this.business = (bizId && findBusinessById(bizId)) || findBusinessByNumber(this.to);
    if (!this.business) {
      console.error(`No business configured for ${this.to}`);
      this.send({ type: "text", token: "Sorry, this line isn't set up yet. Goodbye.", last: true });
      setTimeout(() => this.send({ type: "end" }), 3000);
      return;
    }
    db.startCall({ callSid: this.callSid, businessId: this.business.id, from: this.from, to: this.to });
    this.log("agent", greetingFor(this.business));
    console.log(`[${this.callSid}] call for ${this.business.name} from ${this.from}`);
  }

  cancelInflight() {
    if (this.inflight) {
      this.inflight.abort();
      this.inflight = null;
    }
  }

  /** Queue a reply so turns never overlap; a new caller sentence cancels the old reply. */
  respond(userText) {
    if (!this.business || this.ended) return;
    this.cancelInflight();
    const controller = new AbortController();
    this.inflight = controller;
    this.queue = this.queue.then(() => this.runTurn(userText, controller)).catch((err) => {
      console.error(`[${this.callSid}] turn failed:`, err);
    });
    return this.queue;
  }

  addUserText(text) {
    let content = text;
    if (this.messages.length === 0) content = `${callContextNote(this.business, this.from)}\n${text}`;
    if (this.interruptNote) {
      content = `${this.interruptNote}\n${content}`;
      this.interruptNote = "";
    }
    const last = this.messages.at(-1);
    if (last?.role === "user") {
      // Previous reply was cancelled before any words; merge into the same turn.
      const blocks = Array.isArray(last.content) ? last.content : [{ type: "text", text: last.content }];
      last.content = [...blocks, { type: "text", text: content }];
    } else {
      this.messages.push({ role: "user", content });
    }
  }

  /** If a reply was cut off after asking for tools, close those tool calls so history stays valid. */
  repairHistory() {
    const last = this.messages.at(-1);
    if (last?.role !== "assistant" || !Array.isArray(last.content)) return;
    const uses = last.content.filter((b) => b.type === "tool_use");
    if (uses.length) {
      this.messages.push({
        role: "user",
        content: uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, content: "Cancelled: the caller interrupted.", is_error: true })),
      });
    }
  }

  async runTurn(userText, controller) {
    if (controller.signal.aborted) {
      // Still keep what the caller said.
      this.repairHistory();
      this.addUserText(userText);
      return;
    }
    this.repairHistory();
    this.addUserText(userText);

    for (let step = 0; step < 6; step++) {
      let spoken = "";
      let final;
      try {
        final = await llm.streamCallTurn({
          business: this.business,
          messages: this.messages,
          signal: controller.signal,
          onText: (delta) => {
            if (controller.signal.aborted) return;
            spoken += delta;
            this.send({ type: "text", token: delta, last: false });
          },
        });
      } catch (err) {
        if (controller.signal.aborted) {
          if (spoken.trim()) {
            this.messages.push({ role: "assistant", content: [{ type: "text", text: spoken }] });
            this.log("agent", spoken + " [interrupted]");
          }
          return;
        }
        console.error(`[${this.callSid}] Claude error:`, err.message);
        const sorry = "Sorry, I'm having trouble on my end. Let me make sure the team calls you right back.";
        this.send({ type: "text", token: sorry, last: true });
        this.log("agent", sorry);
        this.pendingAction = { type: "end", reason: "ai_error" };
        return this.finishAction(sorry);
      }

      this.send({ type: "text", token: "", last: true });
      this.messages.push({ role: "assistant", content: final.content });
      this.log("agent", spoken);

      if (final.stop_reason === "refusal") {
        const msg = "Let me have someone from the team call you back about that.";
        this.send({ type: "text", token: msg, last: true });
        this.log("agent", msg);
        return;
      }
      if (final.stop_reason !== "tool_use") {
        if (this.pendingAction) return this.finishAction(spoken);
        return;
      }

      const results = [];
      for (const block of final.content) {
        if (block.type !== "tool_use") continue;
        results.push(await this.runTool(block));
      }
      if (controller.signal.aborted) {
        this.messages.push({ role: "user", content: results });
        return;
      }
      this.messages.push({ role: "user", content: results });
      // Transfers and hang-ups happen right after the line Claude just spoke.
      if (this.pendingAction) return this.finishAction(spoken);
    }
  }

  async runTool(block) {
    const schema = ToolInputs[block.name];
    const parsed = schema?.safeParse(block.input);
    if (!parsed?.success) {
      return { type: "tool_result", tool_use_id: block.id, content: "Invalid input, try again.", is_error: true };
    }
    const input = parsed.data;
    const b = this.business;
    let content = "Done.";
    switch (block.name) {
      case "record_job_request": {
        db.saveLead({
          business_id: b.id,
          source: "call",
          call_sid: this.callSid,
          phone: input.callback_number || this.from,
          name: input.name,
          address: input.service_address,
          service: input.job_description,
          urgency: input.urgency,
          preferred_time: input.preferred_time,
          notes: input.notes,
        });
        const tag = input.urgency === "emergency" ? "🚨 EMERGENCY " : "";
        const verb = this.leadAlerts++ ? "Updated" : "New";
        const alert =
          `${tag}${verb} job request (call in progress)\n${input.name || "Unknown"} ${input.callback_number || this.from}\n` +
          `${input.job_description}\n${input.service_address}\nWhen: ${input.preferred_time || "not given"}` +
          (input.notes ? `\nNotes: ${input.notes}` : "");
        await Promise.all(b.alert_numbers.map((n) => messenger.sendSms(b.twilio_number, n, alert)));
        content = "Saved and the owner has been alerted by text.";
        break;
      }
      case "send_text_to_caller": {
        await messenger.sendSms(b.twilio_number, this.from, input.message);
        db.logSms(b.id, this.from, "out", input.message);
        this.log("system", `[texted caller: ${input.message}]`);
        content = "Text sent.";
        break;
      }
      case "transfer_call": {
        const contact = b.contacts.find((c) => c.name === input.contact_name);
        if (!contact?.phone) {
          return { type: "tool_result", tool_use_id: block.id, content: "That person can't take transfers. Take a message instead.", is_error: true };
        }
        this.pendingAction = { type: "transfer", to: contact.phone, name: contact.name, summary: input.summary_for_staff, reason: input.reason };
        this.log("system", `[transferring to ${contact.name}: ${input.reason}]`);
        content = "The transfer starts as soon as you finish your current sentence. Don't say anything more.";
        break;
      }
      case "end_call": {
        this.pendingAction = { type: "end", reason: input.reason };
        this.log("system", `[call ended by receptionist: ${input.reason}]`);
        content = "Hanging up now. Don't say anything more.";
        break;
      }
    }
    return { type: "tool_result", tool_use_id: block.id, content };
  }

  async finishAction(lastSpoken) {
    const action = this.pendingAction;
    if (!action || this.ended) return;
    this.ended = true;
    const wait = Math.min(10_000, (lastSpoken || "").length * MS_PER_CHAR_SPOKEN + 600);
    await new Promise((r) => setTimeout(r, wait));
    if (action.type === "transfer") db.updateCall(this.callSid, { transferred_to: `${action.name} ${action.to}` });
    this.send({ type: "end", handoffData: JSON.stringify(action) });
  }

  async onClose() {
    this.cancelInflight();
    if (!this.business || !this.callSid) return;
    try {
      await finalizeCall({ business: this.business, callSid: this.callSid, from: this.from, transcript: this.transcript });
    } catch (err) {
      console.error(`[${this.callSid}] finalize failed:`, err);
    }
  }
}

export function attachRelay(wss) {
  wss.on("connection", (ws, req) => {
    const sig = new URL(req.url, "http://x").searchParams.get("sig");
    const session = new CallSession(ws, { sig });
    ws.on("message", (data) => session.handleMessage(data));
    ws.on("close", () => session.onClose());
    ws.on("error", (err) => console.error("relay socket error:", err.message));
  });
}
