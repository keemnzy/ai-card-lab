// 행사 실시간 피드 (서버 GET /api/events/:id/stream, SSE). 끊기면 브라우저가 알아서 다시 연결한다.
import { useEffect, useRef } from "react";

export function useEventStream(eventId, handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!eventId || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/events/${eventId}/stream`);
    const types = ["ready", "checkin", "found", "tagged", "activity", "stats", "leaderboard", "message"];
    const listeners = types.map((t) => {
      const fn = (e) => {
        try {
          ref.current[t]?.(JSON.parse(e.data));
        } catch {
          /* 잘못된 메시지는 무시 */
        }
      };
      es.addEventListener(t, fn);
      return [t, fn];
    });
    return () => {
      listeners.forEach(([t, fn]) => es.removeEventListener(t, fn));
      es.close();
    };
  }, [eventId]);
}
