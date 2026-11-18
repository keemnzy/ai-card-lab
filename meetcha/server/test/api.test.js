// 실제 HTTP로 서버를 띄워 전체 흐름을 확인한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { deriveTagKey, encodeSun } from "../src/crypto.js";
import { createLimiter } from "../src/lib.js";

const META = "00112233445566778899aabbccddeeff";
const MASTER = "ffeeddccbbaa99887766554433221100";
let server, base, db, cfg, clock;
const sent = [];

before(async () => {
  db = openDb(":memory:");
  cfg = loadConfig({ APP_ORIGIN: "http://localhost", ADMIN_EMAILS: "admin@bs.kr", SUN_META_KEY: META, SUN_MASTER_KEY: MASTER });
  clock = { t: null };
  const now = () => clock.t ?? Date.now();
  const mailer = { async send(m) { sent.push(m); } };
  server = createApp({ db, cfg, mailer, now, limit: () => {} }).listen(0); // 레이트 리밋은 아래 별도 테스트
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

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
  const v = await c.post("/api/auth/verify", { token });
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
  assert.equal((await c.post("/api/auth/verify", { token })).status, 200);
  assert.equal((await c.get("/api/me")).status, 200);
  assert.equal((await client().post("/api/auth/verify", { token })).body.error, "invalid_token");
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
  const r = await admin.post("/api/admin/tags", { kind: "static", count: 1, label: "GSCC" });
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
  const r = await admin.post("/api/admin/tags", { kind: "sun", uids: [uid], label: "GSCC" });
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
  const ev = await admin.post("/api/admin/events", { name: "GSCC 네트워킹 나이트", client: "GSCC", startsAt: Date.now() - 60_000, endsAt: Date.now() + 3600_000 });
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
  assert.ok(!JSON.stringify(board).includes("E2"), "못 만난 사람 이름은 숨김");

  const path = await issueStaticTag(admin, p2.c);
  await p1.c.get(path);
  board = (await p1.c.get(`/api/events/${ev.body.id}/board`)).body;
  assert.equal(board.found, 1);
  assert.equal(board.slots[0].user.name, "E2");

  const lb = (await p2.c.get(`/api/events/${ev.body.id}/leaderboard`)).body.leaders;
  assert.deepEqual(lb.map((l) => [l.name, l.met]), [["E1", 1], ["E2", 0]]); // E3는 동의 안 해서 빠짐

  const rep = (await admin.get(`/api/admin/events/${ev.body.id}/report`)).body;
  assert.deepEqual([rep.attendees, rep.encounters], [3, 1]);
  assert.ok(!JSON.stringify(rep).includes("E1"), "리포트에 개인 정보 없음");
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
