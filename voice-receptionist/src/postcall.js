// After a call ends: summarize the transcript, decide if it's billable, alert the owner,
// and text back callers who hung up before saying anything.
import * as db from "./db.js";
import { llm } from "./llm.js";
import { messenger } from "./twilio.js";

export const BILLABLE_OUTCOMES = new Set(["job_booked", "qualified_lead"]);

export function transcriptToText(transcript) {
  const label = { caller: "Caller", agent: "Receptionist", system: "Note" };
  return transcript.map((t) => `${label[t.role] || t.role}: ${t.text}`).join("\n");
}

/** Fee owed to you for one call under this business's billing plan. */
export function feeForCall(business, outcome, transferred) {
  const plan = business.billing || {};
  if (outcome === "job_booked") return Number(plan.per_booked_job || 0);
  if (outcome === "qualified_lead" || (outcome === "transferred" && transferred)) return Number(plan.per_qualified_lead || 0);
  return 0;
}

export async function finalizeCall({ business, callSid, from, transcript }) {
  const row = db.getCall(callSid);
  const endedAt = new Date();
  const duration = row?.started_at ? Math.round((endedAt - new Date(row.started_at)) / 1000) : null;
  const callerSpoke = transcript.some((t) => t.role === "caller");
  const text = transcriptToText(transcript);

  let summary;
  if (!callerSpoke) {
    summary = {
      caller_name: "",
      callback_number: from,
      service_address: "",
      service_requested: "",
      urgency: "none",
      outcome: "hung_up_early",
      appointment_window: "",
      estimated_job_value_usd: 0,
      follow_up_needed: "Call back: they hung up during the greeting.",
      summary: "Caller hung up before saying anything.",
    };
  } else {
    try {
      summary = await llm.summarizeCall({ business, transcriptText: text });
    } catch (err) {
      console.error(`[${callSid}] summary failed:`, err.message);
      summary = { outcome: "qualified_lead", summary: "Automatic summary failed; read the transcript.", estimated_job_value_usd: 0, callback_number: from };
    }
  }

  const billable = BILLABLE_OUTCOMES.has(summary.outcome) ? 1 : 0;
  db.updateCall(callSid, {
    ended_at: endedAt.toISOString(),
    duration_sec: duration,
    transcript: JSON.stringify(transcript),
    summary: JSON.stringify(summary),
    outcome: summary.outcome,
    billable,
    est_value: summary.estimated_job_value_usd || 0,
  });

  // Owner alert with the summary (skip spam to avoid noise).
  if (summary.outcome !== "spam_or_sales") {
    const lines = [
      `📞 ${business.name}: ${summary.outcome.replace(/_/g, " ")}`,
      [summary.caller_name, summary.callback_number || from].filter(Boolean).join(" "),
      summary.service_requested,
      summary.service_address,
      summary.appointment_window ? `When: ${summary.appointment_window}` : "",
      summary.summary,
      summary.follow_up_needed ? `Next: ${summary.follow_up_needed}` : "",
    ].filter(Boolean);
    await Promise.all(business.alert_numbers.map((n) => messenger.sendSms(business.twilio_number, n, lines.join("\n"))));
  }

  // Missed-call text-back: keeps the lead alive when someone hangs up on the greeting.
  if (summary.outcome === "hung_up_early" && business.missed_call_textback && from && duration !== null && duration < 60) {
    const msg = `Hi, this is ${business.name}. Sorry we missed you! Reply here with what you need and we'll get you taken care of.`;
    await messenger.sendSms(business.twilio_number, from, msg);
    db.logSms(business.id, from, "out", msg);
  }
  return summary;
}
