// SQLite (Node 내장 node:sqlite). 운영에서 Postgres로 옮길 때도 테이블 구조는 그대로 쓸 수 있게 표준 SQL만 사용.
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE,                 -- 탈퇴 시 NULL
  name         TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT '',
  org          TEXT NOT NULL DEFAULT '',
  one_liner    TEXT NOT NULL DEFAULT '',
  hint         TEXT NOT NULL DEFAULT '',    -- 이벤트 보드에서 가려진 카드에 보일 힌트 (본인이 직접 입력)
  visibility   TEXT NOT NULL DEFAULT 'encountered' CHECK (visibility IN ('public','encountered','private')),
  terms_version   TEXT,                     -- 동의한 약관·처리방침 버전
  consented_at    INTEGER,                  -- 만 14세 이상 확인 + 약관·처리방침 동의 시각
  suspended_until INTEGER,                  -- 이용 정지 종료 시각 (영구 정지는 아주 큰 값)
  suspend_reason  TEXT,
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

-- 접속 기록: 통신비밀보호법에 따라 3개월 보관 후 자동 삭제. 탈퇴해도 보관 기간 동안은 남는다.
CREATE TABLE IF NOT EXISTS login_events (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip       TEXT NOT NULL,
  at       INTEGER NOT NULL
);

-- 신고: 부정 이용 대응을 위해 접수 후 1년 보관
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  reporter_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL CHECK (reason IN ('harassment','spam','impersonation','inappropriate','other')),
  detail       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  note         TEXT NOT NULL DEFAULT '',     -- 운영진 처리 메모
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);

CREATE TABLE IF NOT EXISTS links (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pos      INTEGER NOT NULL,
  label    TEXT NOT NULL,
  url      TEXT NOT NULL,
  PRIMARY KEY (user_id, pos)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pos       INTEGER NOT NULL,
  question  TEXT NOT NULL,
  options   TEXT NOT NULL,                  -- JSON 배열 4개
  answer    INTEGER NOT NULL CHECK (answer BETWEEN 0 AND 3),
  PRIMARY KEY (user_id, pos)
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

-- 키링 NFC 태그. kind = 'sun'(NTAG 424 DNA, 위조 방지) | 'static'(NTAG215 등, 고정 링크)
CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('sun','static')),
  uid         TEXT UNIQUE,                  -- sun 칩 UID (hex)
  code_hash   TEXT UNIQUE,                  -- static 링크 코드 해시
  claim_hash  TEXT NOT NULL UNIQUE,         -- 포장에 인쇄된 등록 코드 해시
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','lost')),
  last_ctr    INTEGER NOT NULL DEFAULT -1,
  label       TEXT NOT NULL DEFAULT '',     -- 예: 고객사/배치 이름
  created_at  INTEGER NOT NULL
);

-- 로그인 전에 태그한 경우, 로그인 후 도감에 넣기 위해 잠깐 보관
CREATE TABLE IF NOT EXISTS pending_scans (
  token_hash  TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified    INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- 도감: scanner가 owner의 키링을 태그함
CREATE TABLE IF NOT EXISTS encounters (
  scanner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_at     INTEGER NOT NULL,
  last_at      INTEGER NOT NULL,
  scans        INTEGER NOT NULL DEFAULT 1,
  verified     INTEGER NOT NULL DEFAULT 0,  -- SUN 서명으로 확인된 실제 태그였는지
  event_id     TEXT REFERENCES events(id) ON DELETE SET NULL,
  best_score   INTEGER,
  PRIMARY KEY (scanner_id, owner_id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id           TEXT PRIMARY KEY,
  scanner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  questions    TEXT NOT NULL,               -- 시작 시점의 문제 스냅샷(JSON, 정답 포함, 서버에만 보관)
  idx          INTEGER NOT NULL DEFAULT 0,
  issued_at    INTEGER NOT NULL,            -- 현재 문제를 보낸 시각
  score        INTEGER NOT NULL DEFAULT 0,
  correct      INTEGER NOT NULL DEFAULT 0,
  finished_at  INTEGER
);

CREATE TABLE IF NOT EXISTS notes (
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  about_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (author_id, about_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  from_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  client        TEXT NOT NULL DEFAULT '',   -- 기업 클라이언트
  starts_at     INTEGER NOT NULL,
  ends_at       INTEGER NOT NULL,
  checkin_hash  TEXT NOT NULL UNIQUE,       -- 입구 체크인 코드 해시
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_attendees (
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_in_at     INTEGER NOT NULL,
  show_leaderboard  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_enc_owner ON encounters(owner_id);
CREATE INDEX IF NOT EXISTS idx_msg_to ON messages(to_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_at ON login_events(at);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at);
`;

export function openDb(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** 여러 쿼리를 한 트랜잭션으로 */
export function tx(db, fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const RETENTION = {
  loginEvents: 90 * 86400_000, // 3개월
  reports: 365 * 86400_000, // 1년
};

/** 보관 기간이 지난 데이터 삭제. 서버가 1시간마다 실행한다. */
export function purgeExpired(db, now = Date.now()) {
  db.prepare("DELETE FROM login_tokens WHERE expires_at < ?").run(now - 86400_000);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM pending_scans WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM login_events WHERE at < ?").run(now - RETENTION.loginEvents);
  db.prepare("DELETE FROM reports WHERE created_at < ?").run(now - RETENTION.reports);
}
