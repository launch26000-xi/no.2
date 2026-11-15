// All calls to Claude live here: the live phone conversation, text replies, and
// the after-call summary that decides whether a call is billable.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { settings } from "./config.js";
import { buildCallSystemPrompt, buildSmsSystemPrompt } from "./prompt.js";

let client;
function anthropic() {
  client ??= new Anthropic();
  return client;
}

// If a request is declined by a safety filter, the API retries it on a fallback model.
function fallbackParams() {
  return settings.useFallbacks
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}

// ---------- Live call ----------

export const ToolInputs = {
  record_job_request: z.object({
    name: z.string(),
    callback_number: z.string(),
    service_address: z.string(),
    job_description: z.string(),
    urgency: z.enum(["emergency", "soon", "flexible", "estimate_only"]),
    preferred_time: z.string(),
    notes: z.string(),
  }),
  send_text_to_caller: z.object({ message: z.string() }),
  transfer_call: z.object({ contact_name: z.string(), reason: z.string(), summary_for_staff: z.string() }),
  end_call: z.object({ reason: z.string() }),
};

export function callTools(business) {
  const names = (business.contacts || []).map((c) => c.name);
  const tools = [
    {
      name: "record_job_request",
      description:
        "Save the caller's job request and alert the business owner by text right away. Call as soon as you have a name, callback number and what they need; use empty strings for unknown fields. Call again if details change.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Caller's full name" },
          callback_number: { type: "string", description: "Best number to reach them, in digits" },
          service_address: { type: "string", description: "Street address and city where the work is" },
          job_description: { type: "string", description: "What needs to be done, in plain words" },
          urgency: { type: "string", enum: ["emergency", "soon", "flexible", "estimate_only"] },
          preferred_time: { type: "string", description: "When they're available, as they said it" },
          notes: { type: "string", description: "Anything else useful: gate codes, pets, renter/owner, budget" },
        },
        required: ["name", "callback_number", "service_address", "job_description", "urgency", "preferred_time", "notes"],
        additionalProperties: false,
      },
    },
    {
      name: "send_text_to_caller",
      description: "Send a text message to the caller's phone, for example a confirmation of their request or the booking link. Keep it under 300 characters.",
      input_schema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
        additionalProperties: false,
      },
    },
    {
      name: "end_call",
      description: "Hang up after you have said goodbye, or to end a spam or sales call.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  ];
  if (names.length) {
    tools.splice(2, 0, {
      name: "transfer_call",
      description:
        "Connect the caller to a team member. Tell the caller you're connecting them first. If nobody answers, the caller is told the team will call back.",
      input_schema: {
        type: "object",
        properties: {
          contact_name: { type: "string", enum: names },
          reason: { type: "string" },
          summary_for_staff: { type: "string", description: "One sentence the team member hears before the call connects" },
        },
        required: ["contact_name", "reason", "summary_for_staff"],
        additionalProperties: false,
      },
    });
  }
  return tools.map((t) => ({ ...t, strict: true, eager_input_streaming: true }));
}

/**
 * Runs one assistant turn of the phone conversation, streaming spoken text through onText.
 * Returns the final message so the caller can append it to history and run any tools.
 */
async function streamCallTurn({ business, messages, onText, signal }) {
  const stream = anthropic().beta.messages.stream(
    {
      model: settings.model,
      max_tokens: 4000,
      output_config: { effort: settings.callEffort },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: buildCallSystemPrompt(business), cache_control: { type: "ephemeral" } }],
      tools: callTools(business),
      messages,
      ...fallbackParams(),
    },
    { signal }
  );
  stream.on("text", (delta) => onText(delta));
  return await stream.finalMessage();
}

// ---------- Text messages ----------

const SmsReply = z.object({
  reply: z.string(),
  job_request: z
    .object({
      name: z.string(),
      service_address: z.string(),
      job_description: z.string(),
      urgency: z.enum(["emergency", "soon", "flexible", "estimate_only"]),
      preferred_time: z.string(),
      notes: z.string(),
    })
    .nullable(),
});

async function smsReply({ business, history }) {
  const res = await anthropic().beta.messages.parse({
    model: settings.model,
    max_tokens: 4000,
    output_config: { effort: "low", format: betaZodOutputFormat(SmsReply) },
    system: [{ type: "text", text: buildSmsSystemPrompt(business), cache_control: { type: "ephemeral" } }],
    messages: history,
    ...fallbackParams(),
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) {
    return { reply: "Thanks for your message! Someone from our team will text you back shortly.", job_request: null };
  }
  return res.parsed_output;
}

// ---------- After-call summary ----------

export const CallSummary = z.object({
  caller_name: z.string(),
  callback_number: z.string(),
  service_address: z.string(),
  service_requested: z.string(),
  urgency: z.enum(["emergency", "soon", "flexible", "estimate_only", "none"]),
  outcome: z.enum([
    "job_booked", // caller agreed to a visit or appointment window
    "qualified_lead", // real customer, info captured, team needs to follow up
    "transferred", // handed to a person
    "message_taken", // existing customer, vendor, or personal message
    "info_only", // asked a question, no job yet
    "spam_or_sales",
    "hung_up_early",
  ]),
  appointment_window: z.string(),
  estimated_job_value_usd: z.number(),
  follow_up_needed: z.string(),
  summary: z.string(),
});

async function summarizeCall({ business, transcriptText }) {
  const res = await anthropic().beta.messages.parse({
    model: settings.model,
    max_tokens: 4000,
    output_config: { effort: "medium", format: betaZodOutputFormat(CallSummary) },
    system:
      "You review phone-call transcripts for a home-services answering service. Fill in every field from the transcript only; use empty strings for unknowns. " +
      "outcome rules: job_booked = the caller agreed to a visit, appointment, or time window; qualified_lead = a real potential customer whose need and contact info were captured but no time was agreed; " +
      "transferred = the call was handed to a staff member; message_taken = not a new job (existing customer, vendor, personal); info_only = question answered, no job; spam_or_sales = robocall, marketing, or solicitation; hung_up_early = caller left before saying what they needed. " +
      `estimated_job_value_usd: a rough typical price for this kind of ${business.industry} job in the US, 0 if no job. summary: two or three sentences for the business owner.`,
    messages: [{ role: "user", content: `Business: ${business.name} (${business.industry})\n\nTranscript:\n${transcriptText}` }],
    ...fallbackParams(),
  });
  if (!res.parsed_output) throw new Error(`Summary failed: stop_reason=${res.stop_reason}`);
  return res.parsed_output;
}

// Swappable for tests.
export const llm = { streamCallTurn, smsReply, summarizeCall };
export function setLlm(overrides) {
  Object.assign(llm, overrides);
}
