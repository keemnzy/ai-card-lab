// 실제 HTTP로 서버를 띄워 전체 흐름을 확인한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { createDiskStorage } from "../src/media.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { deriveTagKey, encodeSun } from "../src/crypto.js";
import { TERMS_VERSION, createLimiter } from "../src/lib.js";
import { RETENTION, purgeExpired } from "../src/db.js";

const META = "00112233445566778899aabbccddeeff";
const MASTER = "ffeeddccbbaa99887766554433221100";
let server, base, db, cfg, clock, mediaDir;
const sent = [];
const CONSENT = { age: true, terms: true, privacy: true };

before(async () => {
  db = openDb(":memory:");
  cfg = loadConfig({ APP_ORIGIN: "http://localhost", ADMIN_EMAILS: "admin@bs.kr", SUN_META_KEY: META, SUN_MASTER_KEY: MASTER });
  clock = { t: null };
  const now = () => clock.t ?? Date.now();
  const mailer = { async send(m) { sent.push(m); } };
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "meetcha-media-"));
  server = createApp({ db, cfg, mailer, now, limit: () => {}, storage: createDiskStorage(mediaDir) }).listen(0); // 레이트 리밋은 아래 별도 테스트
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

// 쿠키를 기억하는 간단한 클라이언트
function client() {
  const jar = {};
  async function req(method, path, body, { raw } = {}) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      if (/Expires=Thu, 01 Jan 1970/.test(c) || v === "") delete jar[k];
      else jar[k] = v;
    }
    if (raw) return res;
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  return { req, jar, get: (p, o) => req("GET", p, undefined, o), post: (p, b, o) => req("POST", p, b ?? {}, o), put: (p, b) => req("PUT", p, b), del: (p) => req("DELETE", p) };
}

async function login(c, email) {
  const r = await c.post("/api/auth/request", { email });
  assert.equal(r.status, 200);
  const token = new URL(sent.at(-1).link).searchParams.get("token");
  const v = await c.post("/api/auth/verify", { token, consent: CONSENT });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body;
}

async function newUser(email, profile = {}) {
  const c = client();
  const { userId } = await login(c, email);
  await c.put("/api/me/profile", { name: email.split("@")[0], role: "Engineer", org: "Org", oneLiner: "hi", hint: "개발", ...profile });
  return { c, id: userId };
}

test("로그인: 링크는 한 번만 쓸 수 있고, 로그아웃하면 세션이 끊긴다", async () => {
  const c = client();
  await c.post("/api/auth/request", { email: "Once@Test.com" });
  const token = new URL(sent.at(-1).link).searchParams.get("token");
  assert.equal(sent.at(-1).to, "once@test.com");
  assert.equal((await c.post("/api/auth/verify", { token, consent: CONSENT })).status, 200);
  assert.equal((await c.get("/api/me")).status, 200);
  assert.equal((await client().post("/api/auth/verify", { token, consent: CONSENT })).body.error, "invalid_token");
  await c.post("/api/auth/logout");
  assert.equal((await c.get("/api/me")).status, 401);
});

test("보안: 다른 출처 POST와 JSON이 아닌 POST는 막힌다", async () => {
  const r1 = await fetch(base + "/api/auth/request", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(r1.status, 403);
  const r2 = await fetch(base + "/api/auth/request", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=a@b.co" });
  assert.equal(r2.status, 415);
  const page = await fetch(base + "/healthz");
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("프로필: https 링크만 허용, 퀴즈는 보기 4개", async () => {
  const { c } = await newUser("links@test.com");
  assert.equal((await c.put("/api/me/links", { links: [{ label: "x", url: "javascript:alert(1)" }] })).body.error, "invalid_url");
  assert.equal((await c.put("/api/me/links", { links: [{ label: "x", url: "http://a.com" }] })).body.error, "invalid_url");
  assert.equal((await c.put("/api/me/links", { links: [{ label: "LinkedIn", url: "https://linkedin.com/in/x" }] })).status, 200);
  assert.equal((await c.put("/api/me/quiz", { quiz: [{ question: "q", options: ["a", "b"], answer: 0 }] })).status, 400);
  assert.equal((await c.put("/api/me/quiz", { quiz: [{ question: "q", options: ["a", "b", "c", "d"], answer: 4 }] })).status, 400);
});

async function issueStaticTag(admin, owner) {
  const r = await admin.post("/api/admin/tags", { kind: "static", count: 1, label: "GSSC" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [t] = r.body.tags;
  assert.equal((await owner.post("/api/me/tags/claim", { claimCode: t.claimCode.toLowerCase() })).status, 200);
  return new URL(t.url).pathname;
}

test("관리자 API는 관리자만", async () => {
  const { c } = await newUser("nobody@test.com");
  assert.equal((await c.post("/api/admin/tags", { kind: "static", count: 1 })).status, 403);
});

test("태그 → 도감 → 공개 범위 → 퀴즈(서버 채점) → 메모·메시지·차단", async () => {
  const admin = (await newUser("admin@bs.kr")).c;
  const alice = await newUser("alice@test.com", { name: "Alice" }); // 기본 공개 범위: 만난 사람만
  const bob = await newUser("bob@test.com", { name: "Bob" });
  await alice.c.put("/api/me/quiz", {
    quiz: [
      { question: "취미는?", options: ["러닝", "클라이밍", "서핑", "독서"], answer: 1 },
      { question: "커피는?", options: ["아메", "라떼", "디카페인", "안 마심"], answer: 2 },
    ],
  });
  const path = await issueStaticTag(admin, alice.c);

  // 만나기 전: Bob은 Alice의 이름만 본다
  const before = await bob.c.get(`/api/users/${alice.id}`);
  assert.equal(before.body.limited, true);
  assert.equal(before.body.oneLiner, undefined);
  assert.equal((await bob.c.post(`/api/users/${alice.id}/quiz/attempts`)).status, 403);
  assert.equal((await bob.c.post(`/api/users/${alice.id}/messages`, { body: "hi" })).status, 403);

  // Bob이 Alice 키링을 태그
  const scan = await bob.c.get(path);
  assert.equal(scan.status, 302);
  assert.equal(scan.headers.get("location"), `/u/${alice.id}?new=1`);
  const dex = await bob.c.get("/api/dex");
  assert.equal(dex.body.count, 1);
  assert.equal(dex.body.people[0].name, "Alice");
  assert.equal(dex.body.people[0].verified, false); // 고정 링크 키링
  const after = await bob.c.get(`/api/users/${alice.id}`);
  assert.equal(after.body.limited, false);
  assert.equal(after.body.quizCount, 2);
  assert.ok(!JSON.stringify(after.body).includes('"answer"'), "정답이 응답에 섞이면 안 됨");

  // 퀴즈: 시간을 직접 조절해 점수 확인
  clock.t = 1_000_000;
  const start = await bob.c.post(`/api/users/${alice.id}/quiz/attempts`);
  assert.equal(start.status, 201);
  assert.equal(start.body.question.answer, undefined);
  clock.t += 2_000; // 2초 만에 정답 → 900점
  const a1 = await bob.c.post(`/api/quiz/attempts/${start.body.attemptId}/answer`, { choice: 1 });
  assert.deepEqual([a1.body.correct, a1.body.points, a1.body.done], [true, 900, false]);
  clock.t += 3_000; // 오답
  const a2 = await bob.c.post(`/api/quiz/attempts/${start.body.attemptId}/answer`, { choice: 0 });
  assert.deepEqual([a2.body.correct, a2.body.points, a2.body.done, a2.body.result.score], [false, 0, true, 900]);
  assert.equal((await bob.c.post(`/api/quiz/attempts/${start.body.attemptId}/answer`, { choice: 0 })).status, 409);
  // 다른 사람이 남의 시도에 답할 수 없음
  assert.equal((await alice.c.post(`/api/quiz/attempts/${start.body.attemptId}/answer`, { choice: 0 })).status, 404);
  clock.t = null;
  assert.equal((await bob.c.get("/api/dex")).body.people[0].bestScore, 900);

  // 메모는 본인만
  await bob.c.put(`/api/users/${alice.id}/note`, { body: "커피챗 약속" });
  assert.equal((await bob.c.get(`/api/users/${alice.id}`)).body.note, "커피챗 약속");
  assert.equal((await alice.c.get(`/api/users/${bob.id}`)).body.note, "");

  // 메시지 → 받은 편지함
  assert.equal((await bob.c.post(`/api/users/${alice.id}/messages`, { body: "반가웠어요!" })).status, 201);
  const inbox = await alice.c.get("/api/me/messages");
  assert.equal(inbox.body.messages[0].body, "반가웠어요!");
  assert.equal(inbox.body.messages[0].from.name, "Bob");

  // 차단하면 이후 메시지는 조용히 버려진다
  await alice.c.post(`/api/users/${bob.id}/block`);
  assert.equal((await bob.c.post(`/api/users/${alice.id}/messages`, { body: "또 봐요" })).status, 201);
  assert.equal((await alice.c.get("/api/me/messages")).body.messages.length, 0);
});

test("로그인 전에 태그하면, 로그인 후 도감에 들어간다", async () => {
  const admin = client();
  await login(admin, "admin@bs.kr");
  const owner = await newUser("owner2@test.com", { name: "Owner" });
  const path = await issueStaticTag(admin, owner.c);
  const guest = client();
  const scan = await guest.get(path);
  assert.equal(scan.headers.get("location"), `/u/${owner.id}`);
  const landing = await guest.get(`/u/${owner.id}`);
  assert.match(landing.body, /로그인하면 이 사람이 내 도감에 저장돼요/);
  const v = await login(guest, "guest@test.com");
  assert.equal(v.redirect, `/u/${owner.id}`);
  assert.equal((await guest.get("/api/dex")).body.count, 1);
});

test("NTAG 424 DNA: 서명 확인, 복사된 링크(카운터 재사용)는 도감에 안 들어감, 분실 신고", async () => {
  const admin = client();
  await login(admin, "admin@bs.kr");
  const uid = "04A1B2C3D4E5F6";
  const r = await admin.post("/api/admin/tags", { kind: "sun", uids: [uid], label: "GSSC" });
  const owner = await newUser("sunowner@test.com", { name: "Sun" });
  await owner.c.post("/api/me/tags/claim", { claimCode: r.body.tags[0].claimCode });
  const keys = { metaKey: Buffer.from(META, "hex"), fileKey: deriveTagKey(Buffer.from(MASTER, "hex"), Buffer.from(uid, "hex")) };

  const scanner = await newUser("scanner@test.com");
  const tap5 = encodeSun(uid, 5, keys);
  const s1 = await scanner.c.get(`/t?e=${tap5.e}&c=${tap5.c}`);
  assert.equal(s1.headers.get("location"), `/u/${owner.id}?new=1`);
  assert.equal((await scanner.c.get("/api/dex")).body.people[0].verified, true);

  // 같은 URL을 복사해서 다른 사람이 열면: 프로필로는 가지만 도감엔 안 들어감
  const copycat = await newUser("copycat@test.com");
  const s2 = await copycat.c.get(`/t?e=${tap5.e}&c=${tap5.c}`);
  assert.equal(s2.headers.get("location"), `/u/${owner.id}`);
  assert.equal((await copycat.c.get("/api/dex")).body.count, 0);

  // 위조된 MAC
  const bad = await scanner.c.get(`/t?e=${tap5.e}&c=0000000000000000`);
  assert.equal(bad.status, 400);

  // 분실 신고 후에는 열리지 않음
  const tagId = (await owner.c.get("/api/me")).body.tags[0].id;
  await owner.c.post(`/api/me/tags/${tagId}/lost`);
  const tap6 = encodeSun(uid, 6, keys);
  assert.equal((await copycat.c.get(`/t?e=${tap6.e}&c=${tap6.c}`)).status, 410);
});

test("이벤트: 체크인 → 가려진 보드 → 태그하면 공개 → 리더보드·리포트", async () => {
  const admin = client();
  await login(admin, "admin@bs.kr");
  const ev = await admin.post("/api/admin/events", { name: "GSSC 네트워킹 나이트", client: "GSSC", startsAt: Date.now() - 60_000, endsAt: Date.now() + 3600_000 });
  assert.equal(ev.status, 201);
  const p1 = await newUser("e1@test.com", { name: "E1", hint: "기획" });
  const p2 = await newUser("e2@test.com", { name: "E2", hint: "디자인" });
  const p3 = await newUser("e3@test.com", { name: "E3", hint: "투자" });
  assert.equal((await p1.c.get(`/api/events/${ev.body.id}/board`)).status, 403);
  for (const p of [p1, p2, p3]) await p.c.post("/api/events/checkin", { code: ev.body.checkinCode, showOnLeaderboard: p !== p3 });

  let board = (await p1.c.get(`/api/events/${ev.body.id}/board`)).body;
  assert.equal(board.total, 2);
  assert.equal(board.found, 0);
  assert.deepEqual(board.slots.map((s) => s.hint), ["디자인", "투자"]);
  assert.ok(board.slots.every((s) => !s.user && !s.name), "못 만난 사람 이름은 숨김");

  const path = await issueStaticTag(admin, p2.c);
  await p1.c.get(path);
  board = (await p1.c.get(`/api/events/${ev.body.id}/board`)).body;
  assert.equal(board.found, 1);
  assert.equal(board.slots[0].user.name, "E2");

  const lb = (await p2.c.get(`/api/events/${ev.body.id}/leaderboard`)).body.leaders;
  assert.deepEqual(lb.map((l) => [l.name, l.met]), [["E1", 1], ["E2", 0]]); // E3는 동의 안 해서 빠짐

  const rep = (await admin.get(`/api/admin/events/${ev.body.id}/report`)).body;
  assert.deepEqual([rep.attendees, rep.encounters], [3, 1]);
  assert.ok(!/"name":"E\d"|e\d@test\.com/.test(JSON.stringify(rep)), "리포트에 개인 정보 없음");
});

test("탈퇴: 개인정보 삭제, 상대 도감에는 '탈퇴한 사용자'로 남음", async () => {
  const admin = client();
  await login(admin, "admin@bs.kr");
  const leaver = await newUser("leaver@test.com", { name: "Leaver", visibility: "public" });
  const friend = await newUser("friend@test.com");
  const path = await issueStaticTag(admin, leaver.c);
  await friend.c.get(path);
  assert.equal((await leaver.c.del("/api/me")).status, 200);
  assert.equal((await leaver.c.get("/api/me")).status, 401);
  const dex = (await friend.c.get("/api/dex")).body.people[0];
  assert.deepEqual([dex.name, dex.deleted, dex.limited], ["탈퇴한 사용자", true, true]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'leaver@test.com'").get().n, 0);
  // 같은 이메일로 다시 가입하면 새 계정
  const back = client();
  const { userId } = await login(back, "leaver@test.com");
  assert.notEqual(userId, leaver.id);
});

test("레이트 리밋: 한도를 넘으면 429", () => {
  const limit = createLimiter();
  for (let i = 0; i < 5; i++) limit("k", 5, 60_000);
  assert.throws(() => limit("k", 5, 60_000), (e) => e.status === 429);
  limit("other", 5, 60_000); // 다른 키는 영향 없음
});

test("가입 동의: 새 회원은 동의가 있어야 가입되고, 동의 전에는 링크가 소모되지 않는다", async () => {
  const c = client();
  await c.post("/api/auth/request", { email: "consent@test.com" });
  const token = new URL(sent.at(-1).link).searchParams.get("token");
  const r1 = await c.post("/api/auth/verify", { token });
  assert.equal(r1.body.error, "consent_required");
  const r2 = await c.post("/api/auth/verify", { token, consent: { age: false, terms: true, privacy: true } });
  assert.equal(r2.body.error, "consent_required");
  const r3 = await c.post("/api/auth/verify", { token, consent: CONSENT }); // 같은 링크로 다시 시도 가능
  assert.equal(r3.status, 200);
  const me = (await c.get("/api/me")).body;
  assert.deepEqual([me.consentRequired, me.termsVersion], [false, TERMS_VERSION]);
  const row = db.prepare("SELECT terms_version, consented_at FROM users WHERE email = 'consent@test.com'").get();
  assert.equal(row.terms_version, TERMS_VERSION);
  assert.ok(row.consented_at > 0);
  // 기존 회원은 다시 로그인할 때 동의를 묻지 않는다
  await c.post("/api/auth/request", { email: "consent@test.com" });
  const t2 = new URL(sent.at(-1).link).searchParams.get("token");
  assert.equal((await client().post("/api/auth/verify", { token: t2 })).status, 200);
  // 약관 버전이 바뀐 회원은 consentRequired → 다시 동의
  db.prepare("UPDATE users SET terms_version = 'old' WHERE email = 'consent@test.com'").run();
  assert.equal((await c.get("/api/me")).body.consentRequired, true);
  assert.equal((await c.post("/api/me/consent", CONSENT)).status, 200);
  assert.equal((await c.get("/api/me")).body.consentRequired, false);
});

test("접속 기록: 로그인할 때 남고 3개월 지나면 삭제", async () => {
  const { id } = await newUser("logs@test.com");
  const n = () => db.prepare("SELECT COUNT(*) AS n FROM login_events WHERE user_id = ?").get(id).n;
  assert.equal(n(), 1);
  purgeExpired(db, Date.now() + RETENTION.loginEvents - 60_000);
  assert.equal(n(), 1);
  purgeExpired(db, Date.now() + RETENTION.loginEvents + 60_000);
  assert.equal(n(), 0);
});

test("약관 원문 제공 (한국어·영문)", async () => {
  const ko = await fetch(base + "/legal/privacy");
  assert.equal(ko.status, 200);
  assert.match(await ko.text(), /개인정보처리방침/);
  const en = await fetch(base + "/legal/terms?lang=en");
  assert.match(await en.text(), /Terms of Service/);
  assert.equal((await fetch(base + "/legal/../package.json")).status, 404);
});

test("신고 → 운영진 확인 → 이용 정지 → 정지 해제", async () => {
  const admin = client();
  await login(admin, "admin@bs.kr");
  const bad = await newUser("troll@test.com", { name: "Troll", hint: "트롤" });
  const victim = await newUser("victim@test.com");
  const stranger = await newUser("stranger@test.com");
  const path = await issueStaticTag(admin, bad.c);
  await victim.c.get(path);

  // 만난 적 없는 사람은 (전체 공개가 아니면) 신고 불가
  assert.equal((await stranger.c.post(`/api/users/${bad.id}/report`, { reason: "spam" })).status, 403);
  assert.equal((await victim.c.post(`/api/users/${bad.id}/report`, { reason: "nope" })).status, 400);
  assert.equal((await victim.c.post(`/api/users/${bad.id}/report`, { reason: "harassment", detail: "계속 메시지" })).status, 201);
  assert.equal((await victim.c.post(`/api/users/${bad.id}/report`, { reason: "harassment", detail: "추가 내용" })).status, 201);
  assert.equal((await victim.c.get("/api/admin/reports")).status, 403);

  const list = (await admin.get("/api/admin/reports")).body.reports.filter((r) => r.target.id === bad.id);
  assert.equal(list.length, 1, "처리 전 같은 신고는 하나로 합침");
  assert.equal(list[0].detail, "추가 내용");

  // 정지: 세션이 끊기고, 로그인도 못 하고, 명함·키링이 닫힌다
  const sus = await admin.post(`/api/admin/users/${bad.id}/suspend`, { days: 7, reason: "괴롭힘 신고" });
  assert.equal(sus.status, 200);
  assert.equal((await bad.c.get("/api/me")).status, 401); // 세션이 바로 끊김
  await bad.c.post("/api/auth/request", { email: "troll@test.com" });
  const t = new URL(sent.at(-1).link).searchParams.get("token");
  assert.equal((await bad.c.post("/api/auth/verify", { token: t })).body.error, "account_suspended");
  assert.equal((await victim.c.get(`/api/users/${bad.id}`)).body.limited, true);
  assert.equal((await stranger.c.get(path)).status, 403);
  assert.equal((await victim.c.post(`/api/users/${bad.id}/messages`, { body: "?" })).status, 201);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE to_id = ?").get(bad.id).n, 0);
  assert.equal((await admin.post(`/api/admin/users/${(await admin.get("/api/me")).body.id}/suspend`, { reason: "x" })).status, 403);

  assert.equal((await admin.post(`/api/admin/reports/${list[0].id}/resolve`, { status: "actioned", note: "7일 정지" })).status, 200);
  assert.equal((await admin.get("/api/admin/reports?status=actioned")).body.reports.some((r) => r.id === list[0].id), true);

  // 해제하면 다시 로그인 가능
  await admin.post(`/api/admin/users/${bad.id}/unsuspend`);
  await bad.c.post("/api/auth/request", { email: "troll@test.com" });
  const t2 = new URL(sent.at(-1).link).searchParams.get("token");
  assert.equal((await bad.c.post("/api/auth/verify", { token: t2 })).status, 200);
  assert.equal((await victim.c.get(`/api/users/${bad.id}`)).body.limited, false);
});

// SSE 스트림에 붙어서 받은 이벤트를 모은다
async function stream(c, path) {
  const ac = new AbortController();
  const res = await fetch(base + path, { headers: { cookie: Object.entries(c.jar).map(([k, v]) => `${k}=${v}`).join("; ") }, signal: ac.signal });
  const got = [];
  const waiters = [];
  if (res.ok) {
    (async () => {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const type = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (!type) continue;
            got.push({ type, data: JSON.parse(data) });
            waiters.splice(0).forEach((w) => w());
          }
        }
      } catch { /* 닫힘 */ }
    })();
  }
  const changed = () => new Promise((r) => waiters.push(r));
  return {
    status: res.status,
    got,
    close: () => ac.abort(),
    /** type 이벤트가 올 때까지 기다린다 (최대 2초) */
    async wait(type, pred = () => true) {
      const deadline = Date.now() + 2000;
      for (;;) {
        const hit = got.find((e) => e.type === type && pred(e.data));
        if (hit) return hit.data;
        if (Date.now() > deadline) throw new Error(`이벤트 ${type} 안 옴. 받은 것: ${got.map((e) => e.type)}`);
        await Promise.race([changed(), new Promise((r) => setTimeout(r, 100))]);
      }
    },
  };
}

test("실시간 피드: 누가 무엇을 받는지 (개인정보 범위 포함)", async () => {
  const admin = client();
  await login(admin, "admin@bs.kr");
  const ev = await admin.post("/api/admin/events", { name: "Live", startsAt: Date.now() - 60_000, endsAt: Date.now() + 3600_000 });
  const eid = ev.body.id;
  const a = await newUser("live-a@test.com", { name: "LiveA" });
  const b = await newUser("live-b@test.com", { name: "LiveB" });
  const c = await newUser("live-c@test.com", { name: "LiveC" });
  const outsider = await newUser("live-x@test.com");
  await a.c.post("/api/events/checkin", { code: ev.body.checkinCode, showOnLeaderboard: true });
  await b.c.post("/api/events/checkin", { code: ev.body.checkinCode });

  assert.equal((await stream(outsider.c, `/api/events/${eid}/stream`)).status, 403);
  const sa = await stream(a.c, `/api/events/${eid}/stream`);
  const sb = await stream(b.c, `/api/events/${eid}/stream`);
  try {
    assert.equal(sa.status, 200);
    assert.equal((await sa.wait("ready")).checkedIn, 2);

    // C 체크인 → A, B는 인원수만 받는다 (리더보드 비동의라 이름 없음)
    await c.c.post("/api/events/checkin", { code: ev.body.checkinCode });
    const ck = await sb.wait("checkin");
    assert.deepEqual(ck, { checkedIn: 3 });

    // A(리더보드 동의)가 B를 태그
    const pathB = await issueStaticTag(admin, b.c);
    await a.c.get(pathB);
    assert.equal((await sa.wait("found")).user.name, "LiveB");
    assert.equal((await sb.wait("tagged")).by.name, "LiveA");
    assert.deepEqual((await sb.wait("activity")).who, { id: a.id, name: "LiveA" });
    assert.equal((await sb.wait("leaderboard")).leaders[0].name, "LiveA");
    assert.equal((await sb.wait("stats", (s) => s.encounters === 1)).checkedIn, 3);
    assert.ok(!sb.got.some((e) => e.type === "found"), "found는 태그한 본인에게만");
    assert.ok(!sa.got.some((e) => e.type === "tagged"), "tagged는 태그당한 사람에게만");

    // B(비동의)가 A를 태그 → 활동 소식에 이름이 안 나온다
    const pathA = await issueStaticTag(admin, a.c);
    await b.c.get(pathA);
    const act = await sa.wait("activity", (d) => d.who === null);
    assert.deepEqual([act.who, act.met], [null, null]);

    // 같은 사람을 다시 태그해도 알림은 다시 안 감
    const before = sa.got.length;
    await a.c.get(pathB);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(sa.got.filter((e) => e.type === "found").length, 1);
    assert.ok(sa.got.length >= before);

    // 한 사람당 열 수 있는 창 수 제한
    const extra = [await stream(a.c, `/api/events/${eid}/stream`), await stream(a.c, `/api/events/${eid}/stream`)];
    const over = await stream(a.c, `/api/events/${eid}/stream`);
    assert.equal(over.status, 429);
    extra.forEach((s) => s.close());
  } finally {
    sa.close();
    sb.close();
  }
});

// ---------- 행사 굿즈 포지셔닝 기능 ----------
async function adminClient() {
  const a = client();
  await login(a, "admin@bs.kr");
  return a;
}
const liveEvent = (admin, name = "Meetup") =>
  admin.post("/api/admin/events", { name, client: "GSSC", startsAt: Date.now() - 60_000, endsAt: Date.now() + 3600_000 }).then((r) => r.body);

test("참가자 명단 CSV: 열 이름 자동 인식, 따옴표, 잘못된 행, 중복 갱신", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin);
  const csv = '﻿First Name,Last Name,Email,Company,Job Title\r\nAda,Lovelace,ADA@calc.io,"Analytical, Inc",Engineer\r\nBad,Row,not-an-email,X,Y\r\n"Grace","Hopper",grace@navy.mil,Navy,"Rear Admiral"\r\n';
  const r = await admin.post(`/api/admin/events/${ev.id}/attendees/import`, { csv });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.added, r.body.updated, r.body.invalid.length, r.body.total], [2, 0, 1, 2]);
  const again = await admin.post(`/api/admin/events/${ev.id}/attendees/import`, { attendees: [{ email: "ada@calc.io", name: "Ada L.", org: "Calc" }] });
  assert.deepEqual([again.body.added, again.body.updated], [0, 1]);
  const list = (await admin.get(`/api/admin/events/${ev.id}/attendees`)).body;
  const ada = list.attendees.find((a) => a.email === "ada@calc.io");
  assert.deepEqual([ada.name, ada.org, ada.joined], ["Ada L.", "Calc", false]);
  assert.equal(list.attendees.find((a) => a.email === "grace@navy.mil").org, "Navy");
  assert.equal((await admin.post(`/api/admin/events/${ev.id}/attendees/import`, { csv: "name\nx" })).body.error, "invalid_csv");
  const user = await newUser("plain@test.com");
  assert.equal((await user.c.post(`/api/admin/events/${ev.id}/attendees/import`, { csv })).status, 403);
});

test("행사 전 안내 메일 → 링크로 가입하면 프로필이 미리 채워짐", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "Prefill Night");
  await admin.post(`/api/admin/events/${ev.id}/attendees/import`, { attendees: [{ email: "invitee@test.com", name: "Invi Tee", role: "PM", org: "Acme" }] });
  const before = sent.length;
  assert.equal((await admin.post(`/api/admin/events/${ev.id}/invites/send`)).body.sent, 1);
  const mail = sent[before];
  assert.equal(mail.to, "invitee@test.com");
  assert.match(mail.subject, /Prefill Night/);
  assert.equal((await admin.post(`/api/admin/events/${ev.id}/invites/send`)).body.sent, 0, "두 번 보내지 않음");
  const c = client();
  const token = new URL(mail.link).searchParams.get("token");
  assert.equal((await c.post("/api/auth/verify", { token, consent: CONSENT })).status, 200);
  const me = (await c.get("/api/me")).body;
  assert.deepEqual([me.name, me.role, me.org], ["Invi Tee", "PM", "Acme"]);
  assert.equal((await admin.get(`/api/admin/events/${ev.id}/attendees`)).body.joined, 1);
});

test("행사 테마: 형식 검사, 보드·체크인에 포함", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "Themed");
  assert.equal((await admin.put(`/api/admin/events/${ev.id}/theme`, { color: "red" })).status, 400);
  assert.equal((await admin.put(`/api/admin/events/${ev.id}/theme`, { logoUrl: "http://x.com/a.png" })).status, 400);
  assert.equal((await admin.put(`/api/admin/events/${ev.id}/theme`, { color: "#FF5A1F", logoUrl: "https://cdn.example.com/logo.png", welcome: "Welcome!" })).status, 200);
  const u = await newUser("themed@test.com");
  const ci = await u.c.post("/api/events/checkin", { code: ev.checkinCode });
  assert.deepEqual(ci.body.theme, { logoUrl: "https://cdn.example.com/logo.png", color: "#FF5A1F", welcome: "Welcome!" });
  assert.equal((await u.c.get(`/api/events/${ev.id}/board`)).body.event.theme.color, "#FF5A1F");
});

test("행사용 키링: 처음 태그한 사람이 로그인 → 등록 + 체크인 한 번에", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "Tap Night");
  const issued = (await admin.post("/api/admin/tags", { kind: "static", count: 1, label: "Tap Night", eventId: ev.id })).body.tags[0];
  const path = new URL(issued.url).pathname;

  const guest = client();
  const scan = await guest.get(path);
  assert.equal(scan.headers.get("location"), "/claim");
  const info = await guest.get("/api/claim");
  assert.deepEqual([info.status, info.body.eventName, info.body.checkinAvailable], [200, "Tap Night", true]);
  assert.equal((await client().get("/api/claim")).status, 410, "태그하지 않은 사람에겐 정보 없음");
  assert.match((await guest.get("/claim")).body, /로그인하면 이 키링이 내 명함과 연결돼요/);
  const v = await login(guest, "tapper@test.com");
  assert.equal(v.redirect, "/claim");
  const claim = await guest.post("/api/me/tags/claim-tap");
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.deepEqual([claim.body.eventId, claim.body.checkedIn], [ev.id, true]);
  assert.equal((await guest.get(`/api/events/${ev.id}/board`)).status, 200, "체크인 됨");
  assert.equal((await guest.post("/api/me/tags/claim-tap")).body.error, "claim_expired", "한 번만");

  // 이제 이 키링은 tapper의 것: 다른 사람이 태그하면 tapper 명함이 열린다
  const other = await newUser("other-tapper@test.com");
  const s2 = await other.c.get(path);
  assert.equal(s2.headers.get("location"), `/u/${v.userId}?new=1`);
  // 쿠키 없이 남의 키링을 가로챌 수 없음
  assert.equal((await other.c.post("/api/me/tags/claim-tap")).status, 410);
});

test("체크인 데스크: 운영진 휴대폰으로 태그하면 도감 대신 체크인", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "Desk Night");
  const owner = await newUser("returning@test.com", { name: "Returning" });
  const path = await issueStaticTag(admin, owner.c); // 지난 행사에서 받은 키링이라고 가정
  const adminDexBefore = (await admin.get("/api/dex")).body.count;
  await admin.post(`/api/admin/events/${ev.id}/desk`, { on: true });
  const r1 = await admin.get(path);
  assert.equal(r1.status, 200);
  assert.match(r1.body, /Returning님 체크인 완료/);
  assert.match((await admin.get(path)).body, /이미 체크인했어요/);
  assert.equal((await admin.get("/api/dex")).body.count, adminDexBefore, "운영진 도감에는 안 들어감");
  assert.equal((await owner.c.get(`/api/events/${ev.id}/board`)).status, 200);
  await admin.post(`/api/admin/events/${ev.id}/desk`, { on: false });
  assert.equal((await admin.get(path)).status, 302, "데스크 모드를 끄면 일반 태그");
  // 운영진이 아닌 사람이 데스크 쿠키를 흉내 내도 일반 태그로 처리
  const faker = await newUser("faker@test.com");
  faker.c.jar.mc_desk = ev.id;
  assert.equal((await faker.c.get(path)).status, 302);
});

test("행사 리캡과 리캡 메일, 도감 행사별 묶기, vCard 내보내기", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "Recap Conf");
  const me = await newUser("recap-me@test.com", { name: "Me" });
  const p1 = await newUser("recap-p1@test.com", { name: "Pat; One", role: "CTO", org: "Rocket, Inc", oneLiner: "Line1" });
  const p2 = await newUser("recap-p2@test.com", { name: "Private Two", visibility: "private" });
  await p1.c.put("/api/me/links", { links: [{ label: "LinkedIn", url: "https://linkedin.com/in/pat" }] });
  await p1.c.put("/api/me/quiz", { quiz: [{ question: "q", options: ["a", "b", "c", "d"], answer: 0 }] });
  for (const u of [me, p1, p2]) await u.c.post("/api/events/checkin", { code: ev.checkinCode, showOnLeaderboard: u === me });
  await me.c.get(await issueStaticTag(admin, p1.c));
  await me.c.get(await issueStaticTag(admin, p2.c));
  await p1.c.get(await issueStaticTag(admin, me.c));
  await me.c.put(`/api/users/${p1.id}/note`, { body: "Talked about rockets" });

  const recap = (await me.c.get(`/api/events/${ev.id}/recap`)).body;
  assert.deepEqual([recap.final, recap.metCount, recap.metMeCount, recap.leaderboardRank, recap.quizzesToPlay], [false, 2, 1, 1, 1]);
  assert.equal(recap.people.find((p) => p.id === p2.id).limited, true);
  assert.equal((await admin.get(`/api/events/${ev.id}/recap`)).status, 403, "체크인 안 한 사람");

  const grouped = (await me.c.get("/api/dex?groupBy=event")).body;
  assert.equal(grouped.groups[0].event.name, "Recap Conf");
  assert.equal(grouped.groups[0].people.length, 2);

  const one = await me.c.get(`/api/users/${p1.id}/vcard`, { raw: true });
  assert.match(one.headers.get("content-type"), /text\/vcard/);
  const v = await one.text();
  assert.ok(v.includes("FN:Pat\\; One"), v);
  assert.ok(v.includes("ORG:Rocket\\, Inc"), v);
  assert.match(v, /TITLE:CTO/);
  assert.match(v, /URL;TYPE=LinkedIn:https:\/\/linkedin.com\/in\/pat/);
  assert.match(v, /Met at Recap Conf/);
  assert.match(v, /My note: Talked about rockets/);
  assert.ok(!/@test\.com/.test(v), "이메일은 넣지 않음");
  assert.equal((await me.c.get(`/api/users/${p2.id}/vcard`)).status, 404, "비공개 명함은 내보낼 수 없음");
  const all = await (await me.c.get(`/api/dex/vcard?eventId=${ev.id}`, { raw: true })).text();
  assert.equal((all.match(/BEGIN:VCARD/g) || []).length, 1, "비공개 명함 제외");

  // 리캡 메일: 끝나기 전엔 못 보냄, 끝난 뒤 한 번만
  assert.equal((await admin.post(`/api/admin/events/${ev.id}/recap/send`)).status, 409);
  db.prepare("UPDATE events SET ends_at = ? WHERE id = ?").run(Date.now() - 1000, ev.id);
  const before = sent.length;
  assert.equal((await admin.post(`/api/admin/events/${ev.id}/recap/send`)).body.sent, 3);
  assert.ok(sent.slice(before).some((m) => m.to === "recap-me@test.com" && /2명을 만났어요/.test(m.subject)));
  assert.equal((await admin.post(`/api/admin/events/${ev.id}/recap/send`)).body.error, "already_sent");
  assert.equal((await me.c.get(`/api/events/${ev.id}/recap`)).body.final, true);
});

test("가입하지 않은 참가자 명단은 행사 종료 30일 뒤 삭제", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "Purge");
  await admin.post(`/api/admin/events/${ev.id}/attendees/import`, { attendees: [{ email: "ghost@test.com" }, { email: "recap-me@test.com" }] });
  const n = () => db.prepare("SELECT COUNT(*) AS n FROM event_invites WHERE event_id = ?").get(ev.id).n;
  const endsAt = db.prepare("SELECT ends_at FROM events WHERE id = ?").get(ev.id).ends_at;
  purgeExpired(db, endsAt + RETENTION.unclaimedInvites - 60_000);
  assert.equal(n(), 2);
  purgeExpired(db, endsAt + RETENTION.unclaimedInvites + 60_000);
  assert.equal(n(), 1, "가입한 사람(recap-me)의 명단만 남음");
});

// ---------- 화면을 위해 추가한 서버 기능 ----------
async function putImage(c, buf, type = "image/jpeg") {
  const res = await fetch(base + "/api/me/photo", {
    method: "PUT",
    headers: { "content-type": type, cookie: Object.entries(c.jar).map(([k, v]) => `${k}=${v}`).join("; ") },
    body: buf,
  });
  return { status: res.status, body: await res.json() };
}

test("프로필 사진: 재인코딩·메타데이터 제거, 교체 시 옛 파일 삭제, 공개 범위 적용", async () => {
  const alice = await newUser("photo-a@test.com", { name: "PhotoA" });
  const stranger = await newUser("photo-s@test.com");
  // 위치 정보가 든 것처럼 EXIF를 넣은 큰 JPEG
  const jpeg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#3366cc" } })
    .withMetadata({ exif: { IFD0: { Copyright: "SECRET-GPS-37.5665,126.9780" } } })
    .jpeg()
    .toBuffer();
  assert.ok(jpeg.includes("SECRET-GPS"));
  const up = await putImage(alice.c, jpeg);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const file = path.join(mediaDir, up.body.photoUrl.split("/").pop());
  const stored = fs.readFileSync(file);
  assert.ok(!stored.includes("SECRET-GPS"), "메타데이터 제거");
  const meta = await sharp(stored).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.exif], ["webp", 512, 512, undefined]);
  const served = await fetch(base + up.body.photoUrl);
  assert.equal(served.status, 200);
  assert.match(served.headers.get("cache-control"), /immutable/);

  // 만난 적 없는 사람에게는 사진 주소가 안 보임 (기본 공개 범위: 만난 사람만)
  assert.equal((await stranger.c.get(`/api/users/${alice.id}`)).body.photoUrl, undefined);
  assert.equal((await alice.c.get("/api/me")).body.photoUrl, up.body.photoUrl);

  // 이미지가 아니면 거부
  assert.equal((await putImage(alice.c, Buffer.from("not an image"), "image/png")).body.error, "invalid_image");
  assert.equal((await putImage(alice.c, Buffer.from("x"), "text/plain")).status, 415);

  // 교체하면 옛 파일 삭제, 삭제하면 파일도 삭제
  const png = await sharp({ create: { width: 300, height: 300, channels: 4, background: "#ff0000" } }).png().toBuffer();
  const up2 = await putImage(alice.c, png, "image/png");
  assert.equal(fs.existsSync(file), false);
  const file2 = path.join(mediaDir, up2.body.photoUrl.split("/").pop());
  await alice.c.del("/api/me/photo");
  assert.equal(fs.existsSync(file2), false);
  assert.equal((await alice.c.get("/api/me")).body.photoUrl, null);
  assert.equal((await fetch(base + "/media/../package.json")).status, 404);
});

test("탈퇴하면 사진 파일도 삭제", async () => {
  const u = await newUser("photo-del@test.com");
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#00ff00" } }).png().toBuffer();
  const up = await putImage(u.c, png, "image/png");
  const file = path.join(mediaDir, up.body.photoUrl.split("/").pop());
  assert.ok(fs.existsSync(file));
  await u.c.del("/api/me");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(file), false);
});

test("행사 목록(운영진), 내 행사 목록(만남 없어도 포함)", async () => {
  const admin = await adminClient();
  const live = await liveEvent(admin, "List Live");
  const past = (await admin.post("/api/admin/events", { name: "List Past", startsAt: Date.now() - 7200_000, endsAt: Date.now() - 3600_000 })).body;
  const u = await newUser("lists@test.com");
  await u.c.post("/api/events/checkin", { code: live.checkinCode });
  const all = (await admin.get("/api/admin/events")).body.events;
  const l = all.find((e) => e.id === live.id);
  assert.deepEqual([l.status, l.checkedIn, l.encounters], ["live", 1, 0]);
  assert.equal(all.find((e) => e.id === past.id).status, "ended");
  const endedOnly = (await admin.get("/api/admin/events?status=ended")).body.events;
  assert.ok(endedOnly.every((e) => e.status === "ended") && endedOnly.some((e) => e.id === past.id));
  assert.equal((await u.c.get("/api/admin/events")).status, 403);

  const mine = (await u.c.get("/api/me/events")).body.events;
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].name, mine[0].status, mine[0].metCount], ["List Live", "live", 0]);
});

test("키링 발급 결과를 CSV로 받기 (칩 URL + 등록 코드)", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "CSV Tags");
  const res = await admin.post("/api/admin/tags", { kind: "static", count: 3, label: 'Batch "A", 2026', eventId: ev.id, format: "csv" }, { raw: true });
  assert.equal(res.status, 201);
  assert.match(res.headers.get("content-type"), /text\/csv/);
  assert.match(res.headers.get("content-disposition"), /attachment/);
  const lines = (await res.text()).replace(/^\ufeff/, "").trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "tag_id,kind,uid,url,claim_code,event_id,label");
  assert.ok(lines[1].endsWith(`,${ev.id},"Batch ""A"", 2026"`), lines[1]);
  const claim = lines[1].split(",")[4];
  const u = await newUser("csvtag@test.com");
  assert.equal((await u.c.post("/api/me/tags/claim", { claimCode: claim })).status, 200, "CSV의 등록 코드가 실제로 동작");
});

test("리캡 공유 이미지: PNG 1080×1350, 참가자만", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "이미지 테스트 밋업");
  await admin.put(`/api/admin/events/${ev.id}/theme`, { color: "#FFD23F" });
  const u = await newUser("img@test.com");
  const other = await newUser("img2@test.com");
  for (const x of [u, other]) await x.c.post("/api/events/checkin", { code: ev.checkinCode });
  await u.c.get(await issueStaticTag(admin, other.c));
  for (const lang of ["ko", "en"]) {
    const res = await u.c.get(`/api/events/${ev.id}/recap/image?lang=${lang}`, { raw: true });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["png", 1080, 1350]);
    if (lang === "ko") fs.writeFileSync(path.join(mediaDir, "recap-sample.png"), buf);
  }
  assert.equal((await admin.get(`/api/events/${ev.id}/recap/image`)).status, 403);
});

test("행사장 대형 화면: 로그인 없이 통계·리더보드만, 개인 알림은 안 나감", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "Big Screen");
  const d = (await admin.post(`/api/admin/events/${ev.id}/display`)).body;
  const a = await newUser("wall-a@test.com", { name: "WallA" });
  const b = await newUser("wall-b@test.com", { name: "WallB" });
  await a.c.post("/api/events/checkin", { code: ev.checkinCode, showOnLeaderboard: true });
  await b.c.post("/api/events/checkin", { code: ev.checkinCode });

  const snap = await fetch(base + d.api).then((r) => r.json());
  assert.deepEqual([snap.event.name, snap.checkedIn, snap.encounters], ["Big Screen", 2, 0]);
  const wall = await stream(client(), `${d.api}/stream`); // 쿠키 없는 손님
  try {
    assert.equal(wall.status, 200);
    await wall.wait("ready");
    await a.c.get(await issueStaticTag(admin, b.c));
    assert.deepEqual((await wall.wait("activity")).who, { id: a.id, name: "WallA" });
    assert.equal((await wall.wait("leaderboard")).leaders[0].met, 1);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!wall.got.some((e) => ["found", "tagged"].includes(e.type)), "개인 알림은 대형 화면에 안 나감");
  } finally {
    wall.close();
  }
  // 링크를 다시 만들면 이전 링크는 막힘
  const d2 = (await admin.post(`/api/admin/events/${ev.id}/display`)).body;
  assert.equal((await fetch(base + d.api)).status, 404);
  assert.equal((await fetch(base + d2.api)).status, 200);
  // 행사 끝나고 하루 지나면 막힘
  db.prepare("UPDATE events SET ends_at = ? WHERE id = ?").run(Date.now() - 25 * 3600_000, ev.id);
  assert.equal((await fetch(base + d2.api)).status, 410);
});

test("운영진 콘솔용: isAdmin 표시, 행사 목록의 테마, 체크인 코드 다시 만들기", async () => {
  const admin = await adminClient();
  assert.equal((await admin.get("/api/me")).body.isAdmin, true);
  const u = await newUser("console-user@test.com");
  assert.equal((await u.c.get("/api/me")).body.isAdmin, false);
  const ev = await liveEvent(admin, "Console Event");
  await admin.put(`/api/admin/events/${ev.id}/theme`, { color: "#E11D6C" });
  const item = (await admin.get("/api/admin/events")).body.events.find((e) => e.id === ev.id);
  assert.equal(item.theme.color, "#E11D6C");
  const re = await admin.post(`/api/admin/events/${ev.id}/checkin-code`);
  assert.equal(re.status, 201);
  assert.match(re.body.url, /\/board\?code=/);
  assert.equal((await u.c.post("/api/events/checkin", { code: ev.checkinCode })).status, 400, "이전 코드는 막힘");
  assert.equal((await u.c.post("/api/events/checkin", { code: re.body.checkinCode })).status, 200);
  assert.equal((await u.c.post(`/api/admin/events/${ev.id}/checkin-code`)).status, 403);
});

test("쪽지함: 받은·보낸 쪽지, 안 읽은 수, 열면 그 쪽지만 읽음, 실시간 알림, 차단", async () => {
  const admin = await adminClient();
  const ev = await liveEvent(admin, "Note Night");
  const a = await newUser("note-a@test.com", { name: "NoteA" });
  const b = await newUser("note-b@test.com", { name: "NoteB" });
  const stranger = await newUser("note-x@test.com", { name: "Stranger" });
  for (const u of [a, b]) await u.c.post("/api/events/checkin", { code: ev.checkinCode });
  await a.c.get(await issueStaticTag(admin, b.c)); // A가 B를 태그 → 서로 쪽지 가능

  // B가 행사 피드를 열어 두면 새 쪽지가 실시간으로 알려진다
  const sb = await stream(b.c, `/api/events/${ev.id}/stream`);
  try {
    await sb.wait("ready");
    const sent = await a.c.post(`/api/users/${b.id}/messages`, { body: "오늘 반가웠어요!" });
    assert.deepEqual([sent.status, sent.body.message.body], [201, "오늘 반가웠어요!"]);
    const live = await sb.wait("message");
    assert.deepEqual([live.from.name, live.preview], ["NoteA", "오늘 반가웠어요!"]);
  } finally {
    sb.close();
  }
  await a.c.post(`/api/users/${b.id}/messages`, { body: "다음 주에 커피 어때요?" });

  assert.equal((await b.c.get("/api/me/unread")).body.messages, 2);
  const inbox = (await b.c.get("/api/me/notes")).body.notes;
  assert.deepEqual(inbox.map((n) => [n.body, n.read, n.from.name]), [["다음 주에 커피 어때요?", false, "NoteA"], ["오늘 반가웠어요!", false, "NoteA"]]);
  assert.equal((await b.c.get("/api/me/unread")).body.messages, 2, "목록을 봐도 읽음 처리 안 됨");

  // 한 통을 열면 그 쪽지만 읽음
  assert.equal((await b.c.post(`/api/me/notes/${inbox[0].id}/read`)).status, 200);
  assert.equal((await b.c.get("/api/me/unread")).body.messages, 1);
  assert.equal((await a.c.post(`/api/me/notes/${inbox[1].id}/read`)).status, 404, "남의 쪽지는 읽음 처리 불가");

  // 보낸 쪽지함: 받는 사람이 읽었는지는 보여 주지 않음
  const sentBox = (await a.c.get("/api/me/notes?box=sent")).body.notes;
  assert.deepEqual([sentBox.length, sentBox[0].to.name, sentBox[0].read], [2, "NoteB", undefined]);

  // 답장도 그냥 쪽지 한 통
  await b.c.post(`/api/users/${a.id}/messages`, { body: "좋아요 ☕" });
  assert.equal((await a.c.get("/api/me/notes")).body.notes[0].body, "좋아요 ☕");

  // 만나지 않은 사람에겐 못 보냄, 차단하면 받은 쪽지함과 배지에서 빠짐
  assert.equal((await stranger.c.post(`/api/users/${a.id}/messages`, { body: "?" })).status, 403);
  await b.c.post(`/api/users/${a.id}/block`);
  assert.equal((await b.c.get("/api/me/notes")).body.notes.length, 0);
  assert.equal((await b.c.get("/api/me/unread")).body.messages, 0);
});
