// Stores calls, transcripts, leads, and text messages in a local SQLite file.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { settings } from "./config.js";

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(settings.dataDir, { recursive: true });
  db = new DatabaseSync(path.join(settings.dataDir, "receptionist.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_sid TEXT UNIQUE,
      business_id TEXT,
      from_number TEXT,
      to_number TEXT,
      started_at TEXT,
      ended_at TEXT,
      duration_sec INTEGER,
      transcript TEXT,
      summary TEXT,
      outcome TEXT,
      billable INTEGER DEFAULT 0,
      est_value REAL,
      transferred_to TEXT,
      voicemail_url TEXT,
      confirmed_sale INTEGER,
      sale_amount REAL,
      admin_notes TEXT
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id TEXT,
      source TEXT,
      call_sid TEXT,
      phone TEXT,
      name TEXT,
      address TEXT,
      service TEXT,
      urgency TEXT,
      preferred_time TEXT,
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id TEXT,
      phone TEXT,
      direction TEXT,
      body TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS calls_biz ON calls(business_id, started_at);
    CREATE INDEX IF NOT EXISTS sms_thread ON sms(business_id, phone, created_at);
  `);
  return db;
}

const now = () => new Date().toISOString();

export function startCall({ callSid, businessId, from, to }) {
  getDb()
    .prepare(
      `INSERT INTO calls (call_sid, business_id, from_number, to_number, started_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(call_sid) DO NOTHING`
    )
    .run(callSid, businessId, from, to, now());
}

export function updateCall(callSid, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE calls SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE call_sid = ?`;
  getDb().prepare(sql).run(...keys.map((k) => fields[k]), callSid);
}

export function getCall(callSid) {
  return getDb().prepare("SELECT * FROM calls WHERE call_sid = ?").get(callSid);
}

export function getCallById(id) {
  return getDb().prepare("SELECT * FROM calls WHERE id = ?").get(id);
}

export function listCalls({ businessId, month, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (businessId) {
    where.push("business_id = ?");
    args.push(businessId);
  }
  if (month) {
    where.push("substr(started_at, 1, 7) = ?");
    args.push(month);
  }
  const sql = `SELECT * FROM calls ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY started_at DESC LIMIT ?`;
  return getDb().prepare(sql).all(...args, limit);
}

export function saveLead(lead) {
  getDb()
    .prepare(
      `INSERT INTO leads (business_id, source, call_sid, phone, name, address, service, urgency, preferred_time, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      lead.business_id,
      lead.source,
      lead.call_sid || null,
      lead.phone || "",
      lead.name || "",
      lead.address || "",
      lead.service || "",
      lead.urgency || "",
      lead.preferred_time || "",
      lead.notes || "",
      now()
    );
}

export function listLeads({ businessId, limit = 200 } = {}) {
  const sql = `SELECT * FROM leads ${businessId ? "WHERE business_id = ?" : ""} ORDER BY created_at DESC LIMIT ?`;
  return businessId ? getDb().prepare(sql).all(businessId, limit) : getDb().prepare(sql).all(limit);
}

export function logSms(businessId, phone, direction, body) {
  getDb()
    .prepare("INSERT INTO sms (business_id, phone, direction, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(businessId, phone, direction, body, now());
}

/** Text thread with one customer over the last few days, oldest first. */
export function smsThread(businessId, phone, sinceHours = 72) {
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  return getDb()
    .prepare(
      `SELECT direction, body, created_at FROM sms
       WHERE business_id = ? AND phone = ? AND created_at >= ? ORDER BY id ASC`
    )
    .all(businessId, phone, since);
}
