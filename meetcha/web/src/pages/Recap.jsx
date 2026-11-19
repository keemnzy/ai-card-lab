// E5 행사 리캡: 기념품 화면. 큰 숫자 → 만난 사람 → 아직 안 푼 퀴즈.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, get } from "../lib/api.js";
import { dateLabel, roleLine } from "../lib/format.js";
import { Avatar, Button, Chip, ErrorState, Screen, Slot, Spinner, TopBar, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

export default function Recap() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [r, setR] = useState(null);
  const [msgs, setMsgs] = useState(0);
  const [error, setError] = useState(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    get(`/api/events/${id}/recap`).then(setR).catch(setError);
    get("/api/me/messages").then((m) => setMsgs(m.messages.length)).catch(() => {});
  }, [id]);

  async function share() {
    setSharing(true);
    try {
      const res = await api(`/api/events/${id}/recap/image`, { raw: true });
      const blob = await res.blob();
      const file = new File([blob], "meetcha-recap.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: r.event.name });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "meetcha-recap.png";
        a.click();
        URL.revokeObjectURL(a.href);
        toast("이미지를 저장했어요");
      }
    } catch (e) {
      if (e?.name !== "AbortError") toast("이미지를 만들지 못했어요");
    } finally {
      setSharing(false);
    }
  }

  if (error) return <Screen tone="base"><TopBar /><ErrorState message={error.message} /></Screen>;
  if (!r) return <Screen tone="base"><Spinner /></Screen>;

  const toPlay = r.people.filter((p) => !p.limited && p.quizCount > 0 && p.bestScore == null);
  return (
    <Screen tone="base">
      <section className="hero-recap gradient-hero grain" style={{ marginTop: "calc(-1 * env(safe-area-inset-top))", paddingTop: "calc(16px + env(safe-area-inset-top))" }}>
        <div className="row between">
          <button className="icon-btn" style={{ marginLeft: -10 }} onClick={() => nav(-1)} aria-label="뒤로">
            <Icon name="back" />
          </button>
        </div>
        <div>
          <Chip tone="glass">
            {dateLabel(r.event.startsAt)} · {r.event.name}
          </Chip>
        </div>
        <h1 className="t-display">
          <span style={{ color: "var(--accent)" }}>{r.metCount}명</span>을 만났어요
        </h1>
        <p className="t-body1">{r.metMeCount}명이 내 키링을 태그했어요</p>
        <div className="row" style={{ gap: 8 }}>
          {[
            [r.leaderboardRank ? `${r.leaderboardRank}위` : "—", `${r.eventTotals.attendees}명 중`],
            [`${toPlay.length}개`, "남은 퀴즈"],
            [`${msgs}개`, "받은 쪽지"],
          ].map(([v, l]) => (
            <div key={l} className="stat">
              <span className="t-title3">{v}</span>
              <span className="t-caption" style={{ opacity: 0.85 }}>{l}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="content tight" style={{ paddingTop: 20 }}>
        <div className="section-head">
          <h2 className="t-title3">만난 사람</h2>
          <Link to="/dex" className="t-body2s c-tertiary">전체 보기</Link>
        </div>
        {r.people.length ? (
          <div className="strip">
            {r.people.map((p, i) => (
              <Slot key={p.id} slot={{ slot: i + 1, found: true, user: { ...p, role: p.limited ? "" : roleLine(p) } }} />
            ))}
          </div>
        ) : (
          <p className="soft-card t-body2 c-secondary">이번 행사에선 아직 만난 사람이 없어요. 다음 행사에서 키링을 태그해 보세요!</p>
        )}
        {toPlay.length > 0 && (
          <>
            <div className="section-head" style={{ marginTop: 8 }}>
              <h2 className="t-title3">아직 안 푼 퀴즈 {toPlay.length}개</h2>
              <Icon name="spark" size={18} className="c-brand" />
            </div>
            <div className="list">
              {toPlay.map((p) => (
                <Link key={p.id} to={`/quiz/${p.id}`} className="list-item">
                  <Avatar person={p} size="s" />
                  <span className="grow stack" style={{ gap: 0 }}>
                    <span className="t-body2s">{p.name}</span>
                    <span className="t-caption c-tertiary">{roleLine(p)}</span>
                  </span>
                  <Chip>{p.quizCount}문제</Chip>
                  <Icon name="chev" size={18} className="c-tertiary" />
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="bottom-cta">
        <div className="row">
          <Button variant="secondary" disabled={sharing} onClick={share}>
            <Icon name="share" size={18} /> 이미지로 공유
          </Button>
          {toPlay.length > 0 ? (
            <Button onClick={() => nav(`/quiz/${toPlay[0].id}`)}>퀴즈 이어서 풀기</Button>
          ) : (
            <Button onClick={() => nav("/dex")}>도감 보기</Button>
          )}
        </div>
      </div>
    </Screen>
  );
}
