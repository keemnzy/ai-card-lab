// 다른 사람 프로필 보기, 도감, 메모, 메시지, 차단.
import { Router } from "express";
import { randomId } from "../crypto.js";
import { HttpError, forbidden, isSuspended, notFound, requireUser, str } from "../lib.js";
import { hasScanned, haveMet } from "../encounters.js";
import { loadLinks } from "./me.js";

/**
 * 공개 범위에 따라 보여 줄 프로필을 만든다.
 *  public      : 누구나 전체
 *  encountered : 만난 사람(어느 방향이든)만 전체, 그 외엔 이름만
 *  private     : 본인 외엔 이름만
 * 퀴즈 정답은 절대 포함하지 않는다.
 */
export function viewProfile(db, viewerId, ownerId) {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(ownerId);
  if (!u) return null;
  const isSelf = viewerId === ownerId;
  const met = viewerId && !isSelf && haveMet(db, viewerId, ownerId);
  // 정지된 계정은 다른 사람에게 이름만 보인다 (정지 사실은 알리지 않음)
  const full = !u.deleted_at && (isSelf || !isSuspended(u)) && (isSelf || u.visibility === "public" || (u.visibility === "encountered" && met));
  const quizCount = db.prepare("SELECT COUNT(*) AS n FROM quiz_questions WHERE user_id = ?").get(ownerId).n;
  const base = { id: u.id, name: u.name || "이름 없음", deleted: !!u.deleted_at, limited: !full };
  if (!full) return base;
  return { ...base, role: u.role, org: u.org, oneLiner: u.one_liner, links: loadLinks(db, ownerId), quizCount };
}

export function socialRoutes({ db, limit }) {
  const r = Router();

  r.get("/api/users/:id", (req, res) => {
    const p = viewProfile(db, req.user?.id, req.params.id);
    if (!p) throw notFound();
    if (req.user && req.user.id !== p.id) {
      const enc = db.prepare("SELECT first_at, best_score, verified FROM encounters WHERE scanner_id = ? AND owner_id = ?").get(req.user.id, p.id);
      const note = db.prepare("SELECT body FROM notes WHERE author_id = ? AND about_id = ?").get(req.user.id, p.id);
      p.encounter = enc ? { firstAt: enc.first_at, bestScore: enc.best_score, verified: !!enc.verified } : null;
      p.note = note?.body ?? "";
    }
    res.json(p);
  });

  // 내 도감: 내가 태그한 사람들, 최근 순
  r.get("/api/dex", requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT e.owner_id, e.first_at, e.last_at, e.best_score, e.verified, e.event_id
         FROM encounters e WHERE e.scanner_id = ? ORDER BY e.last_at DESC`,
      )
      .all(req.user.id);
    res.json({
      count: rows.length,
      people: rows.map((e) => ({
        ...viewProfile(db, req.user.id, e.owner_id),
        firstAt: e.first_at,
        lastAt: e.last_at,
        bestScore: e.best_score,
        verified: !!e.verified,
        eventId: e.event_id,
      })),
    });
  });

  // 나만 보는 메모 (도감에 있는 사람만)
  r.put("/api/users/:id/note", requireUser, (req, res) => {
    if (!hasScanned(db, req.user.id, req.params.id)) throw forbidden("not_met", "도감에 있는 사람에게만 메모할 수 있어요");
    const body = str(req.body?.body, "body", { max: 1000 });
    if (!body) db.prepare("DELETE FROM notes WHERE author_id = ? AND about_id = ?").run(req.user.id, req.params.id);
    else
      db.prepare(
        `INSERT INTO notes (author_id, about_id, body, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (author_id, about_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      ).run(req.user.id, req.params.id, body, Date.now());
    res.json({ ok: true });
  });

  // 메시지: 만난 사이에만. 차단당했으면 조용히 버린다(차단 여부를 알려 주지 않음).
  r.post("/api/users/:id/messages", requireUser, (req, res) => {
    const to = req.params.id;
    if (to === req.user.id) throw forbidden("self", "나에게는 보낼 수 없어요");
    if (!haveMet(db, req.user.id, to)) throw forbidden("not_met", "만난 사람에게만 메시지를 보낼 수 있어요");
    limit(`msg:${req.user.id}`, 30, 3600_000);
    const body = str(req.body?.body, "body", { max: 500, min: 1 });
    const blocked = db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(to, req.user.id);
    const recipient = db.prepare("SELECT deleted_at, suspended_until FROM users WHERE id = ?").get(to);
    if (!blocked && recipient && !recipient.deleted_at && !isSuspended(recipient))
      db.prepare("INSERT INTO messages (id, from_id, to_id, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
        randomId(),
        req.user.id,
        to,
        body,
        Date.now(),
      );
    res.status(201).json({ ok: true });
  });

  r.get("/api/me/messages", requireUser, (req, res) => {
    const rows = db
      .prepare(
        `SELECT m.id, m.body, m.created_at, m.read_at, u.id AS from_id, u.name AS from_name
         FROM messages m JOIN users u ON u.id = m.from_id
         WHERE m.to_id = ? ORDER BY m.created_at DESC LIMIT 200`,
      )
      .all(req.user.id);
    db.prepare("UPDATE messages SET read_at = ? WHERE to_id = ? AND read_at IS NULL").run(Date.now(), req.user.id);
    res.json({
      messages: rows.map((m) => ({ id: m.id, body: m.body, createdAt: m.created_at, read: !!m.read_at, from: { id: m.from_id, name: m.from_name } })),
    });
  });

  // 신고: 만난 사람이거나 전체 공개 명함인 사람만. 같은 사람에 대한 처리 전 신고는 하나로 합친다.
  const REASONS = ["harassment", "spam", "impersonation", "inappropriate", "other"];
  r.post("/api/users/:id/report", requireUser, (req, res) => {
    const target = db.prepare("SELECT id, visibility FROM users WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
    if (!target) throw notFound();
    if (target.id === req.user.id) throw forbidden("self", "나를 신고할 수 없어요");
    if (target.visibility !== "public" && !haveMet(db, req.user.id, target.id))
      throw forbidden("not_met", "만난 사람이나 전체 공개 명함만 신고할 수 있어요");
    if (!REASONS.includes(req.body?.reason)) throw new HttpError(400, "invalid_input", `reason은 ${REASONS.join(", ")} 중 하나예요`);
    limit(`report:${req.user.id}`, 10, 86400_000);
    const detail = str(req.body?.detail, "detail", { max: 1000 });
    const open = db.prepare("SELECT id FROM reports WHERE reporter_id = ? AND target_id = ? AND status = 'open'").get(req.user.id, target.id);
    if (open) db.prepare("UPDATE reports SET reason = ?, detail = ? WHERE id = ?").run(req.body.reason, detail, open.id);
    else
      db.prepare("INSERT INTO reports (id, reporter_id, target_id, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        randomId(),
        req.user.id,
        target.id,
        req.body.reason,
        detail,
        Date.now(),
      );
    res.status(201).json({ ok: true });
  });

  r.post("/api/users/:id/block", requireUser, (req, res) => {
    if (req.params.id === req.user.id) throw forbidden("self", "나를 차단할 수 없어요");
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(req.params.id)) throw notFound();
    db.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)").run(req.user.id, req.params.id);
    db.prepare("DELETE FROM messages WHERE from_id = ? AND to_id = ?").run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  return r;
}
