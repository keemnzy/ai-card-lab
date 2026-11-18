// 행사 체크인 공통 처리: 입구 코드, 체크인 데스크, 행사용 키링 첫 태그가 모두 이 함수를 쓴다.
import { eventStats, leaderboard } from "./realtime.js";

export const eventTheme = (e) => ({ logoUrl: e.logo_url || null, color: e.color || null, welcome: e.welcome || null });

/**
 * userId를 행사에 체크인시킨다. 이미 체크인했으면 리더보드 동의만 갱신(값을 줬을 때).
 * @returns {{ isNew: boolean }}
 */
export function checkIn(db, bus, event, userId, { showLeaderboard, now = Date.now() } = {}) {
  const already = db.prepare("SELECT show_leaderboard FROM event_attendees WHERE event_id = ? AND user_id = ?").get(event.id, userId);
  if (already) {
    if (showLeaderboard !== undefined && !!already.show_leaderboard !== showLeaderboard) {
      db.prepare("UPDATE event_attendees SET show_leaderboard = ? WHERE event_id = ? AND user_id = ?").run(showLeaderboard ? 1 : 0, event.id, userId);
      bus.publish(event.id, "leaderboard", { leaders: leaderboard(db, event.id) });
    }
    return { isNew: false };
  }
  db.prepare("INSERT INTO event_attendees (event_id, user_id, checked_in_at, show_leaderboard) VALUES (?, ?, ?, ?)").run(
    event.id,
    userId,
    now,
    showLeaderboard ? 1 : 0,
  );
  // 명단에 있던 사람이면 연결
  db.prepare(
    "UPDATE event_invites SET user_id = ? WHERE event_id = ? AND user_id IS NULL AND email = (SELECT email FROM users WHERE id = ?)",
  ).run(userId, event.id, userId);
  const stats = eventStats(db, event.id);
  bus.publish(event.id, "checkin", { checkedIn: stats.checkedIn }, { except: userId });
  bus.publish(event.id, "stats", stats);
  if (showLeaderboard) bus.publish(event.id, "leaderboard", { leaders: leaderboard(db, event.id) });
  return { isNew: true };
}
