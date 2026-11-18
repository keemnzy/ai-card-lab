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
const normalizeClaim = (c) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function adminRoutes({ db, cfg }) {
  const r = Router();
  r.use("/api/admin", requireUser, (req, _res, next) => {
    if (!cfg.adminEmails.includes(req.user.email)) return next(forbidden());
    next();
  });

  // 키링 발급. 응답의 코드는 이때 한 번만 보여 주고 서버에는 해시만 저장한다.
  //  static: { kind: "static", count, label }  → 칩에 쓸 URL + 포장 인쇄용 등록 코드
  //  sun:    { kind: "sun", uids: ["04DE..."], label } → 칩 UID별 등록 코드 (칩 키는 프로비저닝 도구가 기록)
  r.post("/api/admin/tags", (req, res) => {
    const kind = req.body?.kind;
    const label = str(req.body?.label, "label", { max: 60 });
    const now = Date.now();
    const out = [];
    tx(db, () => {
      const ins = db.prepare(
        "INSERT INTO tags (id, kind, uid, code_hash, claim_hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      if (kind === "static") {
        const count = int(req.body?.count, "count", { min: 1, max: 500 });
        for (let i = 0; i < count; i++) {
          const id = randomId(), code = randomToken(16), claim = claimCode();
          ins.run(id, "static", null, sha256(code), sha256(normalizeClaim(claim)), label, now);
          out.push({ id, url: `${cfg.origin}/t/${code}`, claimCode: claim });
        }
      } else if (kind === "sun") {
        const uids = req.body?.uids;
        if (!Array.isArray(uids) || !uids.length || uids.length > 500) throw bad("invalid_input", "uids: 1~500개");
        for (const raw of uids) {
          const uid = String(raw).toUpperCase();
          if (!/^[0-9A-F]{14}$/.test(uid)) throw bad("invalid_input", `UID 형식이 올바르지 않아요: ${raw}`);
          const id = randomId(), claim = claimCode();
          ins.run(id, "sun", uid, null, sha256(normalizeClaim(claim)), label, now);
          out.push({ id, uid, claimCode: claim });
        }
      } else throw bad("invalid_input", "kind는 static 또는 sun");
    });
    res.status(201).json({ tags: out });
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
