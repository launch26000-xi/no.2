// End-to-end test of a phone call and a text conversation with Claude and Twilio stubbed out.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "receptionist-"));
process.env.DATA_DIR = tmp;
process.env.BUSINESSES_FILE = path.join(tmp, "businesses.json");
process.env.PUBLIC_URL = "https://example.test";
process.env.APP_SECRET = "test-secret";
process.env.ADMIN_PASSWORD = "pw";
process.env.TWILIO_AUTH_TOKEN = "";
fs.writeFileSync(
  process.env.BUSINESSES_FILE,
  JSON.stringify({
    businesses: [
      {
        id: "acme",
        name: "Acme Plumbing",
        industry: "plumbing",
        twilio_number: "(303) 555-0100",
        alert_numbers: ["303-555-0199"],
        contacts: [{ name: "Mike", role: "owner", phone: "3035550199", when: "emergencies" }],
        billing: { monthly_fee: 199, per_booked_job: 25, per_qualified_lead: 10 },
      },
    ],
  })
);

const { createServer } = await import("../src/server.js");
const { setLlm } = await import("../src/llm.js");
const { messenger } = await import("../src/twilio.js");
const { signCall } = await import("../src/config.js");
const db = await import("../src/db.js");
const { handleSms } = await import("../src/routes.js");

const sent = [];
messenger.sendSms = async (from, to, body) => sent.push({ from, to, body });

let server;
let port;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
after(() => server.close());

function post(pathname, form) {
  return fetch(`http://localhost:${port}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  }).then((r) => r.text());
}

test("incoming call returns ConversationRelay TwiML with a signed URL", async () => {
  const xml = await post("/voice/incoming", { CallSid: "CA1", From: "+17205550123", To: "+13035550100" });
  assert.match(xml, /<ConversationRelay/);
  assert.match(xml, new RegExp(`wss://example.test/relay\\?sig=${signCall("CA1")}`));
  assert.match(xml, /Acme Plumbing/);
  assert.match(xml, /name="businessId" value="acme"/);
});

test("calls from our own number are rejected (forwarding loop guard)", async () => {
  const xml = await post("/voice/incoming", { CallSid: "CA2", From: "+13035550100", To: "+13035550100" });
  assert.match(xml, /<Reject/);
});

test("full call: greeting, lead capture, transfer, summary, billing", async () => {
  let turn = 0;
  setLlm({
    async streamCallTurn({ messages, onText }) {
      turn++;
      if (turn === 1) {
        assert.match(messages[0].content, /Caller ID: \+17205550123/);
        onText("Oh no, ");
        onText("let me get your info.");
        return {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Oh no, let me get your info." },
            {
              type: "tool_use",
              id: "t1",
              name: "record_job_request",
              input: {
                name: "Jane Doe",
                callback_number: "7205550123",
                service_address: "12 Elm St, Denver",
                job_description: "Burst pipe in basement",
                urgency: "emergency",
                preferred_time: "now",
                notes: "",
              },
            },
          ],
        };
      }
      if (turn === 2) {
        onText("Got it. Connecting you to Mike now.");
        return {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Got it. Connecting you to Mike now." },
            { type: "tool_use", id: "t2", name: "transfer_call", input: { contact_name: "Mike", reason: "emergency", summary_for_staff: "Burst pipe at 12 Elm" } },
          ],
        };
      }
      throw new Error("unexpected turn");
    },
    async summarizeCall({ transcriptText }) {
      assert.match(transcriptText, /Caller: My basement pipe burst/);
      return {
        caller_name: "Jane Doe",
        callback_number: "7205550123",
        service_address: "12 Elm St",
        service_requested: "burst pipe",
        urgency: "emergency",
        outcome: "job_booked",
        appointment_window: "today",
        estimated_job_value_usd: 600,
        follow_up_needed: "",
        summary: "Emergency burst pipe, transferred to Mike.",
      };
    },
  });

  const ws = new WebSocket(`ws://localhost:${port}/relay?sig=${signCall("CA9")}`);
  const received = [];
  ws.on("message", (d) => received.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "setup", callSid: "CA9", from: "+17205550123", to: "+13035550100", customParameters: { businessId: "acme" } }));
  ws.send(JSON.stringify({ type: "prompt", voicePrompt: "My basement pipe burst!", last: true }));

  const end = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no end message")), 8000);
    const iv = setInterval(() => {
      const e = received.find((m) => m.type === "end");
      if (e) {
        clearTimeout(t);
        clearInterval(iv);
        resolve(e);
      }
    }, 50);
  });
  const handoff = JSON.parse(end.handoffData);
  assert.equal(handoff.type, "transfer");
  assert.equal(handoff.to, "+13035550199");
  assert.ok(received.some((m) => m.type === "text" && m.token === "let me get your info."));
  assert.ok(sent.some((s) => s.to === "+13035550199" && /EMERGENCY/.test(s.body)), "owner got emergency alert");

  // Twilio then calls the action URL with the handoff data.
  const xml = await post("/voice/after?biz=acme", { HandoffData: end.handoffData, From: "+17205550123", CallStatus: "in-progress" });
  assert.match(xml, /<Dial[^>]*callerId="\+13035550100"/);
  assert.match(xml, /\+13035550199<\/Number>/);

  ws.close();
  await new Promise((r) => setTimeout(r, 300));
  const call = db.getCall("CA9");
  assert.equal(call.outcome, "job_booked");
  assert.equal(call.billable, 1);
  assert.match(call.transcript, /Burst|burst/);
  assert.equal(db.listLeads({ businessId: "acme" }).length, 1);

  const auth = { authorization: "Basic " + Buffer.from("admin:pw").toString("base64") };
  const html = await fetch(`http://localhost:${port}/admin/`, { headers: auth }).then((r) => r.text());
  assert.match(html, /\$224/, "monthly fee 199 + 25 booked job");
  const csv = await fetch(`http://localhost:${port}/admin/invoice.csv?biz=acme&month=${new Date().toISOString().slice(0, 7)}`, { headers: auth }).then((r) => r.text());
  assert.match(csv, /TOTAL",224/);
  const denied = await fetch(`http://localhost:${port}/admin/`);
  assert.equal(denied.status, 401);
});

test("relay rejects connections with a bad signature", async () => {
  const ws = new WebSocket(`ws://localhost:${port}/relay?sig=wrong`);
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "setup", callSid: "CAX", from: "+1", to: "+13035550100" }));
  await new Promise((r) => ws.on("close", r));
  assert.equal(db.getCall("CAX"), undefined);
});

test("caller who hangs up on the greeting gets a text back", async () => {
  const ws = new WebSocket(`ws://localhost:${port}/relay?sig=${signCall("CA10")}`);
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "setup", callSid: "CA10", from: "+17205550777", to: "+13035550100" }));
  await new Promise((r) => setTimeout(r, 100));
  ws.close();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(db.getCall("CA10").outcome, "hung_up_early");
  assert.ok(sent.some((s) => s.to === "+17205550777" && /Sorry we missed you/.test(s.body)));
});

test("text conversation replies and captures a lead", async () => {
  setLlm({
    async smsReply({ history }) {
      assert.equal(history[0].role, "user");
      return {
        reply: "Happy to help! We'll text you a time shortly.",
        job_request: { name: "Bob", service_address: "5 Oak Ave", job_description: "Paint 3 bedrooms", urgency: "flexible", preferred_time: "next week", notes: "" },
      };
    },
  });
  await handleSms({ From: "+17205550888", To: "+13035550100", Body: "Can you paint 3 bedrooms next week? I'm Bob at 5 Oak Ave" });
  assert.ok(sent.some((s) => s.to === "+17205550888" && /Happy to help/.test(s.body)));
  assert.ok(sent.some((s) => s.to === "+13035550199" && /New job request by text/.test(s.body)));
  assert.equal(db.smsThread("acme", "+17205550888").length, 2);
});
