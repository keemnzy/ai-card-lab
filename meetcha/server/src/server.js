import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);

// 메일 발송: 개발 중에는 터미널에 로그인 링크를 출력한다.
// 운영에서는 이 객체를 Resend / AWS SES / SMTP 발송으로 바꾼다 (send({ to, subject, text })).
const mailer = {
  async send({ to, subject, link }) {
    if (cfg.production) throw new Error("운영용 메일 발송이 아직 설정되지 않았어요 (src/server.js의 mailer)");
    console.log(`\n[메일] ${to} · ${subject}\n  ${link}\n`);
  },
};

// 만료된 로그인 토큰·세션·대기 태그 정리 (1시간마다)
setInterval(() => {
  const now = Date.now();
  db.prepare("DELETE FROM login_tokens WHERE expires_at < ?").run(now - 86400_000);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM pending_scans WHERE expires_at < ?").run(now);
}, 3600_000).unref();

createApp({ db, cfg, mailer }).listen(cfg.port, () => {
  console.log(`Meetcha 서버: ${cfg.origin} (포트 ${cfg.port})`);
});
