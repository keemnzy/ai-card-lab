// E1 도감: 행사별 명함 저장소.
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { get } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { dateLabel, roleLine } from "../lib/format.js";
import { Avatar, Chip, ErrorState, Screen, Spinner, TabBar } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

export default function Dex() {
  const { me, loading } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (me) get("/api/dex?groupBy=event").then(setData).catch(setError);
  }, [me]);

  const groups = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    if (!term) return data.groups;
    return data.groups
      .map((g) => ({ ...g, people: g.people.filter((p) => [p.name, p.role, p.org].some((x) => x?.toLowerCase().includes(term))) }))
      .filter((g) => g.people.length);
  }, [data, q]);

  if (loading) return <Screen><Spinner /></Screen>;
  if (!me) return <Navigate to="/login?next=/dex" replace />;

  return (
    <Screen>
      <header className="row between" style={{ padding: "16px 24px 8px" }}>
        <h1 className="t-title1">도감</h1>
        <button className="icon-btn" onClick={() => setSearching(!searching)} aria-label="검색">
          <Icon name="search" />
        </button>
      </header>
      <div className="content" style={{ paddingTop: 12 }}>
        {searching && (
          <label className="box-field">
            <Icon name="search" size={18} className="c-tertiary" />
            <input autoFocus placeholder="이름·회사·직함으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
        {error && <ErrorState message={error.message} />}
        {!data && !error && <Spinner />}
        {data && (
          <p className="t-body2 c-secondary">
            지금까지 {data.groups.filter((g) => g.event).length}개 행사에서 {data.count}명
          </p>
        )}
        {data?.count === 0 && <ErrorState title="아직 만난 사람이 없어요" message="행사에서 다른 사람의 키링에 휴대폰을 대 보세요." />}
        {groups.map((g) => (
          <section key={g.event?.id || "none"} className="stack" style={{ gap: 4 }}>
            <div className="row between" style={{ padding: "4px 0" }}>
              <div>
                <p className="t-body1s">{g.event ? g.event.name : "행사 밖에서 만난 사람"}</p>
                <p className="t-caption c-tertiary">
                  {g.event ? `${dateLabel(g.event.startsAt)} · ` : ""}
                  {g.people.length}명
                </p>
              </div>
              {g.event && (
                <Link to={`/events/${g.event.id}/recap`}>
                  <Chip>리캡 보기</Chip>
                </Link>
              )}
            </div>
            {g.people.map((p) => (
              <Link key={p.id} to={`/u/${p.id}`} className="list-item">
                <Avatar person={p} size="m" />
                <span className="grow stack" style={{ gap: 2 }}>
                  <span className="t-body1s">{p.name}</span>
                  <span className="t-caption c-tertiary">{p.limited ? (p.deleted ? "탈퇴한 사용자" : "명함 비공개") : roleLine(p)}</span>
                </span>
                {p.bestScore != null ? (
                  <span className="t-caption c-tertiary">{p.bestScore.toLocaleString()}점</span>
                ) : (
                  !p.limited && p.quizCount > 0 && <Chip>퀴즈</Chip>
                )}
              </Link>
            ))}
            <div style={{ height: 1, background: "var(--line-default)", marginTop: 8 }} />
          </section>
        ))}
        {data?.groups.some((g) => g.event) && (
          <a className="btn neutral medium" style={{ width: "100%" }} href="/api/dex/vcard">
            전체 연락처로 저장하기
          </a>
        )}
      </div>
      <TabBar />
    </Screen>
  );
}
