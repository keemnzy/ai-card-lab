// 첫 화면. 로그인했으면 진행 중인 행사 보드 → 도감 순으로 보내고, 아니면 짧은 소개.
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { get } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { Screen, Spinner } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

export default function Home() {
  const { me, loading, suspended } = useSession();
  const [dest, setDest] = useState(null);
  useEffect(() => {
    if (!me) return;
    get("/api/me/events")
      .then(({ events }) => {
        const live = events.find((e) => e.status === "live");
        if (live) return setDest(`/events/${live.id}`);
        const ended = events.find((e) => e.status === "ended");
        setDest(ended ? "/dex" : "/me");
      })
      .catch(() => setDest("/me"));
  }, [me]);

  if (loading || (me && !dest)) return <Screen><Spinner /></Screen>;
  if (me) return <Navigate to={dest} replace />;

  return (
    <Screen className="gradient-aurora grain" tone="dark">
      <div className="content" style={{ justifyContent: "flex-end", paddingBottom: 32, color: "#fff" }}>
        <p className="row t-body2s" style={{ color: "var(--accent)" }}>
          <Icon name="spark" size={16} /> Meetcha
        </p>
        <h1 className="t-display" style={{ whiteSpace: "pre-line" }}>{"행사가 끝나도\n서로를 기억하게"}</h1>
        <p className="t-body1" style={{ opacity: 0.8 }}>
          {suspended ? "이용이 제한된 계정이에요. 문의는 운영진에게 해 주세요." : "행사에서 받은 키링을 내 휴대폰에 대면 시작돼요."}
        </p>
      </div>
      <div className="bottom-cta">
        <Link to="/login" className="btn reward">이메일로 로그인</Link>
      </div>
    </Screen>
  );
}
