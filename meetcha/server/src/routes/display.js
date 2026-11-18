// 행사장 대형 화면(빔프로젝터·TV)용 공개 피드. 로그인 없이 링크만으로 연다.
// 참가자 피드보다 더 적게 보여 준다: 체크인 수, 만남 수, 리더보드(동의자만), 익명 활동 소식.
// 개인에게 가는 알림(found, tagged)은 절대 나가지 않는다.
import { Router } from "express";
import { randomToken, sha256 } from "../crypto.js";
import { HttpError, notFound } from "../lib.js";
import { eventTheme } from "../checkin.js";
import { eventStats, leaderboard, openStream } from "../realtime.js";
import { requireAdmin } from "./admin.js";

const GRACE_MS = 24 * 3600_000; // 행사 끝나고 하루까지
const MAX_DISPLAY_STREAMS = 10;

export function displayRoutes({ db, cfg, bus, limit }) {
  const r = Router();

  // 운영진: 대형 화면 링크 만들기. 다시 만들면 이전 링크는 바로 막힌다.
  r.post("/api/admin/events/:id/display", ...requireAdmin(cfg), (req, res) => {
    const e = db.prepare("SELECT id FROM events WHERE id = ?").get(req.params.id);
    if (!e) throw notFound();
    const token = randomToken(18);
    db.prepare("UPDATE events SET display_hash = ? WHERE id = ?").run(sha256(token), e.id);
    res.status(201).json({ token, url: `${cfg.origin}/display/${token}`, api: `/api/display/${token}` });
  });

  const byToken = (req) => {
    limit(`display:${req.ip}`, 120, 60_000);
    const e = db.prepare("SELECT * FROM events WHERE display_hash = ?").get(sha256(String(req.params.token)));
    if (!e) throw notFound();
    if (Date.now() > e.ends_at + GRACE_MS) throw new HttpError(410, "event_ended", "끝난 행사예요");
    return e;
  };
  const snapshot = (e) => ({
    event: { id: e.id, name: e.name, startsAt: e.starts_at, endsAt: e.ends_at, theme: eventTheme(e) },
    ...eventStats(db, e.id),
    leaders: leaderboard(db, e.id),
  });

  r.get("/api/display/:token", (req, res) => res.json(snapshot(byToken(req))));

  // 실시간: stats, leaderboard, activity(동의자만 이름), checkin(인원수)
  r.get("/api/display/:token/stream", (req, res) => {
    const e = byToken(req);
    if (bus.count(e.id, null) >= MAX_DISPLAY_STREAMS) throw new HttpError(429, "too_many_streams", "열린 화면이 너무 많아요");
    let unsubscribe = () => {};
    const send = openStream(req, res, { onClose: () => unsubscribe() });
    // userId = null 이라 개인 대상 알림(to: 특정 사용자)은 받지 않는다
    unsubscribe = bus.subscribe(e.id, null, send);
    send("ready", snapshot(e));
  });

  return r;
}
