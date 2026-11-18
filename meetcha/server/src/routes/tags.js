// NFC 태그 처리와 태그 후 보이는 프로필 페이지.
//   NTAG 424 DNA : https://도메인/t?e=<암호화 PICC>&c=<CMAC>   (칩이 태그마다 값을 새로 만든다)
//   NTAG215 등   : https://도메인/t/<고정 코드>
import { Router } from "express";
import { deriveTagKey, randomToken, sha256, verifySun } from "../crypto.js";
import { PENDING_COOKIE, cookieOptions, isSuspended } from "../lib.js";
import { recordEncounter } from "../encounters.js";
import { esc, page } from "../pages.js";
import { viewProfile } from "./social.js";

const PENDING_TTL = 30 * 60_000;

function notice(res, status, title, text) {
  res.status(status).type("html").send(page(title, `<div class="card"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></div>`));
}

export function tagRoutes({ db, cfg, limit }) {
  const r = Router();

  function onScan(req, res, tag, { verified, fresh }) {
    if (tag.status !== "active") return notice(res, 410, "사용이 중지된 키링이에요", "주인이 분실 신고를 했거나 탈퇴한 키링입니다.");
    if (!tag.owner_id)
      return notice(res, 200, "아직 주인이 없는 키링이에요", "키링 주인이라면 로그인 후 '내 명함'에서 포장에 인쇄된 등록 코드를 입력하세요.");
    const owner = tag.owner_id;
    const ownerRow = db.prepare("SELECT suspended_until FROM users WHERE id = ?").get(owner);
    if (isSuspended(ownerRow)) return notice(res, 403, "지금은 열 수 없는 키링이에요", "이 키링의 명함은 현재 볼 수 없어요.");
    // 복사된 링크(카운터 재사용)는 도감에 넣지 않고 프로필만 보여 준다
    if (fresh) {
      if (req.user) {
        const r = recordEncounter(db, req.user.id, owner, verified);
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
    const login = req.user
      ? ""
      : `<div class="card"><b>로그인하면 이 사람이 내 도감에 저장돼요</b>
         <input id="email" type="email" placeholder="이메일" style="font:inherit;padding:10px;border-radius:8px;border:1px solid var(--line)">
         <button id="send">로그인 링크 받기</button><p id="msg" class="muted"></p></div>
         <script nonce="${n}">
           document.getElementById("send").onclick = async () => {
             const r = await fetch("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ email: document.getElementById("email").value }) });
             const j = await r.json();
             document.getElementById("msg").textContent = r.ok ? "메일함을 확인하세요. 15분 안에 링크를 눌러 주세요." : j.message;
           };
         </script>`;
    res.type("html").send(page(p.name, `${banner}<div class="card"><h1>${esc(p.name)}</h1>${details}</div>${login}`));
  });

  return r;
}
