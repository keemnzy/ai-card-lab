#!/usr/bin/env node
// Meetcha 데모: `npm run demo` 한 줄로 설치 → 화면 빌드 → 예시 데이터 → 서버 시작 → 휴대폰용 주소·QR·로그인 링크 출력.
//   --local      휴대폰 없이 이 컴퓨터에서만 (주소: localhost)
//   --keep       지난 데모 데이터 유지 (기본은 매번 새로)
//   --port 3000  포트 지정 (사용 중이면 다음 빈 포트)
//   --admin 메일  운영진 이메일 (기본 admin@meetcha.demo)
// 실제 운영 데이터(meetcha.db)와 섞이지 않게 demo.db / uploads-demo 를 따로 쓴다.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // meetcha/
const WEB = path.join(ROOT, "web");
const SERVER = path.join(ROOT, "server");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, pink: (s) => `\x1b[38;2;236;43;122m${s}\x1b[0m`, lime: (s) => `\x1b[38;2;206;255;50m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m` };
const step = (s) => console.log(`${c.pink("●")} ${s}`);
const fail = (s) => {
  console.error(`\n${c.red("✕")} ${s}\n`);
  process.exit(1);
};

// 1. Node 버전 (node:sqlite 필요)
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 13)) fail(`Node.js 22.13 이상이 필요해요. 지금은 ${process.version}예요. https://nodejs.org 에서 최신 LTS를 설치해 주세요.`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(cmd, cmdArgs, cwd, label) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) fail(`${label}에 실패했어요. 위 메시지를 확인해 주세요.`);
}

// 2. 패키지 설치 (처음 한 번)
for (const [dir, name] of [[SERVER, "서버"], [WEB, "화면"]]) {
  if (!fs.existsSync(path.join(dir, "node_modules"))) {
    step(`${name} 패키지 설치 중… (처음 한 번만)`);
    run(npm, ["install", "--no-audit", "--no-fund"], dir, `${name} 패키지 설치`);
  }
}

// 3. 화면 빌드 (항상 최신 코드로)
step("화면 빌드 중…");
run(npm, ["run", "build", "--silent", "--", "--logLevel", "warn"], WEB, "화면 빌드");

// 4. 주소 정하기: 같은 와이파이의 휴대폰이 접속할 IP
function lanIp() {
  const nets = os.networkInterfaces();
  const prefer = ["en0", "en1", "wlan0", "eth0", "Wi-Fi", "Ethernet"];
  const all = Object.entries(nets).flatMap(([name, list]) => (list || []).filter((n) => n.family === "IPv4" && !n.internal).map((n) => ({ name, address: n.address })));
  all.sort((a, b) => (prefer.indexOf(a.name) + 1 || 99) - (prefer.indexOf(b.name) + 1 || 99));
  return all.find((n) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(n.address))?.address || all[0]?.address;
}
const freePort = (p) =>
  new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(freePort(p + 1))).once("listening", () => s.close(() => resolve(p))).listen(p);
  });
const port = await freePort(Number(opt("port", 3000)));
const ip = flag("local") ? null : lanIp();
const origin = `http://${ip || "localhost"}:${port}`;
const admin = opt("admin", "admin@meetcha.demo").toLowerCase();

// 5. 데모 데이터 (매번 새로)
const DB = path.join(SERVER, "demo.db");
const UPLOADS = path.join(SERVER, "uploads-demo");
if (!flag("keep")) {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  fs.rmSync(UPLOADS, { recursive: true, force: true });
}
const env = { ...process.env, DB_PATH: DB, UPLOAD_DIR: UPLOADS, APP_ORIGIN: origin, PORT: String(port), ADMIN_EMAILS: admin, NODE_ENV: "development" };
step("예시 데이터 만드는 중…");
const seed = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "src/seed.js"], { cwd: SERVER, env, encoding: "utf8" });
if (seed.status !== 0) fail(`예시 데이터를 만들지 못했어요.\n${seed.stderr}`);
const tags = [...seed.stdout.matchAll(/^\s+(\S+)\s+(http\S+)/gm)].map((m) => ({ name: m[1], url: m[2] }));
const checkinCode = /체크인 코드: (\S+)/.exec(seed.stdout)?.[1];

// 6. 메일 없이 바로 쓰는 로그인 링크 (데모 DB에만, 24시간, 한 번씩)
const { openDb } = await import(path.join(SERVER, "src/db.js"));
const db = openDb(DB);
function loginLink(email) {
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)").run(hash, email, Date.now() + 86400_000);
  return `${origin}/auth/verify?token=${token}`;
}
const adminLink = loginLink(admin);
const userLink = loginLink("me@meetcha.demo");
db.close();

// 7. 서버 시작
step("서버 시작 중…");
const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], { cwd: SERVER, env, stdio: ["ignore", "pipe", "pipe"] });
let ready = false;
server.stderr.on("data", (d) => process.stderr.write(d));
server.on("exit", (code) => {
  if (!ready) fail(`서버가 시작되지 못했어요 (코드 ${code}).`);
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));

async function qr(text) {
  try {
    const QRCode = createRequire(path.join(WEB, "package.json"))("qrcode");
    // 흰 바탕을 함께 그려서 어두운 터미널에서도 카메라가 읽을 수 있다
    return await QRCode.toString(text, { type: "terminal", small: true, errorCorrectionLevel: "L" });
  } catch {
    return "";
  }
}
const qrText = ip ? await qr(origin) : "";
process.on("exit", () => server.kill()); // 데모가 끝나면 서버도 함께 끈다

server.stdout.on("data", (d) => {
  const text = d.toString();
  if (!ready && text.includes("Meetcha 서버")) {
    ready = true;
    const line = c.dim("─".repeat(64));
    console.log(`\n${line}\n${c.b(c.pink("  Meetcha 데모가 켜졌어요"))}  ${c.dim("(끄려면 Ctrl+C)")}\n${line}`);
    console.log(`\n  ${c.b("참가자 화면")}   ${origin}`);
    console.log(`  ${c.b("운영진 콘솔")}   ${origin}/admin`);
    console.log(`\n  ${c.b("① 운영진으로 로그인")} ${c.dim(`(${admin}, 메일 없이 바로)`)}\n  ${adminLink}`);
    console.log(`\n  ${c.b("② 참가자로 로그인")} ${c.dim("(휴대폰에서 열어 보세요, 한 번씩 쓸 수 있어요)")}\n  ${userLink}`);
    console.log(`\n  ${c.b("③ 키링 태그 흉내")} ${c.dim("(열면 그 사람 키링을 태그한 것과 같아요)")}`);
    for (const t of tags) console.log(`  ${t.name.padEnd(4)} ${t.url}`);
    if (checkinCode) console.log(`\n  ${c.b("④ 행사 체크인 코드")}  ${c.lime(checkinCode)}  ${c.dim("(보드 화면에서 입력)")}`);
    if (ip) {
      console.log(`\n  ${c.b("휴대폰으로 열기")} ${c.dim("— 같은 와이파이에서 카메라로 찍으세요")}`);
      if (qrText) console.log(qrText.replace(/^/gm, "  "));
      console.log(c.dim("  안 열리면: 휴대폰이 같은 와이파이인지, Mac이 '들어오는 연결 허용'을 물으면 허용했는지 확인해 주세요."));
      console.log(c.dim("  이 컴퓨터에서도 localhost 대신 위 주소로 열어야 로그인이 돼요."));
    }
    console.log(`\n  ${c.dim("메일로 보내는 로그인 링크(새로 요청한 것)는 아래 서버 로그에 [메일]로 찍혀요.")}\n${line}\n`);
    return;
  }
  process.stdout.write(text);
});
