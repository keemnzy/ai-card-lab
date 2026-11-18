// 도감(만남) 기록과 "만난 사이인지" 확인.
import { tx } from "./db.js";

/** scanner가 owner를 태그했음을 기록. 두 사람이 진행 중인 같은 이벤트에 체크인해 있으면 그 이벤트로 묶는다. */
export function recordEncounter(db, scannerId, ownerId, verified, now = Date.now()) {
  if (scannerId === ownerId) return null;
  const ev = db
    .prepare(
      `SELECT e.id FROM events e
       JOIN event_attendees a ON a.event_id = e.id AND a.user_id = ?
       JOIN event_attendees b ON b.event_id = e.id AND b.user_id = ?
       WHERE e.starts_at <= ? AND e.ends_at >= ? ORDER BY e.starts_at DESC LIMIT 1`,
    )
    .get(scannerId, ownerId, now, now);
  return tx(db, () => {
    const existing = db.prepare("SELECT * FROM encounters WHERE scanner_id = ? AND owner_id = ?").get(scannerId, ownerId);
    if (existing) {
      db.prepare(
        `UPDATE encounters SET last_at = ?, scans = scans + 1, verified = MAX(verified, ?),
           event_id = COALESCE(event_id, ?) WHERE scanner_id = ? AND owner_id = ?`,
      ).run(now, verified ? 1 : 0, ev?.id ?? null, scannerId, ownerId);
      return { isNew: false, eventId: ev?.id ?? null };
    }
    db.prepare(
      `INSERT INTO encounters (scanner_id, owner_id, first_at, last_at, verified, event_id) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(scannerId, ownerId, now, now, verified ? 1 : 0, ev?.id ?? null);
    return { isNew: true, eventId: ev?.id ?? null };
  });
}

/** a가 b를 태그한 적이 있는지 (도감에 있는지) */
export const hasScanned = (db, a, b) =>
  !!db.prepare("SELECT 1 FROM encounters WHERE scanner_id = ? AND owner_id = ?").get(a, b);

/** 어느 방향으로든 만난 적 있는지 */
export const haveMet = (db, a, b) =>
  !!db
    .prepare("SELECT 1 FROM encounters WHERE (scanner_id = ? AND owner_id = ?) OR (scanner_id = ? AND owner_id = ?)")
    .get(a, b, b, a);
