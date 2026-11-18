// 이메일 매직 링크 로그인.
// 메일 보안 스캐너가 링크를 미리 열어 토큰을 써 버리는 일을 막기 위해, 링크(GET)는 확인 페이지만 보여 주고
// 실제 로그인은 그 페이지의 버튼(POST)에서 한다.
import { Router } from "express";
import { randomId, randomToken, sha256 } from "../crypto.js";
import { EMAIL_RE, HttpError, PENDING_COOKIE, SESSION_COOKIE, TERMS_VERSION, bad, cookieOptions, isSuspended, str } from "../lib.js";
import { page } from "../pages.js";

const LOGIN_TTL = 15 * 60_000;
const SESSION_TTL = 30 * 24 * 3600_000;

export function authRoutes({ db, cfg, mailer, limit, meet }) {
  const r = Router();

  r.post("/api/auth/request", (req, res, next) => requestLink(req, res).catch(next));

  async function requestLink(req, res) {
    const email = str(req.body?.email, "email", { max: 254, min: 3 }).toLowerCase();
    if (!EMAIL_RE.test(email)) throw bad("invalid_email", "이메일 주소를 확인해 주세요");
    limit(`login-ip:${req.ip}`, 10, 15 * 60_000);
    limit(`login-email:${email}`, 5, 15 * 60_000);
    const token = randomToken();
    db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)").run(
      sha256(token),
      email,
      Date.now() + LOGIN_TTL,
    );
    const link = `${cfg.origin}/auth/verify?token=${token}`;
    await mailer.send({
      to: email,
      subject: "Meetcha 로그인 링크",
      text: `아래 링크를 눌러 로그인하세요. 15분 동안 한 번만 쓸 수 있어요.\n\n${link}\n\n요청하지 않았다면 이 메일을 무시하세요.`,
      link,
    });
    // 가입 여부를 알려 주지 않도록 항상 같은 응답
    res.json({ ok: true });
  }

  r.get("/auth/verify", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    res.type("html").send(
      page(
        "로그인",
        `<h1>Meetcha 로그인</h1><p>아래 버튼을 누르면 로그인돼요.</p>
         <div id="consent" hidden>
           <p><b>처음 오셨군요!</b> 가입하려면 아래 내용에 동의해 주세요.</p>
           <label><input type="checkbox" id="c-age"> [필수] 만 14세 이상입니다.</label><br>
           <label><input type="checkbox" id="c-terms"> [필수] <a href="/legal/terms" target="_blank">이용약관</a>에 동의합니다.</label><br>
           <label><input type="checkbox" id="c-privacy"> [필수] <a href="/legal/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다.
             <span class="muted">(수집 항목: 이메일, 이름 · 목적: 회원 식별, 로그인, 명함 표시 · 보유 기간: 탈퇴 시까지. 동의하지 않으면 가입할 수 없어요.)</span></label>
         </div>
         <button id="go">로그인</button><p id="msg"></p>
         <script nonce="${res.locals.nonce}">
           const $ = (id) => document.getElementById(id);
           $("go").onclick = async () => {
             const body = { token: ${JSON.stringify(token).replace(/</g, "\\u003c")} };
             if (!$("consent").hidden) body.consent = { age: $("c-age").checked, terms: $("c-terms").checked, privacy: $("c-privacy").checked };
             const r = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
             const j = await r.json();
             if (r.ok) return (location.href = j.redirect || "/");
             if (j.error === "consent_required") { $("consent").hidden = false; $("go").textContent = "동의하고 가입하기"; }
             $("msg").textContent = j.message;
           };
         </script>`,
      ),
    );
  });

  r.post("/api/auth/verify", (req, res) => {
    const token = str(req.body?.token, "token", { max: 100, min: 10 });
    limit(`verify-ip:${req.ip}`, 30, 15 * 60_000);
    const now = Date.now();
    const row = db.prepare("SELECT * FROM login_tokens WHERE token_hash = ?").get(sha256(token));
    if (!row || row.used_at || row.expires_at < now)
      throw new HttpError(400, "invalid_token", "링크가 만료됐거나 이미 사용됐어요. 다시 요청해 주세요");

    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(row.email);
    // 새 회원은 만 14세 이상 확인과 약관·처리방침 동의가 있어야 가입된다. 동의 전에는 링크를 소모하지 않는다.
    if (!user) {
      const c = req.body?.consent;
      if (!(c?.age === true && c?.terms === true && c?.privacy === true))
        throw new HttpError(409, "consent_required", "만 14세 이상 확인과 이용약관·개인정보 수집 동의가 모두 필요해요");
    }
    if (isSuspended(user, now)) throw new HttpError(403, "account_suspended", "이용이 정지된 계정이에요");
    db.prepare("UPDATE login_tokens SET used_at = ? WHERE token_hash = ?").run(now, row.token_hash);
    if (!user) {
      const id = randomId();
      db.prepare("INSERT INTO users (id, email, terms_version, consented_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id,
        row.email,
        TERMS_VERSION,
        now,
        now,
      );
      user = { id };
    }
    db.prepare("INSERT INTO login_events (user_id, ip, at) VALUES (?, ?, ?)").run(user.id, req.ip || "", now);
    const session = randomToken();
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
      sha256(session),
      user.id,
      now + SESSION_TTL,
    );
    res.cookie(SESSION_COOKIE, session, cookieOptions(cfg, SESSION_TTL));

    // 로그인 전에 태그했던 키링이 있으면 도감에 넣고 그 프로필로 보낸다
    let redirect = "/";
    const pending = req.cookies[PENDING_COOKIE];
    if (pending) {
      const p = db.prepare("SELECT * FROM pending_scans WHERE token_hash = ? AND expires_at > ?").get(sha256(pending), now);
      if (p) {
        meet(user.id, p.owner_id, !!p.verified, now);
        db.prepare("DELETE FROM pending_scans WHERE token_hash = ?").run(p.token_hash);
        redirect = `/u/${p.owner_id}`;
      }
      res.clearCookie(PENDING_COOKIE, { path: "/" });
    }
    res.json({ ok: true, userId: user.id, redirect });
  });

  r.post("/api/auth/logout", (req, res) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(t));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  return r;
}
