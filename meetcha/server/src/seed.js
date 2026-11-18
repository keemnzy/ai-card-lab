// 개발용 예시 데이터: 예시 참가자 3명 + 키링(고정 링크) + 지금 진행 중인 이벤트.
// 실행: npm run seed  → 출력되는 키링 URL을 브라우저에서 열면 "태그"한 것과 같다.
import { loadConfig } from "./config.js";
import { openDb, tx } from "./db.js";
import { randomId, randomToken, sha256 } from "./crypto.js";
import { claimCode } from "./routes/admin.js";

const cfg = loadConfig();
if (cfg.production) throw new Error("운영 DB에는 예시 데이터를 넣지 않아요");
const db = openDb(cfg.dbPath);
const now = Date.now();

const people = [
  { email: "haneul@example.com", name: "김하늘", role: "Product Manager", org: "블레스드스피릿", hint: "기획", one: "사용자 인터뷰 300번 해본 PM. 커피는 무조건 디카페인.",
    quiz: [["하늘님이 해본 사용자 인터뷰 횟수는?", ["30번", "100번", "300번", "1000번"], 2]] },
  { email: "junho@example.com", name: "이준호", role: "Backend Engineer", org: "스타트업 A", hint: "개발", one: "주말엔 클라이밍, 평일엔 Postgres 튜닝.",
    quiz: [["준호님의 주말 취미는?", ["러닝", "클라이밍", "서핑", "보드게임"], 1]] },
  { email: "seoyeon@example.com", name: "박서연", role: "Brand Designer", org: "GSCC 운영진", hint: "디자인", one: "이 키링 3D 모델링한 사람이 저예요.",
    quiz: [["서연님이 오늘 만든 것은?", ["포스터", "키링 3D 모델", "웹사이트", "명찰"], 1]] },
];

const checkin = randomToken(12);
const out = [];
tx(db, () => {
  const eventId = randomId();
  db.prepare("INSERT INTO events (id, name, client, starts_at, ends_at, checkin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    eventId, "GSCC 네트워킹 나이트 (예시)", "GSCC", now - 600_000, now + 4 * 3600_000, sha256(checkin), now,
  );
  for (const p of people) {
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(p.email)) continue;
    const id = randomId();
    db.prepare("INSERT INTO users (id, email, name, role, org, one_liner, hint, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'encountered', ?)").run(
      id, p.email, p.name, p.role, p.org, p.one, p.hint, now,
    );
    p.quiz.forEach(([q, o, a], i) =>
      db.prepare("INSERT INTO quiz_questions (user_id, pos, question, options, answer) VALUES (?, ?, ?, ?, ?)").run(id, i, q, JSON.stringify(o), a),
    );
    db.prepare("INSERT INTO event_attendees (event_id, user_id, checked_in_at, show_leaderboard) VALUES (?, ?, ?, 1)").run(eventId, id, now);
    const code = randomToken(16);
    db.prepare("INSERT INTO tags (id, kind, code_hash, claim_hash, owner_id, label, created_at) VALUES (?, 'static', ?, ?, ?, '예시', ?)").run(
      randomId(), sha256(code), sha256(claimCode().replace("-", "")), id, now,
    );
    out.push(`  ${p.name.padEnd(4)} ${cfg.origin}/t/${code}`);
  }
  console.log(`예시 이벤트 체크인 코드: ${checkin}  (이벤트 ID ${eventId})`);
});
console.log("예시 키링 (브라우저에서 열면 태그한 것과 같아요):\n" + out.join("\n"));
