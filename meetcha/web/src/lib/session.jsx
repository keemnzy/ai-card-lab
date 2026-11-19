// 로그인 상태 (GET /api/me). 로그인 안 했으면 me = null.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, get } from "./api.js";

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null, suspended: false });
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
  useEffect(() => {
    refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ ...state, refresh }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
