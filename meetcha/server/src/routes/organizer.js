// 행사 운영 (운영진 전용): 참가자 명단, 행사 전 안내 메일, 테마, 체크인 데스크, 리캡 메일.
import { Router } from "express";
import { randomToken, sha256 } from "../crypto.js";
import { tx } from "../db.js";
import { EMAIL_RE, HttpError, bad, httpsUrl, notFound, str } from "../lib.js";
import { requireAdmin } from "./admin.js";

export const DESK_COOKIE = "mc_desk";
const INVITE_TTL = 7 * 86400_000;
const MAX_ROWS = 5000;

/** 간단한 CSV 파서 (따옴표, 쉼표, 줄바꿈 포함 필드 지원) */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// 주최사마다 열 이름이 달라서 흔한 이름을 맞춰 준다 (Luma, Eventbrite 내보내기 포함)
const COLUMNS = {
  email: ["email", "e-mail", "email address", "이메일"],
  name: ["name", "full name", "이름", "성명"],
  first: ["first name", "first_name"],
  last: ["last name", "last_name"],
  role: ["role", "title", "job title", "직함", "직책"],
  org: ["org", "company", "organization", "회사", "소속"],
};

export function rowsFromCsv(csv) {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/^﻿/, ""));
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  if (col.email < 0) throw bad("invalid_csv", "CSV 첫 줄에 email 열이 있어야 해요");
  const get = (r, k) => (col[k] >= 0 ? (r[col[k]] ?? "").trim() : "");
  return rows.slice(1).map((r) => ({
    email: get(r, "email"),
    name: get(r, "name") || [get(r, "first"), get(r, "last")].filter(Boolean).join(" "),
    role: get(r, "role"),
    org: get(r, "org"),
  }));
}

export function organizerRoutes({ db, cfg, mailer }) {
  const r = Router();
  r.use("/api/admin", ...requireAdmin(cfg));
  const getEvent = (id) => {
    const e = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
    if (!e) throw notFound();
    return e;
  };

  // 참가자 명단 가져오기: { csv: "email,name,...\n..." } 또는 { attendees: [{ email, name, role, org }] }
  r.post("/api/admin/events/:id/attendees/import", (req, res) => {
    const e = getEvent(req.params.id);
    const list = typeof req.body?.csv === "string" ? rowsFromCsv(req.body.csv) : req.body?.attendees;
    if (!Array.isArray(list) || !list.length) throw bad("invalid_input", "csv 또는 attendees가 필요해요");
    if (list.length > MAX_ROWS) throw bad("too_many", `한 번에 ${MAX_ROWS}명까지 올릴 수 있어요`);
    const invalid = [];
    let added = 0, updated = 0;
    tx(db, () => {
      const find = db.prepare("SELECT 1 FROM event_invites WHERE event_id = ? AND email = ?");
      const upsert = db.prepare(
        `INSERT INTO event_invites (event_id, email, name, role, org, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, (SELECT id FROM users WHERE email = ? AND deleted_at IS NULL), ?)
         ON CONFLICT (event_id, email) DO UPDATE SET name = excluded.name, role = excluded.role, org = excluded.org`,
      );
      list.forEach((a, i) => {
        const email = String(a?.email ?? "").trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return invalid.push({ row: i + 1, reason: "이메일 형식 오류" });
        const clip = (v, n) => String(v ?? "").trim().slice(0, n);
        const existed = find.get(e.id, email);
        upsert.run(e.id, email, clip(a.name, 40), clip(a.role, 60), clip(a.org, 60), email, Date.now());
        existed ? updated++ : added++;
      });
    });
    const total = db.prepare("SELECT COUNT(*) AS n FROM event_invites WHERE event_id = ?").get(e.id).n;
    res.json({ added, updated, invalid, total });
  });

  r.get("/api/admin/events/:id/attendees", (req, res) => {
    const e = getEvent(req.params.id);
    const rows = db
      .prepare(
        `SELECT i.email, i.name, i.role, i.org, i.sent_at, i.user_id,
                (SELECT checked_in_at FROM event_attendees a WHERE a.event_id = i.event_id AND a.user_id = i.user_id) AS checked_in_at
         FROM event_invites i WHERE i.event_id = ? ORDER BY i.created_at`,
      )
      .all(e.id);
    const walkIns = db
      .prepare(
        `SELECT COUNT(*) AS n FROM event_attendees a WHERE a.event_id = ?
         AND NOT EXISTS (SELECT 1 FROM event_invites i WHERE i.event_id = a.event_id AND i.user_id = a.user_id)`,
      )
      .get(e.id).n;
    res.json({
      invited: rows.length,
      joined: rows.filter((r) => r.user_id).length,
      checkedIn: rows.filter((r) => r.checked_in_at).length,
      walkIns,
      attendees: rows.map((r) => ({
        email: r.email, name: r.name, role: r.role, org: r.org,
        invitedEmailSentAt: r.sent_at, joined: !!r.user_id, checkedInAt: r.checked_in_at,
      })),
    });
  });

  // 행사 전 "내 카드 미리 만들기" 메일. 아직 안 보낸 사람에게만. 링크로 바로 로그인(가입)된다.
  r.post("/api/admin/events/:id/invites/send", async (req, res, next) => {
    try {
      const e = getEvent(req.params.id);
      if (Date.now() > e.ends_at) throw new HttpError(410, "event_ended", "이미 끝난 행사예요");
      const rows = db.prepare("SELECT email, name FROM event_invites WHERE event_id = ? AND sent_at IS NULL").all(e.id);
      let sent = 0;
      for (const row of rows) {
        const token = randomToken();
        db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)").run(sha256(token), row.email, Date.now() + INVITE_TTL);
        const link = `${cfg.origin}/auth/verify?token=${token}`;
        await mailer.send({
          to: row.email,
          subject: `${e.name}: 내 Meetcha 카드를 미리 만들어 두세요`,
          text: `${row.name ? row.name + "님, " : ""}${e.name}에서 받을 키링에 연결될 카드를 미리 만들어 두면 행사장에서 바로 쓸 수 있어요.\n\n${link}\n\n링크는 7일 동안 한 번 쓸 수 있어요.`,
          link,
        });
        db.prepare("UPDATE event_invites SET sent_at = ? WHERE event_id = ? AND email = ?").run(Date.now(), e.id, row.email);
        sent++;
      }
      res.json({ sent });
    } catch (err) {
      next(err);
    }
  });

  r.put("/api/admin/events/:id/theme", (req, res) => {
    const e = getEvent(req.params.id);
    const b = req.body ?? {};
    const color = str(b.color, "color", { max: 7 });
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) throw bad("invalid_input", "color는 #RRGGBB 형식이에요");
    const logo = b.logoUrl ? httpsUrl(b.logoUrl, "logoUrl") : "";
    db.prepare("UPDATE events SET logo_url = ?, color = ?, welcome = ? WHERE id = ?").run(logo, color, str(b.welcome, "welcome", { max: 200 }), e.id);
    res.json({ ok: true });
  });

  // 입구 체크인 코드 다시 만들기. 서버엔 해시만 있어서 코드를 다시 보여 줄 수 없으므로, 콘솔에서 QR을 띄울 때 새로 만든다.
  // 새 코드를 만들면 이전 코드(인쇄해 둔 QR 포함)는 더 이상 쓸 수 없다.
  r.post("/api/admin/events/:id/checkin-code", (req, res) => {
    const e = getEvent(req.params.id);
    const code = randomToken(12);
    db.prepare("UPDATE events SET checkin_hash = ? WHERE id = ?").run(sha256(code), e.id);
    res.status(201).json({ checkinCode: code, url: `${cfg.origin}/board?code=${encodeURIComponent(code)}` });
  });

  // 체크인 데스크 모드: 이 기기(운영진 휴대폰)로 참가자 키링을 태그하면 도감 대신 체크인이 된다
  r.post("/api/admin/events/:id/desk", (req, res) => {
    const e = getEvent(req.params.id);
    if (req.body?.on === false) {
      res.clearCookie(DESK_COOKIE, { path: "/" });
      return res.json({ desk: false });
    }
    res.cookie(DESK_COOKIE, e.id, { httpOnly: true, sameSite: "lax", secure: cfg.secureCookies, path: "/", maxAge: 24 * 3600_000 });
    res.json({ desk: true, eventId: e.id });
  });

  // 행사 리캡 메일. 행사가 끝난 뒤 한 번만.
  r.post("/api/admin/events/:id/recap/send", async (req, res, next) => {
    try {
      const e = getEvent(req.params.id);
      if (Date.now() < e.ends_at) throw new HttpError(409, "event_not_ended", "행사가 끝난 뒤에 보낼 수 있어요");
      if (e.recap_sent_at) throw new HttpError(409, "already_sent", "이미 보냈어요");
      db.prepare("UPDATE events SET recap_sent_at = ? WHERE id = ?").run(Date.now(), e.id);
      const rows = db
        .prepare(
          `SELECT u.email, u.name, (SELECT COUNT(*) FROM encounters x WHERE x.scanner_id = u.id AND x.event_id = a.event_id) AS met
           FROM event_attendees a JOIN users u ON u.id = a.user_id
           WHERE a.event_id = ? AND u.deleted_at IS NULL AND u.email IS NOT NULL`,
        )
        .all(e.id);
      const link = `${cfg.origin}/events/${e.id}/recap`;
      for (const u of rows)
        await mailer.send({
          to: u.email,
          subject: `${e.name}에서 ${u.met}명을 만났어요`,
          text: `${u.name || ""}님, ${e.name}에서 만난 사람들을 다시 떠올려 보세요. 퀴즈로 누가 어떤 사람이었는지 확인할 수 있어요.\n\n${link}`,
          link,
        });
      res.json({ sent: rows.length });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
