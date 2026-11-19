// A3 행사용 키링 등록. 처음 받은 키링을 태그하면 서버가 이 화면으로 보낸다.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { get, post } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { Button, Chip, ErrorState, Screen, Spinner, TopBar, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

function KeyringArt() {
  return (
    <div className="soft-card" style={{ height: 280, position: "relative", overflow: "hidden", borderRadius: 24, padding: 0 }} aria-hidden="true">
      {[150, 110, 72].map((r, i) => (
        <span key={r} style={{ position: "absolute", left: "50%", top: "50%", width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r, borderRadius: "50%", border: "2px solid var(--brand-soft)", opacity: [0.35, 0.55, 0.9][i] }} />
      ))}
      <div className="grain" style={{ position: "absolute", left: "calc(50% - 60px)", top: 70, width: 118, height: 150, borderRadius: 36, transform: "rotate(8deg)", background: "linear-gradient(160deg, var(--neon-pink), var(--brand-soft))", boxShadow: "0 18px 36px -6px rgba(236,43,122,.4)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 44 }}>
        <span style={{ position: "absolute", top: 14, left: 48, width: 22, height: 22, borderRadius: "50%", background: "var(--bg-base)" }} />M
      </div>
      <div style={{ position: "absolute", right: 20, bottom: -30, width: 96, height: 180, borderRadius: 20, background: "var(--text-primary)", transform: "rotate(-14deg)", padding: 6 }}>
        <div style={{ height: "100%", borderRadius: 15, background: "var(--bg-surface)", display: "grid", placeItems: "center", color: "var(--brand)" }}>
          <Icon name="nfc" size={36} />
        </div>
      </div>
    </div>
  );
}

export default function Claim() {
  const { me, loading } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get("/api/claim").then(setInfo).catch(setError);
  }, []);

  async function claim() {
    if (!me) return nav("/login?next=/claim");
    setBusy(true);
    try {
      const r = await post("/api/me/tags/claim-tap");
      const dest = r.eventId && r.checkedIn ? `/events/${r.eventId}` : "/me";
      toast(r.checkedIn ? "키링을 등록하고 체크인했어요" : "키링을 내 명함에 연결했어요");
      // 명함이 비어 있으면 먼저 채우기
      nav(me.name ? dest : `/onboarding?next=${encodeURIComponent(dest)}`, { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (error)
    return (
      <Screen>
        <TopBar type="close" onBack={() => nav("/")} />
        <ErrorState title="등록할 키링이 없어요" message={error.message || "키링을 다시 태그해 주세요. 이미 다른 사람이 등록했을 수도 있어요."} />
      </Screen>
    );
  if (!info || loading)
    return (
      <Screen>
        <Spinner />
      </Screen>
    );

  return (
    <Screen>
      <TopBar type="close" onBack={() => nav("/")} />
      <div className="content tight">
        {info.eventName && <Chip>{info.eventName}</Chip>}
        <div className="heading">
          <h1 className="t-title1">{"오늘 받은 키링을\n내 명함으로 만들어 볼까요?"}</h1>
          <p className="t-body2 c-secondary">등록해 두면 누구든 이 키링에 휴대폰을 대는 순간 내 명함이 열려요.</p>
        </div>
        <KeyringArt />
      </div>
      <div className="bottom-cta">
        {info.eventName && info.checkinAvailable && <p className="t-caption c-tertiary center">등록하면 {info.eventName}에 바로 체크인돼요</p>}
        <Button disabled={busy} onClick={claim}>
          {me ? "내 키링으로 등록하기" : "이메일로 시작하기"}
        </Button>
      </div>
    </Screen>
  );
}
