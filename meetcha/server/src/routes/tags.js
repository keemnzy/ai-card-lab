// NFC 태그 처리와 태그 후 보이는 프로필 페이지.
//   NTAG 424 DNA : https://도메인/t?e=<암호화 PICC>&c=<CMAC>   (칩이 태그마다 값을 새로 만든다)
//   NTAG215 등   : https://도메인/t/<고정 코드>
import { Router } from "express";
import { deriveTagKey, randomToken, sha256, verifySun } from "../crypto.js";
import { CLAIM_COOKIE, HttpError, PENDING_COOKIE, cookieOptions, isSuspended, requireUser } from "../lib.js";
import { esc, loginBox, page } from "../pages.js";
import { tx } from "../db.js";
import { checkIn } from "../checkin.js";
import { isAdmin } from "./admin.js";
import { DESK_COOKIE } from "./organizer.js";
import { viewProfile } from "./social.js";

const PENDING_TTL = 30 * 60_000;
const CLAIM_TTL = 30 * 60_000;

function notice(res, status, title, text) {
  res.status(status).type("html").send(page(title, `<div class="card"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></div>`));
}

export function tagRoutes({ db, cfg, limit, meet, bus }) {
  const r = Router();

  function onScan(req, res, tag, { verified, fresh }) {
    if (tag.status !== "active") return notice(res, 410, "사용이 중지된 키링이에요", "주인이 분실 신고를 했거나 탈퇴한 키링입니다.");

    // 체크인 데스크 모드: 운영진 휴대폰으로 참가자 키링을 태그하면 체크인
    const deskEvent = isAdmin(cfg, req.user) && req.cookies[DESK_COOKIE]
      ? db.prepare("SELECT * FROM events WHERE id = ?").get(req.cookies[DESK_COOKIE]) : null;
    if (deskEvent) return deskCheckin(res, deskEvent, tag, fresh);

    if (!tag.owner_id) {
      // 행사용 키링: 처음 태그한 사람이 자기 것으로 등록 (로그인 후 확인 버튼)
      if (tag.event_id && fresh) {
        const t = randomToken();
        db.prepare("INSERT INTO pending_claims (token_hash, tag_id, expires_at) VALUES (?, ?, ?)").run(sha256(t), tag.id, Date.now() + CLAIM_TTL);
        res.cookie(CLAIM_COOKIE, t, cookieOptions(cfg, CLAIM_TTL));
        return res.redirect(302, "/claim");
      }
      return notice(res, 200, "아직 주인이 없는 키링이에요", "키링 주인이라면 로그인 후 '내 명함'에서 포장에 인쇄된 등록 코드를 입력하세요.");
    }
    const owner = tag.owner_id;
    const ownerRow = db.prepare("SELECT suspended_until FROM users WHERE id = ?").get(owner);
    if (isSuspended(ownerRow)) return notice(res, 403, "지금은 열 수 없는 키링이에요", "이 키링의 명함은 현재 볼 수 없어요.");
    // 복사된 링크(카운터 재사용)는 도감에 넣지 않고 프로필만 보여 준다
    if (fresh) {
      if (req.user) {
        const r = meet(req.user.id, owner, verified);
        if (r?.isNew) return res.redirect(302, `/u/${owner}?new=1`);
      } else {
        const t = randomToken();
        db.prepare("INSERT INTO pending_scans (token_hash, owner_id, verified, expires_at) VALUES (?, ?, ?, ?)").run(
          sha256(t),
          owner,
          verified ? 1 : 0,
          Date.now() + PENDING_TTL,
        );
        res.cookie(PENDING_COOKIE, t, cookieOptions(cfg, PENDING_TTL));
      }
    }
    res.redirect(302, `/u/${owner}`);
  }

  function deskCheckin(res, ev, tag, fresh) {
    if (!fresh) return notice(res, 400, "다시 태그해 주세요", "복사된 링크로는 체크인할 수 없어요.");
    if (!tag.owner_id) return notice(res, 200, "아직 등록 전인 키링이에요", "참가자가 자기 휴대폰으로 키링을 태그하면 등록과 체크인이 한 번에 돼요.");
    const u = db.prepare("SELECT name, suspended_until FROM users WHERE id = ?").get(tag.owner_id);
    if (isSuspended(u)) return notice(res, 403, "체크인할 수 없어요", "이용이 제한된 계정이에요.");
    if (Date.now() > ev.ends_at) return notice(res, 410, "끝난 행사예요", ev.name);
    const r = checkIn(db, bus, ev, tag.owner_id);
    return notice(res, 200, r.isNew ? `${u.name || "참가자"}님 체크인 완료` : `${u.name || "참가자"}님은 이미 체크인했어요`, ev.name);
  }

  const pendingClaim = (req) => {
    const t = req.cookies[CLAIM_COOKIE];
    if (!t) return null;
    return db
      .prepare(
        `SELECT p.token_hash, t.id AS tag_id, t.owner_id, t.status, e.id AS event_id, e.name AS event_name, e.ends_at
         FROM pending_claims p JOIN tags t ON t.id = p.tag_id LEFT JOIN events e ON e.id = t.event_id
         WHERE p.token_hash = ? AND p.expires_at > ?`,
      )
      .get(sha256(t), Date.now());
  };

  // 행사용 키링 등록 화면(웹)이 쓰는 정보. 방금 태그한 키링이 있을 때만.
  r.get("/api/claim", (req, res) => {
    const c = pendingClaim(req);
    if (!c || c.status !== "active" || (c.owner_id && c.owner_id !== req.user?.id))
      throw new HttpError(410, "claim_expired", "키링을 다시 태그해 주세요. 이미 다른 사람이 등록했을 수도 있어요");
    res.json({ eventId: c.event_id, eventName: c.event_name, checkinAvailable: !!c.event_id && Date.now() <= c.ends_at });
  });

  // 행사용 키링 등록 확인 페이지
  r.get("/claim", (req, res) => {
    const c = pendingClaim(req);
    if (!c || c.owner_id || c.status !== "active")
      return notice(res, 410, "등록할 키링이 없어요", "키링을 다시 태그해 주세요. 이미 다른 사람이 등록했을 수도 있어요.");
    const n = res.locals.nonce;
    const action = req.user
      ? `<button id="claim">내 키링으로 등록${Date.now() <= c.ends_at ? "하고 체크인" : ""}</button><p id="msg" class="muted"></p>
         <script nonce="${n}">
           document.getElementById("claim").onclick = async () => {
             const r = await fetch("/api/me/tags/claim-tap", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
             const j = await r.json();
             if (r.ok) location.href = "/u/${esc(req.user.id)}";
             else document.getElementById("msg").textContent = j.message;
           };
         </script>`
      : loginBox(n, "로그인하면 이 키링이 내 명함과 연결돼요");
    res.type("html").send(
      page("키링 등록", `<div class="card"><h1>${esc(c.event_name || "Meetcha")} 키링</h1>
        <p class="muted">이 키링을 내 명함과 연결하면, 다른 사람이 태그할 때 내 명함이 열려요.</p></div>${req.user ? `<div class="card">${action}</div>` : action}`),
    );
  });

  r.post("/api/me/tags/claim-tap", requireUser, (req, res) => {
    const c = pendingClaim(req);
    if (!c || c.status !== "active") throw new HttpError(410, "claim_expired", "키링을 다시 태그해 주세요");
    if (c.owner_id && c.owner_id !== req.user.id) throw new HttpError(409, "already_claimed", "이미 다른 사람이 등록한 키링이에요");
    const now = Date.now();
    tx(db, () => {
      const t = db.prepare("UPDATE tags SET owner_id = ? WHERE id = ? AND owner_id IS NULL").run(req.user.id, c.tag_id);
      if (!t.changes && c.owner_id !== req.user.id) throw new HttpError(409, "already_claimed", "이미 다른 사람이 등록한 키링이에요");
      db.prepare("DELETE FROM pending_claims WHERE token_hash = ?").run(c.token_hash);
    });
    res.clearCookie(CLAIM_COOKIE, { path: "/" });
    let checkedIn = false;
    if (c.event_id && now <= c.ends_at) {
      checkIn(db, bus, db.prepare("SELECT * FROM events WHERE id = ?").get(c.event_id), req.user.id, { now });
      checkedIn = true;
    }
    res.json({ ok: true, tagId: c.tag_id, eventId: c.event_id, checkedIn });
  });

  r.get("/t", (req, res) => {
    limit(`scan:${req.ip}`, 60, 60_000);
    if (!cfg.sunMetaKey || !cfg.sunMasterKey) return notice(res, 503, "준비 중이에요", "이 서버에는 NFC 칩 키가 설정되지 않았어요.");
    const v = verifySun(String(req.query.e || ""), String(req.query.c || ""), {
      metaKey: cfg.sunMetaKey,
      fileKeyFor: (uid) => deriveTagKey(cfg.sunMasterKey, uid),
    });
    if (!v) return notice(res, 400, "확인할 수 없는 태그예요", "키링을 다시 태그해 주세요. 계속 안 되면 정품 키링이 아닐 수 있어요.");
    const tag = db.prepare("SELECT * FROM tags WHERE kind = 'sun' AND uid = ?").get(v.uid);
    if (!tag) return notice(res, 404, "등록되지 않은 키링이에요", "Meetcha에 등록된 키링이 아니에요.");
    const fresh = v.counter > tag.last_ctr;
    if (fresh) db.prepare("UPDATE tags SET last_ctr = ? WHERE id = ? AND last_ctr < ?").run(v.counter, tag.id, v.counter);
    onScan(req, res, tag, { verified: true, fresh });
  });

  r.get("/t/:code", (req, res) => {
    limit(`scan:${req.ip}`, 60, 60_000);
    const tag = db.prepare("SELECT * FROM tags WHERE kind = 'static' AND code_hash = ?").get(sha256(req.params.code));
    if (!tag) return notice(res, 404, "등록되지 않은 키링이에요", "Meetcha에 등록된 키링이 아니에요.");
    onScan(req, res, tag, { verified: false, fresh: true });
  });

  // 태그 후 착지 페이지 (정식 프론트엔드 전까지 쓰는 간단한 서버 렌더링)
  r.get("/u/:id", (req, res) => {
    const p = viewProfile(db, req.user?.id, req.params.id);
    if (!p) return notice(res, 404, "찾을 수 없는 사람이에요", "링크를 다시 확인해 주세요.");
    const n = res.locals.nonce;
    const banner = req.query.new ? `<p class="muted"><b>새로운 사람을 발견했어요!</b> 도감에 저장됐어요.</p>` : "";
    const details = p.limited
      ? `<p class="muted">${p.deleted ? "탈퇴한 사용자예요." : "이 사람은 만난 사람에게만 명함을 보여 줘요."}</p>`
      : `<div class="muted">${esc(p.role)}${p.org ? " · " + esc(p.org) : ""}</div>
         ${p.oneLiner ? `<p>${esc(p.oneLiner)}</p>` : ""}
         <div>${p.links.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join("")}</div>
         ${p.quizCount && req.user && req.user.id !== p.id ? `<p class="muted">${esc(p.name)}님의 퀴즈 ${p.quizCount}문제가 도감에 저장됐어요.</p>` : ""}`;
    const login = req.user ? "" : loginBox(n, "로그인하면 이 사람이 내 도감에 저장돼요");
    res.type("html").send(page(p.name, `${banner}<div class="card"><h1>${esc(p.name)}</h1>${details}</div>${login}`));
  });

  return r;
}
