// 내 명함: 프로필, 링크, 퀴즈, 키링 등록, 탈퇴.
import express, { Router } from "express";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, photoUrl, processPhoto } from "../media.js";
import { eventTheme } from "../checkin.js";
import { sha256 } from "../crypto.js";
import { tx } from "../db.js";
import { HttpError, SESSION_COOKIE, TERMS_VERSION, bad, httpsUrl, int, notFound, requireUser, str } from "../lib.js";

export const MAX_LINKS = 8;
export const MAX_QUESTIONS = 5;

export function loadQuiz(db, userId) {
  return db
    .prepare("SELECT question, options, answer FROM quiz_questions WHERE user_id = ? ORDER BY pos")
    .all(userId)
    .map((q) => ({ question: q.question, options: JSON.parse(q.options), answer: q.answer }));
}
export const loadLinks = (db, userId) =>
  db.prepare("SELECT label, url FROM links WHERE user_id = ? ORDER BY pos").all(userId).map((l) => ({ ...l }));

export function meRoutes({ db, limit, storage, cfg }) {
  const r = Router();
  r.use("/api/me", requireUser);

  // 프로필 사진: 요청 본문에 이미지 그대로 (Content-Type: image/jpeg 등). PUT이라 다른 사이트에서 보낼 수 없다.
  r.put("/api/me/photo", express.raw({ type: PHOTO_TYPES, limit: PHOTO_MAX_BYTES }), async (req, res, next) => {
    try {
      limit(`photo:${req.user.id}`, 20, 3600_000);
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(415, "image_required", "JPEG, PNG, WebP, HEIC 사진을 올려 주세요 (5MB 이하)");
      const out = await processPhoto(req.body);
      if (!out) throw bad("invalid_image", "사진을 읽을 수 없어요. 다른 사진으로 시도해 주세요");
      await storage.put(out.name, out.buf);
      const old = db.prepare("SELECT photo FROM users WHERE id = ?").get(req.user.id).photo;
      db.prepare("UPDATE users SET photo = ? WHERE id = ?").run(out.name, req.user.id);
      if (old) await storage.del(old);
      res.json({ ok: true, photoUrl: photoUrl(out.name) });
    } catch (err) {
      next(err);
    }
  });

  r.delete("/api/me/photo", async (req, res, next) => {
    try {
      const old = db.prepare("SELECT photo FROM users WHERE id = ?").get(req.user.id).photo;
      db.prepare("UPDATE users SET photo = NULL WHERE id = ?").run(req.user.id);
      if (old) await storage.del(old);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // 내가 체크인한 행사들 (만난 사람이 없어도 포함). 리캡 목록에 쓴다.
  r.get("/api/me/events", (req, res) => {
    const now = Date.now();
    const rows = db
      .prepare(
        `SELECT e.*, a.checked_in_at,
           (SELECT COUNT(*) FROM encounters x WHERE x.scanner_id = a.user_id AND x.event_id = e.id) AS met,
           (SELECT COUNT(*) FROM encounters x WHERE x.owner_id = a.user_id AND x.event_id = e.id) AS met_me
         FROM event_attendees a JOIN events e ON e.id = a.event_id
         WHERE a.user_id = ? ORDER BY e.starts_at DESC`,
      )
      .all(req.user.id);
    res.json({
      events: rows.map((e) => ({
        id: e.id,
        name: e.name,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        status: now < e.starts_at ? "upcoming" : now <= e.ends_at ? "live" : "ended",
        theme: eventTheme(e),
        checkedInAt: e.checked_in_at,
        metCount: e.met,
        metMeCount: e.met_me,
      })),
    });
  });

  r.get("/api/me", (req, res) => {
    const u = req.user;
    res.json({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      org: u.org,
      oneLiner: u.one_liner,
      hint: u.hint,
      photoUrl: photoUrl(u.photo),
      visibility: u.visibility,
      isAdmin: !!cfg?.adminEmails.includes(u.email), // 운영진 콘솔 메뉴 표시용 (권한 검사는 서버가 API마다 따로 함)
      // 약관이 바뀌었으면 화면에서 다시 동의를 받아 POST /api/me/consent 로 보낸다
      consentRequired: u.terms_version !== TERMS_VERSION,
      termsVersion: TERMS_VERSION,
      links: loadLinks(db, u.id),
      quiz: loadQuiz(db, u.id), // 본인에게만 정답 포함
      tags: db
        .prepare("SELECT id, kind, status, label, created_at AS createdAt FROM tags WHERE owner_id = ?")
        .all(u.id)
        .map((t) => ({ ...t })),
    });
  });

  r.put("/api/me/profile", (req, res) => {
    const b = req.body ?? {};
    const visibility = b.visibility ?? req.user.visibility;
    if (!["public", "encountered", "private"].includes(visibility)) throw bad("invalid_input", "visibility 값이 올바르지 않아요");
    db.prepare("UPDATE users SET name = ?, role = ?, org = ?, one_liner = ?, hint = ?, visibility = ? WHERE id = ?").run(
      str(b.name, "name", { max: 40, min: 1 }),
      str(b.role, "role", { max: 60 }),
      str(b.org, "org", { max: 60 }),
      str(b.oneLiner, "oneLiner", { max: 200 }),
      str(b.hint, "hint", { max: 30 }),
      visibility,
      req.user.id,
    );
    res.json({ ok: true });
  });

  r.put("/api/me/links", (req, res) => {
    const list = req.body?.links;
    if (!Array.isArray(list) || list.length > MAX_LINKS) throw bad("invalid_input", `링크는 최대 ${MAX_LINKS}개예요`);
    const clean = list.map((l, i) => ({ label: str(l?.label, `links[${i}].label`, { max: 30, min: 1 }), url: httpsUrl(l?.url, `links[${i}].url`) }));
    tx(db, () => {
      db.prepare("DELETE FROM links WHERE user_id = ?").run(req.user.id);
      const ins = db.prepare("INSERT INTO links (user_id, pos, label, url) VALUES (?, ?, ?, ?)");
      clean.forEach((l, i) => ins.run(req.user.id, i, l.label, l.url));
    });
    res.json({ ok: true, links: clean });
  });

  r.put("/api/me/quiz", (req, res) => {
    const list = req.body?.quiz;
    if (!Array.isArray(list) || list.length > MAX_QUESTIONS) throw bad("invalid_input", `퀴즈는 최대 ${MAX_QUESTIONS}문제예요`);
    const clean = list.map((q, i) => {
      if (!Array.isArray(q?.options) || q.options.length !== 4) throw bad("invalid_input", `quiz[${i}]: 보기는 4개여야 해요`);
      return {
        question: str(q.question, `quiz[${i}].question`, { max: 120, min: 1 }),
        options: q.options.map((o, k) => str(o, `quiz[${i}].options[${k}]`, { max: 40, min: 1 })),
        answer: int(q.answer, `quiz[${i}].answer`, { min: 0, max: 3 }),
      };
    });
    tx(db, () => {
      db.prepare("DELETE FROM quiz_questions WHERE user_id = ?").run(req.user.id);
      const ins = db.prepare("INSERT INTO quiz_questions (user_id, pos, question, options, answer) VALUES (?, ?, ?, ?, ?)");
      clean.forEach((q, i) => ins.run(req.user.id, i, q.question, JSON.stringify(q.options), q.answer));
    });
    res.json({ ok: true, quiz: clean });
  });

  r.post("/api/me/consent", (req, res) => {
    const c = req.body ?? {};
    if (!(c.age === true && c.terms === true && c.privacy === true))
      throw bad("consent_required", "만 14세 이상 확인과 이용약관·개인정보 수집 동의가 모두 필요해요");
    db.prepare("UPDATE users SET terms_version = ?, consented_at = ? WHERE id = ?").run(TERMS_VERSION, Date.now(), req.user.id);
    res.json({ ok: true, termsVersion: TERMS_VERSION });
  });

  // 포장에 인쇄된 등록 코드로 내 키링 연결
  r.post("/api/me/tags/claim", (req, res) => {
    limit(`claim:${req.user.id}`, 10, 15 * 60_000);
    const code = str(req.body?.claimCode, "claimCode", { max: 64, min: 6 }).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const tag = db.prepare("SELECT * FROM tags WHERE claim_hash = ?").get(sha256(code));
    if (!tag) throw new HttpError(400, "invalid_claim", "등록 코드를 확인해 주세요");
    if (tag.owner_id && tag.owner_id !== req.user.id) throw new HttpError(409, "already_claimed", "이미 다른 사람이 등록한 키링이에요");
    db.prepare("UPDATE tags SET owner_id = ?, status = 'active' WHERE id = ?").run(req.user.id, tag.id);
    res.json({ ok: true, tagId: tag.id });
  });

  // 분실 신고: 즉시 비활성화. 이후 이 키링을 태그해도 프로필이 열리지 않는다.
  r.post("/api/me/tags/:id/lost", (req, res) => {
    const t = db.prepare("UPDATE tags SET status = 'lost' WHERE id = ? AND owner_id = ?").run(req.params.id, req.user.id);
    if (!t.changes) throw notFound();
    res.json({ ok: true });
  });

  // 탈퇴: 개인정보를 지우고, 다른 사람 도감에는 "탈퇴한 사용자"로 남는다.
  r.delete("/api/me", (req, res) => {
    const id = req.user.id;
    if (req.user.photo) storage.del(req.user.photo).catch((e) => console.error("사진 삭제 실패", e));
    tx(db, () => {
      for (const sql of [
        "DELETE FROM links WHERE user_id = ?",
        "DELETE FROM quiz_questions WHERE user_id = ?",
        "DELETE FROM notes WHERE author_id = ? OR about_id = ?",
        "DELETE FROM messages WHERE from_id = ? OR to_id = ?",
        "DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?",
        "DELETE FROM quiz_attempts WHERE scanner_id = ? OR owner_id = ?",
        "DELETE FROM event_attendees WHERE user_id = ?",
        "DELETE FROM sessions WHERE user_id = ?",
        "DELETE FROM pending_scans WHERE owner_id = ?",
        "DELETE FROM encounters WHERE scanner_id = ?", // 내 도감은 삭제
        "UPDATE tags SET owner_id = NULL, status = 'lost' WHERE owner_id = ?",
      ]) {
        const n = (sql.match(/\?/g) || []).length;
        db.prepare(sql).run(...Array(n).fill(id));
      }
      db.prepare(
        "UPDATE users SET email = NULL, name = '탈퇴한 사용자', role = '', org = '', one_liner = '', hint = '', photo = NULL, visibility = 'private', deleted_at = ? WHERE id = ?",
      ).run(Date.now(), id);
    });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  return r;
}
