// 이벤트 모드: 입구 체크인 → 행사장 사람들이 가려진 카드로 보이는 발견 보드 → 리더보드.
import { Router } from "express";
import { sha256 } from "../crypto.js";
import { HttpError, forbidden, notFound, requireUser, str } from "../lib.js";

export function eventRoutes({ db, limit }) {
  const r = Router();

  const getEvent = (id) => {
    const e = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
    if (!e) throw notFound();
    return e;
  };
  const isAttendee = (eventId, userId) =>
    !!db.prepare("SELECT 1 FROM event_attendees WHERE event_id = ? AND user_id = ?").get(eventId, userId);

  // 입구의 운영진 키링/QR 코드로 체크인
  r.post("/api/events/checkin", requireUser, (req, res) => {
    limit(`checkin:${req.user.id}`, 20, 15 * 60_000);
    const code = str(req.body?.code, "code", { max: 64, min: 6 });
    const e = db.prepare("SELECT * FROM events WHERE checkin_hash = ?").get(sha256(code));
    if (!e) throw new HttpError(400, "invalid_code", "체크인 코드를 확인해 주세요");
    const now = Date.now();
    if (now > e.ends_at) throw new HttpError(410, "event_ended", "이미 끝난 행사예요");
    db.prepare(
      `INSERT INTO event_attendees (event_id, user_id, checked_in_at, show_leaderboard) VALUES (?, ?, ?, ?)
       ON CONFLICT (event_id, user_id) DO UPDATE SET show_leaderboard = excluded.show_leaderboard`,
    ).run(e.id, req.user.id, now, req.body?.showOnLeaderboard === true ? 1 : 0);
    res.json({ ok: true, eventId: e.id, name: e.name });
  });

  // 발견 보드. 못 만난 사람은 본인이 정한 힌트만 보인다. 힌트는 행사 시간에만 공개.
  r.get("/api/events/:id/board", requireUser, (req, res) => {
    const e = getEvent(req.params.id);
    if (!isAttendee(e.id, req.user.id)) throw forbidden("not_attendee", "체크인한 참가자만 볼 수 있어요");
    const now = Date.now();
    const live = now >= e.starts_at && now <= e.ends_at;
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.role, u.org, u.hint, a.checked_in_at,
                (SELECT 1 FROM encounters x WHERE x.scanner_id = ? AND x.owner_id = u.id) AS found
         FROM event_attendees a JOIN users u ON u.id = a.user_id
         WHERE a.event_id = ? AND u.id != ? AND u.deleted_at IS NULL
         ORDER BY a.checked_in_at`,
      )
      .all(req.user.id, e.id, req.user.id);
    const slots = rows.map((u, i) =>
      u.found
        ? { slot: i + 1, found: true, user: { id: u.id, name: u.name, role: u.role, org: u.org } }
        : { slot: i + 1, found: false, hint: live ? u.hint || null : null },
    );
    const found = slots.filter((s) => s.found).length;
    res.json({ event: { id: e.id, name: e.name, startsAt: e.starts_at, endsAt: e.ends_at, live }, found, total: slots.length, slots });
  });

  // 리더보드: 행사 중에 만난 사람 수. 체크인할 때 동의한 사람만 이름이 나온다.
  r.get("/api/events/:id/leaderboard", requireUser, (req, res) => {
    const e = getEvent(req.params.id);
    if (!isAttendee(e.id, req.user.id)) throw forbidden("not_attendee", "체크인한 참가자만 볼 수 있어요");
    const rows = db
      .prepare(
        `SELECT u.id, u.name, COUNT(x.owner_id) AS met
         FROM event_attendees a JOIN users u ON u.id = a.user_id
         LEFT JOIN encounters x ON x.scanner_id = u.id AND x.event_id = a.event_id
         WHERE a.event_id = ? AND a.show_leaderboard = 1 AND u.deleted_at IS NULL
         GROUP BY u.id ORDER BY met DESC, MIN(a.checked_in_at) LIMIT 20`,
      )
      .all(e.id);
    res.json({ leaders: rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, met: r.met })) });
  });

  return r;
}
