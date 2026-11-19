// D2 발견 보드: 행사의 홈. 못 만난 사람은 가려진 카드 + 힌트, 실시간 알림은 토스트로.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { get, post } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { useEventStream } from "../lib/useEventStream.js";
import { timeRange } from "../lib/format.js";
import { Button, Chip, ErrorState, Progress, Screen, Slot, Spinner, TabBar, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

// /board: 지금 참가 중인 행사로 보낸다
export function BoardHome() {
  const { me, loading } = useSession();
  const [events, setEvents] = useState(null);
  useEffect(() => {
    if (me) get("/api/me/events").then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [me]);
  if (loading) return <Screen tone="base"><Spinner /></Screen>;
  if (!me) return <Navigate to="/login?next=/board" replace />;
  if (!events) return <Screen tone="base"><Spinner /></Screen>;
  const live = events.find((e) => e.status === "live") || events.find((e) => e.status === "upcoming");
  if (live) return <Navigate to={`/events/${live.id}`} replace />;
  return <CheckIn />;
}

// 체크인 코드 입력 (입구 QR 대신 코드로 들어올 때, 또는 행사가 없을 때)
function CheckIn({ eventId }) {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    try {
      const r = await post("/api/events/checkin", { code: code.trim(), showOnLeaderboard: show });
      nav(`/events/${r.eventId}`, { replace: true });
      if (r.eventId === eventId) window.location.reload();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Screen tone="base">
      <form className="content" style={{ paddingTop: 48 }} onSubmit={submit}>
        <div className="heading">
          <h1 className="t-title1">{eventId ? "체크인하면\n보드가 열려요" : "참가 중인 행사가 없어요"}</h1>
          <p className="t-body2 c-secondary">행사장 입구의 체크인 코드를 입력하거나, 행사에서 받은 키링을 내 휴대폰으로 태그해 주세요.</p>
        </div>
        <label className="box-field">
          <span className="stack grow" style={{ gap: 4 }}>
            <span className="label">체크인 코드</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="off" autoComplete="off" />
          </span>
        </label>
        <button type="button" className="agree-row" aria-pressed={show} onClick={() => setShow(!show)}>
          <Icon name="check" size={20} className={`tick ${show ? "on" : ""}`} />
          [선택] 리더보드에 내 이름과 만난 사람 수를 보여 줘요
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
      <div className="bottom-cta">
        <Button disabled={code.trim().length < 6} onClick={submit}>
          체크인하기
        </Button>
      </div>
      <TabBar />
    </Screen>
  );
}

export default function Board() {
  const { id } = useParams();
  const toast = useToast();
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [leaders, setLeaders] = useState([]);
  const [fresh, setFresh] = useState(() => new Set());
  const prevFound = useRef(new Set());
  const { me } = useSession();

  const load = useCallback(async () => {
    try {
      const b = await get(`/api/events/${id}/board`);
      const nowFound = new Set(b.slots.filter((s) => s.found).map((s) => s.user.id));
      if (prevFound.current.size) setFresh(new Set([...nowFound].filter((x) => !prevFound.current.has(x))));
      prevFound.current = nowFound;
      setBoard(b);
    } catch (e) {
      setError(e);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  useEventStream(board ? id : null, {
    ready: (d) => setLeaders(d.leaders || []),
    checkin: () => load(),
    found: () => load(),
    tagged: (d) => toast(`${d.by.name}님이 나를 태그했어요`, d.by),
    leaderboard: (d) => setLeaders(d.leaders || []),
  });

  const slots = useMemo(() => {
    if (!board) return [];
    if (filter === "hidden") return board.slots.filter((s) => !s.found);
    if (filter === "found") return board.slots.filter((s) => s.found);
    return board.slots;
  }, [board, filter]);

  if (error?.code === "not_attendee") return <CheckIn eventId={id} />;
  if (error) return <Screen tone="base"><ErrorState message={error.message} /><TabBar /></Screen>;
  if (!board) return <Screen tone="base"><Spinner /></Screen>;

  const { event, found, total } = board;
  const ended = Date.now() > event.endsAt;
  const myRank = leaders.find((l) => l.id === me?.id)?.rank;
  const left = total - found;
  const themeStyle = event.theme?.color ? { "--brand": event.theme.color } : undefined;

  return (
    <Screen tone="base" className="gradient-glow grain">
      <div style={themeStyle} className="stack grow">
        <header className="row" style={{ padding: "8px 24px", gap: 12 }}>
          <div className="event-logo">{event.theme?.logoUrl ? <img src={event.theme.logoUrl} alt="" /> : event.name[0]}</div>
          <div className="grow">
            <p className="t-body2s">{event.name}</p>
            <p className="t-caption c-tertiary">{timeRange(event.startsAt, event.endsAt)} · {total + 1}명 참가 중</p>
          </div>
          {event.live ? <Chip tone="success">● 진행 중</Chip> : <Chip tone="neutral">{ended ? "종료" : "시작 전"}</Chip>}
        </header>
        <div className="content tight" style={{ paddingTop: 16 }}>
          {event.theme?.welcome && <p className="t-body2 c-secondary">{event.theme.welcome}</p>}
          <h1 className="t-title1">
            {total}명 중 <span className="c-brand">{found}명</span>을
            <br />
            만났어요
          </h1>
          <Progress value={found} total={total} />
          <p className="row t-caption c-secondary">
            <Icon name="spark" size={14} className="c-brand" />
            {left === 0 ? "모두 만났어요! 🎉" : myRank ? `${left}명 남았어요 · 지금 ${myRank}위` : `${left}명 남았어요 · 키링을 태그해서 열어 보세요`}
          </p>
          {ended && (
            <Link to={`/events/${id}/recap`} className="soft-card row between">
              <span className="t-body2s">행사가 끝났어요. 리캡 보기</span>
              <Icon name="chev" size={18} />
            </Link>
          )}
          <div className="segmented" role="group" aria-label="보기">
            {[["all", `전체 ${total}`], ["hidden", `못 만난 ${left}`], ["found", `만난 ${found}`]].map(([k, l]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          {slots.length ? (
            <div className="slot-grid">
              {slots.map((s) => (
                <Slot key={s.slot} slot={s} justFound={s.found && fresh.has(s.user.id)} onClick={() => toast("상대방 키링에 휴대폰을 대면 열려요")} />
              ))}
            </div>
          ) : (
            <ErrorState title={filter === "found" ? "아직 만난 사람이 없어요" : total ? "모두 만났어요!" : "아직 다른 참가자가 없어요"} message="사람들이 체크인하면 여기에 카드가 생겨요" />
          )}
        </div>
      </div>
      <TabBar />
    </Screen>
  );
}
