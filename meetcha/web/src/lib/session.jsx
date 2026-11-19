// 로그인 상태 (GET /api/me)와 안 읽은 쪽지 수. 로그인 안 했으면 me = null.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, get } from "./api.js";

const Ctx = createContext(null);
const UNREAD_POLL_MS = 30_000;

export function SessionProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null, suspended: false });
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const me = await get("/api/me");
      setState({ loading: false, me, suspended: false });
      return me;
    } catch (e) {
      const suspended = e instanceof ApiError && e.code === "account_suspended";
      setState({ loading: false, me: null, suspended });
      return null;
    }
  }, []);
  const refreshUnread = useCallback(async () => {
    try {
      setUnread((await get("/api/me/unread")).messages);
    } catch {
      /* 로그아웃 상태 등 */
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // 쪽지 배지: 로그인했을 때만, 화면이 보일 때 30초마다 + 다시 돌아왔을 때
  useEffect(() => {
    if (!state.me) return;
    refreshUnread();
    const t = setInterval(() => document.visibilityState === "visible" && refreshUnread(), UNREAD_POLL_MS);
    const onShow = () => document.visibilityState === "visible" && refreshUnread();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [state.me, refreshUnread]);
  return <Ctx.Provider value={{ ...state, refresh, unread, refreshUnread }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
