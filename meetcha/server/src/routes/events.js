// 이벤트 모드: 입구 체크인 → 행사장 사람들이 가려진 카드로 보이는 발견 보드 → 리더보드.
import { Router } from "express";
import { sha256 } from "../crypto.js";
import { HttpError, forbidden, notFound, requireUser, str } from "../lib.js";
import { MAX_STREAMS_PER_USER, eventStats, leaderboard, openStream } from "../realtime.js";
import { checkIn, eventTheme } from "../checkin.js";
import { photoUrl, recapImage } from "../media.js";
import { viewProfile } from "./social.js";

export function eventRoutes({ db, limit, bus }) {
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
    checkIn(db, bus, e, req.user.id, { showLeaderboard: req.body?.showOnLeaderboard === true, now });
    res.json({ ok: true, eventId: e.id, name: e.name, theme: eventTheme(e) });
  });

  // 리더보드 동의 바꾸기 (체크인 뒤에도)
  r.put("/api/events/:id/leaderboard-consent", requireUser, (req, res) => {
    const e = getEvent(req.params.id);
    if (!isAttendee(e.id, req.user.id)) throw forbidden("not_attendee", "체크인한 참가자만 바꿀 수 있어요");
    if (typeof req.body?.show !== "boolean") throw new HttpError(400, "invalid_input", "show는 true/false");
    checkIn(db, bus, e, req.user.id, { showLeaderboard: req.body.show });
    res.json({ ok: true, show: req.body.show });
  });

  // 발견 보드. 못 만난 사람은 본인이 정한 힌트만 보인다. 힌트는 행사 시간에만 공개.
  r.get("/api/events/:id/board", requireUser, (req, res) => {
    const e = getEvent(req.params.id);
    if (!isAttendee(e.id, req.user.id)) throw forbidden("not_attendee", "체크인한 참가자만 볼 수 있어요");
    const now = Date.now();
    const live = now >= e.starts_at && now <= e.ends_at;
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.role, u.org, u.hint, u.photo, a.checked_in_at,
                (SELECT 1 FROM encounters x WHERE x.scanner_id = ? AND x.owner_id = u.id) AS found
         FROM event_attendees a JOIN users u ON u.id = a.user_id
         WHERE a.event_id = ? AND u.id != ? AND u.deleted_at IS NULL AND (u.suspended_until IS NULL OR u.suspended_until <= ?)
         ORDER BY a.checked_in_at`,
      )
      .all(req.user.id, e.id, req.user.id, Date.now());
    const slots = rows.map((u, i) =>
      u.found
        ? { slot: i + 1, found: true, user: { id: u.id, name: u.name, role: u.role, org: u.org, photoUrl: photoUrl(u.photo) } }
        : { slot: i + 1, found: false, hint: live ? u.hint || null : null },
    );
    const found = slots.filter((s) => s.found).length;
    res.json({ event: { id: e.id, name: e.name, startsAt: e.starts_at, endsAt: e.ends_at, live, theme: eventTheme(e) }, found, total: slots.length, slots });
  });

  // 리캡 공유 이미지 (PNG 1080×1350). 내 기록만, 만난 사람의 이름·얼굴은 넣지 않는다.
  r.get("/api/events/:id/recap/image", requireUser, async (req, res, next) => {
    try {
      const e = getEvent(req.params.id);
      if (!isAttendee(e.id, req.user.id)) throw forbidden("not_attendee", "체크인한 참가자만 볼 수 있어요");
      limit(`recap-img:${req.user.id}`, 30, 3600_000);
      const metCount = db.prepare("SELECT COUNT(*) AS n FROM encounters WHERE scanner_id = ? AND event_id = ?").get(req.user.id, e.id).n;
      const metMeCount = db.prepare("SELECT COUNT(*) AS n FROM encounters WHERE owner_id = ? AND event_id = ?").get(req.user.id, e.id).n;
      const png = await recapImage({ eventName: e.name, color: e.color, metCount, metMeCount, lang: req.query.lang === "en" ? "en" : "ko" });
      res.type("png").set("Cache-Control", "private, no-store").send(png);
    } catch (err) {
      next(err);
    }
  });

  // 행사 리캡: 이 행사에서 만난 사람, 나를 만난 사람 수, 아직 안 푼 퀴즈. 행사 중에도 볼 수 있고 끝나면 final.
  r.get("/api/events/:id/recap", requireUser, (req, res) => {
    const e = getEvent(req.params.id);
    if (!isAttendee(e.id, req.user.id)) throw forbidden("not_attendee", "체크인한 참가자만 볼 수 있어요");
    const met = db
      .prepare("SELECT owner_id, first_at, best_score, verified FROM encounters WHERE scanner_id = ? AND event_id = ? ORDER BY first_at")
      .all(req.user.id, e.id);
    const people = met.map((x) => ({
      ...viewProfile(db, req.user.id, x.owner_id),
      metAt: x.first_at,
      bestScore: x.best_score,
      verified: !!x.verified,
    }));
    const metMe = db.prepare("SELECT COUNT(*) AS n FROM encounters WHERE owner_id = ? AND event_id = ?").get(req.user.id, e.id).n;
    const rank = leaderboard(db, e.id).find((l) => l.id === req.user.id)?.rank ?? null;
    const stats = eventStats(db, e.id);
    res.json({
      event: { id: e.id, name: e.name, startsAt: e.starts_at, endsAt: e.ends_at, theme: eventTheme(e) },
      final: Date.now() > e.ends_at,
      metCount: people.length,
      metMeCount: metMe,
      leaderboardRank: rank,
      quizzesToPlay: people.filter((p) => !p.limited && p.quizCount > 0 && p.bestScore == null).length,
      people,
      eventTotals: { attendees: stats.checkedIn, encounters: stats.encounters },
    });
  });

  // 리더보드: 행사 중에 만난 사람 수. 체크인할 때 동의한 사람만 이름이 나온다.
  r.get("/api/events/:id/leaderboard", requireUser, (req, res) => {
    const e = getEvent(req.params.id);
    if (!isAttendee(e.id, req.user.id)) throw forbidden("not_attendee", "체크인한 참가자만 볼 수 있어요");
    res.json({ leaders: leaderboard(db, e.id) });
  });

  // 실시간 피드 (SSE). 브라우저에서는 new EventSource("/api/events/<id>/stream") 로 연결한다.
  //  checkin     : 새 참가자 (인원수만)          → 참가자 전원
  //  found       : 내가 새로 발견한 사람의 명함   → 태그한 본인
  //  tagged      : 나를 태그한 사람 이름          → 태그당한 사람
  //  activity    : 누군가 새 사람을 만남 (리더보드 동의자만 이름) → 전원
  //  stats       : 체크인 수, 만남 수             → 전원
  //  leaderboard : 리더보드 (동의자만)            → 전원
  r.get("/api/events/:id/stream", requireUser, (req, res) => {
    const e = getEvent(req.params.id);
    if (!isAttendee(e.id, req.user.id)) throw forbidden("not_attendee", "체크인한 참가자만 볼 수 있어요");
    if (Date.now() > e.ends_at) throw new HttpError(410, "event_ended", "이미 끝난 행사예요");
    if (bus.count(e.id, req.user.id) >= MAX_STREAMS_PER_USER)
      throw new HttpError(429, "too_many_streams", "열린 창이 너무 많아요. 다른 창을 닫아 주세요");
    let unsubscribe = () => {};
    const send = openStream(req, res, { onClose: () => unsubscribe() });
    unsubscribe = bus.subscribe(e.id, req.user.id, send);
    send("ready", { eventId: e.id, theme: eventTheme(e), ...eventStats(db, e.id), leaders: leaderboard(db, e.id) });
  });

  return r;
}
