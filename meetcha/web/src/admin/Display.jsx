// 행사장 대형 화면 (빔프로젝터·TV). 로그인 없이 링크로 연다. 통계·리더보드(동의자만)·익명 활동만.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { get } from "../lib/api.js";
import Icon from "../components/Icon.jsx";
import "../styles/admin.css";

export default function Display() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ticker, setTicker] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark"; // 대형 화면은 항상 어둡게
    get(`/api/display/${token}`).then(setData).catch(setError);
    const es = new EventSource(`/api/display/${token}/stream`);
    const on = (t, fn) => es.addEventListener(t, (e) => fn(JSON.parse(e.data)));
    on("ready", (d) => setData(d));
    on("stats", (s) => setData((d) => d && { ...d, ...s }));
    on("leaderboard", (l) => setData((d) => d && { ...d, leaders: l.leaders }));
    on("activity", (a) => setTicker({ ...a, key: Date.now() }));
    on("checkin", () => setTicker({ who: null, checkin: true, key: Date.now() }));
    es.onerror = () => {
      // 링크가 만료됐거나 다시 만들어졌으면 서버가 연결을 거절한다
      get(`/api/display/${token}`).catch((e) => {
        setError(e);
        es.close();
      });
    };
    return () => es.close();
  }, [token]);

  if (error)
    return (
      <div className="wall gradient-aurora grain" style={{ placeItems: "center", gridTemplateColumns: "1fr" }}>
        <div className="stack center">
          <p className="t-title1">이 화면은 더 이상 쓸 수 없어요</p>
          <p className="t-body1" style={{ opacity: 0.7 }}>운영진 콘솔에서 대형 화면 링크를 다시 만들어 주세요.</p>
        </div>
      </div>
    );
  if (!data) return <div className="wall gradient-aurora" />;

  const { event, checkedIn, encounters, leaders = [] } = data;
  return (
    <div className="wall gradient-aurora grain">
      <div className="stack" style={{ justifyContent: "space-between", gap: "4vh" }}>
        <div className="stack" style={{ gap: "1.5vh" }}>
          <p className="row" style={{ color: "var(--accent)", fontWeight: 700, fontSize: "clamp(16px,1.4vw,24px)", gap: 8 }}>
            <Icon name="spark" size={22} /> Meetcha
          </p>
          <h1>{event.name}</h1>
          {event.theme?.welcome && <p className="lead">{event.theme.welcome}</p>}
        </div>
        <div className="row" style={{ gap: "5vw", alignItems: "flex-end" }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="big">{checkedIn}</span>
            <span className="lead">명이 체크인</span>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="big" style={{ color: "var(--accent)" }}>{encounters}</span>
            <span className="lead">번의 만남</span>
          </div>
        </div>
        <div style={{ minHeight: "4vh" }}>
          {ticker && (
            <div key={ticker.key} className="wall-ticker">
              <span className="dot" />
              {ticker.checkin
                ? "새로운 참가자가 들어왔어요"
                : ticker.who
                  ? `${ticker.who.name || "참가자"}님이 새 사람을 만났어요 · ${ticker.met}명째`
                  : "참가자 한 명이 새 사람을 만났어요"}
            </div>
          )}
        </div>
      </div>
      <div className="wall-board">
        <p className="lead" style={{ opacity: 0.9, fontWeight: 700 }}>가장 많이 만난 사람</p>
        {leaders.length === 0 && <p className="lead">리더보드에 동의한 참가자가 키링을 태그하면 여기에 나와요.</p>}
        {leaders.slice(0, 10).map((l) => (
          <div key={l.id} className="wall-row">
            <span className="rank">{l.rank}</span>
            <span>{l.name || "참가자"}</span>
            <span className="met">{l.met}명</span>
          </div>
        ))}
        <p className="t-caption" style={{ opacity: 0.5, marginTop: "auto" }}>리더보드에는 체크인할 때 동의한 사람만 나와요</p>
      </div>
    </div>
  );
}
