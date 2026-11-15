// Password-protected dashboard: every call, its transcript, and what each client owes you.
import express from "express";
import crypto from "node:crypto";
import { settings, loadBusinesses, findBusinessById } from "./config.js";
import * as db from "./db.js";
import { feeForCall, transcriptToText } from "./postcall.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function requireAdmin(req, res, next) {
  if (!settings.adminPassword) return res.status(503).send("Set ADMIN_PASSWORD to turn on the dashboard.");
  const [scheme, encoded] = (req.header("authorization") || "").split(" ");
  const pass = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
  const a = Buffer.from(pass);
  const b = Buffer.from(settings.adminPassword);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.set("WWW-Authenticate", 'Basic realm="Receptionist"').status(401).send("Login required");
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e3e2dc;--accent:#1f6f50;--warn:#a4441b}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a3a29b;--card:#1f1f1d;--line:#33332f;--accent:#5fc49a;--warn:#f08a5d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px}a{color:var(--accent)}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:24px 0 8px}
.muted{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.card b{display:block;font-size:22px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;text-transform:uppercase;color:var(--muted)}
.wrap{overflow-x:auto}.tag{display:inline-block;padding:1px 8px;border-radius:99px;border:1px solid var(--line);font-size:12px}
.tag.bill{border-color:var(--accent);color:var(--accent)}pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
form.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:end}input,select,button{font:inherit;padding:6px 8px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
button{background:var(--accent);color:#fff;border:0;cursor:pointer}
</style></head><body><main>${body}</main></body></html>`;
}

function monthStats(business, month) {
  const calls = db.listCalls({ businessId: business.id, month, limit: 100000 });
  const count = (o) => calls.filter((c) => c.outcome === o).length;
  const usage = calls.reduce((sum, c) => sum + feeForCall(business, c.outcome, !!c.transferred_to), 0);
  const fees = Number(business.billing?.monthly_fee || 0) + usage;
  const sold = calls.filter((c) => c.confirmed_sale === 1);
  return {
    calls,
    total: calls.length,
    booked: count("job_booked"),
    leads: count("qualified_lead"),
    transferred: count("transferred"),
    spam: count("spam_or_sales"),
    pipeline: calls.filter((c) => c.billable).reduce((s, c) => s + (c.est_value || 0), 0),
    soldCount: sold.length,
    soldAmount: sold.reduce((s, c) => s + (c.sale_amount || 0), 0),
    usage,
    fees,
  };
}

export function adminRoutes() {
  const r = express.Router();
  r.use(requireAdmin);
  r.use(express.urlencoded({ extended: false }));

  r.get("/", (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : new Date().toISOString().slice(0, 7);
    const businesses = loadBusinesses();
    const selected = req.query.biz ? findBusinessById(req.query.biz) : null;
    const list = selected ? [selected] : businesses;
    let html = `<h1>Receptionist dashboard</h1><p class="muted">Every answered call, its transcript, and what each client owes for ${esc(month)}.</p>
<form class="inline" method="get"><label>Month<br><input type="month" name="month" value="${esc(month)}"></label>
<label>Client<br><select name="biz"><option value="">All clients</option>${businesses
      .map((b) => `<option value="${esc(b.id)}" ${selected?.id === b.id ? "selected" : ""}>${esc(b.name)}</option>`)
      .join("")}</select></label><button>Show</button></form>`;
    if (!businesses.length) html += `<p>No businesses configured yet. Add one to <code>config/businesses.json</code>.</p>`;
    for (const b of list) {
      const s = monthStats(b, month);
      html += `<h2>${esc(b.name)} <span class="muted">${esc(b.twilio_number)}</span></h2>
<div class="cards"><div class="card"><b>${s.total}</b>calls answered</div><div class="card"><b>${s.booked}</b>jobs booked</div>
<div class="card"><b>${s.leads}</b>qualified leads</div><div class="card"><b>${s.transferred}</b>transferred</div>
<div class="card"><b>${money(s.pipeline)}</b>estimated job value</div><div class="card"><b>${s.soldCount} / ${money(s.soldAmount)}</b>confirmed sales</div>
<div class="card"><b>${money(s.fees)}</b>you bill this month <a href="invoice.csv?biz=${esc(b.id)}&month=${esc(month)}">CSV</a></div></div>
<div class="wrap"><table><tr><th>When</th><th>Caller</th><th>Outcome</th><th>Summary</th><th>Fee</th></tr>${s.calls
        .map((c) => {
          const sum = c.summary ? JSON.parse(c.summary) : {};
          const fee = feeForCall(b, c.outcome, !!c.transferred_to);
          return `<tr><td><a href="call/${c.id}">${esc(new Date(c.started_at).toLocaleString("en-US", { timeZone: b.timezone }))}</a></td>
<td>${esc(sum.caller_name || "")}<br><span class="muted">${esc(c.from_number)}</span></td>
<td><span class="tag ${c.billable ? "bill" : ""}">${esc((c.outcome || "in progress").replace(/_/g, " "))}</span>${c.confirmed_sale === 1 ? ' <span class="tag bill">sold</span>' : ""}</td>
<td>${esc(sum.summary || "")}</td><td>${fee ? money(fee) : ""}</td></tr>`;
        })
        .join("")}</table></div>`;
    }
    html += `<p><a href="leads">All captured leads</a></p>`;
    res.send(page("Receptionist dashboard", html));
  });

  r.get("/call/:id", (req, res) => {
    const c = db.getCallById(Number(req.params.id));
    if (!c) return res.status(404).send("Not found");
    const b = findBusinessById(c.business_id);
    const sum = c.summary ? JSON.parse(c.summary) : {};
    const transcript = c.transcript ? transcriptToText(JSON.parse(c.transcript)) : "(call in progress or no transcript)";
    const html = `<p><a href="../">← Dashboard</a></p><h1>Call from ${esc(c.from_number)}</h1>
<p class="muted">${esc(b?.name || c.business_id)} · ${esc(c.started_at)} · ${c.duration_sec ?? "?"} seconds${c.transferred_to ? ` · transferred to ${esc(c.transferred_to)}` : ""}</p>
<div class="cards"><div class="card"><b>${esc((c.outcome || "").replace(/_/g, " "))}</b>outcome</div>
<div class="card"><b>${money(c.est_value)}</b>estimated value</div><div class="card"><b>${money(b ? feeForCall(b, c.outcome, !!c.transferred_to) : 0)}</b>your fee</div></div>
<h2>Summary</h2><pre>${esc(JSON.stringify(sum, null, 2))}</pre>
${c.voicemail_url ? `<p><a href="${esc(c.voicemail_url)}.mp3">Voicemail recording</a></p>` : ""}
<h2>Did this turn into a sale?</h2>
<form class="inline" method="post"><label>Sold<br><select name="confirmed_sale"><option value="">Unknown</option>
<option value="1" ${c.confirmed_sale === 1 ? "selected" : ""}>Yes</option><option value="0" ${c.confirmed_sale === 0 ? "selected" : ""}>No</option></select></label>
<label>Sale amount ($)<br><input name="sale_amount" type="number" step="1" value="${esc(c.sale_amount ?? "")}"></label>
<label>Notes<br><input name="admin_notes" value="${esc(c.admin_notes ?? "")}"></label><button>Save</button></form>
<h2>Transcript</h2><pre>${esc(transcript)}</pre>`;
    res.send(page(`Call ${c.id}`, html));
  });

  r.post("/call/:id", (req, res) => {
    const c = db.getCallById(Number(req.params.id));
    if (!c) return res.status(404).send("Not found");
    db.updateCall(c.call_sid, {
      confirmed_sale: req.body.confirmed_sale === "" ? null : Number(req.body.confirmed_sale),
      sale_amount: req.body.sale_amount === "" ? null : Number(req.body.sale_amount),
      admin_notes: req.body.admin_notes || null,
    });
    res.redirect(`../call/${c.id}`);
  });

  r.get("/leads", (req, res) => {
    const leads = db.listLeads({ limit: 500 });
    const html = `<p><a href="./">← Dashboard</a></p><h1>Captured leads</h1><div class="wrap"><table>
<tr><th>When</th><th>Client</th><th>Name / phone</th><th>Job</th><th>Address</th><th>Urgency</th><th>Source</th></tr>${leads
      .map(
        (l) => `<tr><td>${esc(l.created_at.slice(0, 16).replace("T", " "))}</td><td>${esc(l.business_id)}</td><td>${esc(l.name)}<br><span class="muted">${esc(l.phone)}</span></td>
<td>${esc(l.service)}<br><span class="muted">${esc(l.preferred_time)} ${esc(l.notes)}</span></td><td>${esc(l.address)}</td><td>${esc(l.urgency)}</td><td>${esc(l.source)}</td></tr>`
      )
      .join("")}</table></div>`;
    res.send(page("Leads", html));
  });

  r.get("/invoice.csv", (req, res) => {
    const b = findBusinessById(req.query.biz);
    const month = String(req.query.month || "");
    if (!b || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).send("biz and month=YYYY-MM required");
    const s = monthStats(b, month);
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["date", "caller", "outcome", "service", "fee_usd", "confirmed_sale", "sale_amount"].join(",")];
    for (const c of s.calls) {
      const fee = feeForCall(b, c.outcome, !!c.transferred_to);
      if (!fee) continue;
      const sum = c.summary ? JSON.parse(c.summary) : {};
      rows.push([q(c.started_at), q(c.from_number), q(c.outcome), q(sum.service_requested), fee, q(c.confirmed_sale ?? ""), q(c.sale_amount ?? "")].join(","));
    }
    rows.push(["", "", "", q("Monthly fee"), Number(b.billing?.monthly_fee || 0), "", ""].join(","));
    rows.push(["", "", "", q("TOTAL"), s.fees, "", ""].join(","));
    res.type("text/csv").attachment(`${b.id}-${month}.csv`).send(rows.join("\n"));
  });

  return r;
}
