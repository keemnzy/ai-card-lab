// 공통 도우미: 에러, 입력 검증, 레이트 리밋, 세션 인증.
import { sha256 } from "./crypto.js";

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}
export const bad = (code, msg) => new HttpError(400, code, msg);
export const notFound = () => new HttpError(404, "not_found", "찾을 수 없어요");
export const forbidden = (code = "forbidden", msg = "권한이 없어요") => new HttpError(403, code, msg);

// ---------- 입력 검증 ----------
export function str(v, field, { max, min = 0, optional = false } = {}) {
  if (v === undefined || v === null) {
    if (optional) return undefined;
    v = "";
  }
  if (typeof v !== "string") throw bad("invalid_input", `${field}: 문자열이어야 해요`);
  const s = v.trim();
  if (s.length < min) throw bad("invalid_input", `${field}: ${min}자 이상 입력해 주세요`);
  if (s.length > max) throw bad("invalid_input", `${field}: ${max}자 이하로 입력해 주세요`);
  return s;
}
export function int(v, field, { min, max }) {
  if (!Number.isInteger(v) || v < min || v > max) throw bad("invalid_input", `${field}: ${min}~${max} 사이 정수여야 해요`);
  return v;
}
export function httpsUrl(v, field) {
  const s = str(v, field, { max: 300, min: 1 });
  let u;
  try {
    u = new URL(s);
  } catch {
    throw bad("invalid_url", `${field}: 올바른 주소가 아니에요`);
  }
  if (u.protocol !== "https:") throw bad("invalid_url", `${field}: https:// 로 시작하는 주소만 쓸 수 있어요`);
  return u.toString();
}
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// ---------- 레이트 리밋 (메모리, 고정 윈도) ----------
// 서버가 여러 대가 되면 Redis 등 공유 저장소로 바꿔야 한다.
// 개인정보처리방침: 요청 제한용 IP는 메모리에만, 창이 끝나면(최대 1시간) 1분 안에 지운다.
export function createLimiter() {
  const hits = new Map();
  let lastSweep = Date.now();
  return function limit(key, max, windowMs) {
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      lastSweep = now;
    }
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      h = { n: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.n++;
    if (h.n > max) throw new HttpError(429, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요");
  };
}

// ---------- 세션 ----------
export const SESSION_COOKIE = "mc_session";
export const PENDING_COOKIE = "mc_pending";

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieOptions(cfg, maxAgeMs) {
  return { httpOnly: true, sameSite: "lax", secure: cfg.secureCookies, path: "/", maxAge: maxAgeMs };
}

/** req.user를 채운다 (없으면 null). */
export function loadSession(db) {
  const q = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
  );
  return (req, _res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    const t = req.cookies[SESSION_COOKIE];
    req.user = t ? q.get(sha256(t), Date.now()) || null : null;
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "login_required", "로그인이 필요해요"));
  next();
}
