// 이벤트 실시간 피드 (Server-Sent Events).
// 한 서버 안에서만 동작하는 메모리 구독. 서버를 여러 대로 늘리면 publish를 Redis pub/sub 등으로 바꾼다.
import { recordEncounter } from "./encounters.js";

export const MAX_STREAMS_PER_USER = 3;
const HEARTBEAT_MS = 25_000;

export function createBus() {
  /** eventId → Set<{ userId, send }> */
  const subs = new Map();

  return {
    subscribe(eventId, userId, send) {
      if (!subs.has(eventId)) subs.set(eventId, new Set());
      const sub = { userId, send };
      subs.get(eventId).add(sub);
      return () => {
        const set = subs.get(eventId);
        set?.delete(sub);
        if (set && !set.size) subs.delete(eventId);
      };
    },
    count(eventId, userId) {
      let n = 0;
      for (const s of subs.get(eventId) ?? []) if (s.userId === userId) n++;
      return n;
    },
    /** to: 특정 사용자 ID, 없으면 그 이벤트 구독자 전원 */
    publish(eventId, type, data, { to, except } = {}) {
      for (const s of subs.get(eventId) ?? []) {
        if (to && s.userId !== to) continue;
        if (except && s.userId === except) continue;
        s.send(type, data);
      }
    },
  };
}

/** 리더보드: 체크인할 때 동의한 사람만, 행사 중 만난 사람 수 순 */
export function leaderboard(db, eventId, now = Date.now()) {
  return db
    .prepare(
      `SELECT u.id, u.name, COUNT(x.owner_id) AS met
       FROM event_attendees a JOIN users u ON u.id = a.user_id
       LEFT JOIN encounters x ON x.scanner_id = u.id AND x.event_id = a.event_id
       WHERE a.event_id = ? AND a.show_leaderboard = 1 AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until <= ?)
       GROUP BY u.id ORDER BY met DESC, MIN(a.checked_in_at) LIMIT 20`,
    )
    .all(eventId, now)
    .map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, met: r.met }));
}

export function eventStats(db, eventId) {
  return {
    checkedIn: db.prepare("SELECT COUNT(*) AS n FROM event_attendees WHERE event_id = ?").get(eventId).n,
    encounters: db.prepare("SELECT COUNT(*) AS n FROM encounters WHERE event_id = ?").get(eventId).n,
  };
}

/**
 * 만남을 기록하고, 행사 중 새 만남이면 실시간으로 알린다.
 * 태그 처리(routes/tags.js)와 로그인 후 대기 태그 처리(routes/auth.js)가 이 함수를 쓴다.
 */
export function createMeet(db, bus) {
  return function meet(scannerId, ownerId, verified, now = Date.now()) {
    const r = recordEncounter(db, scannerId, ownerId, verified, now);
    if (!r?.isNew || !r.eventId) return r;
    const ev = r.eventId;
    const user = (id) => db.prepare("SELECT id, name, role, org, photo FROM users WHERE id = ?").get(id);
    const { photo, ...owner } = user(ownerId);
    owner.photoUrl = photo ? `/media/${photo}` : null;
    const scanner = user(scannerId);
    bus.publish(ev, "found", { user: { ...owner } }, { to: scannerId });
    bus.publish(ev, "tagged", { by: { id: scanner.id, name: scanner.name } }, { to: ownerId });

    const optedIn = db.prepare("SELECT show_leaderboard FROM event_attendees WHERE event_id = ? AND user_id = ?").get(ev, scannerId)?.show_leaderboard;
    const met = db.prepare("SELECT COUNT(*) AS n FROM encounters WHERE scanner_id = ? AND event_id = ?").get(scannerId, ev).n;
    bus.publish(ev, "activity", optedIn ? { who: { id: scanner.id, name: scanner.name }, met, at: now } : { who: null, met: null, at: now });
    bus.publish(ev, "stats", eventStats(db, ev));
    if (optedIn) bus.publish(ev, "leaderboard", { leaders: leaderboard(db, ev, now) });
    return r;
  };
}

/** Express 응답을 SSE 스트림으로 바꾼다 */
export function openStream(req, res, { onClose }) {
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // nginx 버퍼링 끄기
  });
  res.flushHeaders();
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(beat);
    onClose();
  });
  return send;
}
