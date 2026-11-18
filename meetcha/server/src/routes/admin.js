// 운영진 전용: 키링 발급, 이벤트 생성, 행사 리포트(통계만).
// 관리자는 환경 변수 ADMIN_EMAILS 에 적힌 이메일로 로그인한 사람.
import crypto from "node:crypto";
import { Router } from "express";
import { randomId, randomToken, sha256 } from "../crypto.js";
import { tx } from "../db.js";
import { bad, forbidden, int, notFound, requireUser, str } from "../lib.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 제외
export function claimCode() {
  const b = crypto.randomBytes(10);
  const s = [...b].map((x) => ALPHABET[x % 32]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
export const PERMANENT = 8.64e15; // 영구 정지 표시값
const normalizeClaim = (c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const isAdmin = (cfg, user) => !!user && cfg.adminEmails.includes(user.email);
export const requireAdmin = (cfg) => [
  requireUser,
  (req, _res, next) => next(isAdmin(cfg, req.user) ? undefined : forbidden()),
];

export function adminRoutes({ db, cfg }) {
  const r = Router();
  r.use("/api/admin", ...requireAdmin(cfg));

  // 키링 발급. 응답의 코드는 이때 한 번만 보여 주고 서버에는 해시만 저장한다.
  //  static: { kind: "static", count, label }  → 칩에 쓸 URL + 포장 인쇄용 등록 코드
  //  sun:    { kind: "sun", uids: ["04DE..."], label } → 칩 UID별 등록 코드 (칩 키는 프로비저닝 도구가 기록)
  r.post("/api/admin/tags", (req, res) => {
    const kind = req.body?.kind;
    const label = str(req.body?.label, "label", { max: 60 });
    // eventId를 주면 행사용 키링: 등록 코드 없이 처음 태그한 사람이 등록 + 체크인
    const eventId = req.body?.eventId ?? null;
    if (eventId && !db.prepare("SELECT 1 FROM events WHERE id = ?").get(eventId)) throw bad("invalid_input", "없는 행사예요");
    const now = Date.now();
    const out = [];
    tx(db, () => {
      const ins = db.prepare(
        "INSERT INTO tags (id, kind, uid, code_hash, claim_hash, label, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      if (kind === "static") {
        const count = int(req.body?.count, "count", { min: 1, max: 500 });
        for (let i = 0; i < count; i++) {
          const id = randomId(), code = randomToken(16), claim = claimCode();
          ins.run(id, "static", null, sha256(code), sha256(normalizeClaim(claim)), label, eventId, now);
          out.push({ id, url: `${cfg.origin}/t/${code}`, claimCode: claim });
        }
      } else if (kind === "sun") {
        const uids = req.body?.uids;
        if (!Array.isArray(uids) || !uids.length || uids.length > 500) throw bad("invalid_input", "uids: 1~500개");
        for (const raw of uids) {
          const uid = String(raw).toUpperCase();
          if (!/^[0-9A-F]{14}$/.test(uid)) throw bad("invalid_input", `UID 형식이 올바르지 않아요: ${raw}`);
          const id = randomId(), claim = claimCode();
          ins.run(id, "sun", uid, null, sha256(normalizeClaim(claim)), label, eventId, now);
          out.push({ id, uid, claimCode: claim });
        }
      } else throw bad("invalid_input", "kind는 static 또는 sun");
    });
    if (req.body?.format === "csv") {
      // 칩에 쓸 URL과 포장에 인쇄할 등록 코드. 서버에는 해시만 있으므로 이 파일은 이때 한 번만 받을 수 있다.
      const cell = (v) => (/[",\r\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
      const lines = [["tag_id", "kind", "uid", "url", "claim_code", "event_id", "label"]].concat(
        out.map((t) => [t.id, kind, t.uid ?? "", t.url ?? "", t.claimCode, eventId ?? "", label]),
      );
      return res
        .status(201)
        .type("text/csv; charset=utf-8")
        .set("Content-Disposition", `attachment; filename="meetcha-tags-${Date.now()}.csv"`)
        .send("\ufeff" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n");
    }
    res.status(201).json({ tags: out });
  });

  r.get("/api/admin/events", (req, res) => {
    const now = Date.now();
    const status = ["upcoming", "live", "ended"].includes(req.query.status) ? req.query.status : null;
    const rows = db
      .prepare(
        `SELECT e.*,
           (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.id) AS checked_in,
           (SELECT COUNT(*) FROM event_invites i WHERE i.event_id = e.id) AS invited,
           (SELECT COUNT(*) FROM encounters x WHERE x.event_id = e.id) AS encounters,
           (SELECT COUNT(*) FROM tags t WHERE t.event_id = e.id) AS tags,
           (SELECT COUNT(*) FROM tags t WHERE t.event_id = e.id AND t.owner_id IS NOT NULL) AS tags_claimed
         FROM events e ORDER BY e.starts_at DESC LIMIT 500`,
      )
      .all();
    const list = rows
      .map((e) => ({
        id: e.id,
        name: e.name,
        client: e.client,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        status: now < e.starts_at ? "upcoming" : now <= e.ends_at ? "live" : "ended",
        invited: e.invited,
        checkedIn: e.checked_in,
        encounters: e.encounters,
        tags: { issued: e.tags, claimed: e.tags_claimed },
        recapSentAt: e.recap_sent_at,
      }))
      .filter((e) => !status || e.status === status);
    res.json({ events: list });
  });

  r.post("/api/admin/events", (req, res) => {
    const b = req.body ?? {};
    const startsAt = int(b.startsAt, "startsAt", { min: 0, max: 8.64e15 });
    const endsAt = int(b.endsAt, "endsAt", { min: startsAt + 1, max: 8.64e15 });
    const id = randomId(), code = randomToken(12);
    db.prepare("INSERT INTO events (id, name, client, starts_at, ends_at, checkin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id,
      str(b.name, "name", { max: 80, min: 1 }),
      str(b.client, "client", { max: 80 }),
      startsAt,
      endsAt,
      sha256(code),
      Date.now(),
    );
    res.status(201).json({ id, checkinCode: code });
  });

  // ---------- 신고 처리 ----------
  r.get("/api/admin/reports", (req, res) => {
    const status = ["open", "actioned", "dismissed"].includes(req.query.status) ? req.query.status : "open";
    const rows = db
      .prepare(
        `SELECT r.*, rp.name AS reporter_name, t.name AS target_name, t.suspended_until,
                (SELECT COUNT(*) FROM reports o WHERE o.target_id = r.target_id AND o.status = 'open') AS open_on_target
         FROM reports r JOIN users rp ON rp.id = r.reporter_id JOIN users t ON t.id = r.target_id
         WHERE r.status = ? ORDER BY open_on_target DESC, r.created_at LIMIT 200`,
      )
      .all(status);
    res.json({
      reports: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        detail: r.detail,
        status: r.status,
        note: r.note,
        createdAt: r.created_at,
        reporter: { id: r.reporter_id, name: r.reporter_name },
        target: { id: r.target_id, name: r.target_name, suspendedUntil: r.suspended_until, openReports: r.open_on_target },
      })),
    });
  });

  r.post("/api/admin/reports/:id/resolve", (req, res) => {
    const status = req.body?.status;
    if (!["actioned", "dismissed"].includes(status)) throw bad("invalid_input", "status는 actioned 또는 dismissed");
    const note = str(req.body?.note, "note", { max: 500 });
    const t = db.prepare("UPDATE reports SET status = ?, note = ?, resolved_at = ? WHERE id = ?").run(status, note, Date.now(), req.params.id);
    if (!t.changes) throw notFound();
    res.json({ ok: true });
  });

  // ---------- 이용 정지 ----------
  // days 를 빼면 영구 정지. 정지하면 로그인 상태도 바로 끊는다.
  r.post("/api/admin/users/:id/suspend", (req, res) => {
    const u = db.prepare("SELECT id, email FROM users WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
    if (!u) throw notFound();
    if (cfg.adminEmails.includes(u.email)) throw forbidden("admin_target", "운영진 계정은 정지할 수 없어요");
    const days = req.body?.days;
    const until = days === undefined || days === null ? PERMANENT : Date.now() + int(days, "days", { min: 1, max: 3650 }) * 86400_000;
    const reason = str(req.body?.reason, "reason", { max: 200, min: 1 });
    tx(db, () => {
      db.prepare("UPDATE users SET suspended_until = ?, suspend_reason = ? WHERE id = ?").run(until, reason, u.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
    });
    res.json({ ok: true, suspendedUntil: until, permanent: until === PERMANENT });
  });

  r.post("/api/admin/users/:id/unsuspend", (req, res) => {
    const t = db.prepare("UPDATE users SET suspended_until = NULL, suspend_reason = NULL WHERE id = ?").run(req.params.id);
    if (!t.changes) throw notFound();
    res.json({ ok: true });
  });

  // 고객사에 주는 리포트: 개인별 데이터 없이 통계만
  r.get("/api/admin/events/:id/report", (req, res) => {
    const e = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
    if (!e) throw notFound();
    const attendees = db.prepare("SELECT COUNT(*) AS n FROM event_attendees WHERE event_id = ?").get(e.id).n;
    const enc = db.prepare("SELECT COUNT(*) AS n, SUM(verified) AS v FROM encounters WHERE event_id = ?").get(e.id);
    const quiz = db
      .prepare(
        `SELECT COUNT(*) AS n, AVG(q.score) AS avg FROM quiz_attempts q
         JOIN encounters x ON x.scanner_id = q.scanner_id AND x.owner_id = q.owner_id
         WHERE x.event_id = ? AND q.finished_at IS NOT NULL`,
      )
      .get(e.id);
    const msgs = db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages m
         WHERE EXISTS (SELECT 1 FROM encounters x WHERE x.event_id = ? AND
           ((x.scanner_id = m.from_id AND x.owner_id = m.to_id) OR (x.scanner_id = m.to_id AND x.owner_id = m.from_id)))`,
      )
      .get(e.id).n;
    res.json({
      event: { id: e.id, name: e.name, client: e.client },
      attendees,
      encounters: enc.n,
      verifiedEncounters: enc.v ?? 0,
      avgPeopleMet: attendees ? Math.round((enc.n / attendees) * 10) / 10 : 0,
      quizzesFinished: quiz.n,
      avgQuizScore: quiz.avg ? Math.round(quiz.avg) : null,
      messagesBetweenAttendees: msgs,
    });
  });

  return r;
}
