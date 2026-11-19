import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb, purgeExpired } from "./db.js";

const cfg = loadConfig();
// 참가자 화면: meetcha/web 에서 `npm run build` 하면 생기는 폴더
cfg.webDist ??= fileURLToPath(new URL("../../web/dist", import.meta.url));
const db = openDb(cfg.dbPath);

// 메일 발송: 개발 중에는 터미널에 로그인 링크를 출력한다.
// 운영에서는 이 객체를 Resend / AWS SES / SMTP 발송으로 바꾼다 (send({ to, subject, text })).
const mailer = {
  async send({ to, subject, link }) {
    if (cfg.production) throw new Error("운영용 메일 발송이 아직 설정되지 않았어요 (src/server.js의 mailer)");
    console.log(`\n[메일] ${to} · ${subject}\n  ${link}\n`);
  },
};

// 보관 기간이 지난 데이터 정리 (1시간마다)
setInterval(() => purgeExpired(db), 3600_000).unref();
purgeExpired(db);

createApp({ db, cfg, mailer }).listen(cfg.port, () => {
  console.log(`Meetcha 서버: ${cfg.origin} (포트 ${cfg.port})`);
});
