// A1 로그인 전 태그 / E2 만난 사람의 명함 / A2 새 사람 발견(?new=1).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { get, post, put } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { dateLabel, roleLine, vibrate } from "../lib/format.js";
import { Avatar, Button, Chip, ErrorState, Screen, Sheet, Spinner, TopBar, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import NoteSheet from "../components/NoteSheet.jsx";

const CONFETTI = ["#EC2B7A", "#CEFF32", "#FE7BBF", "#4FC3F7", "#FFD54F", "#ffffff"];

function Reveal({ person, order, eventId, onClose }) {
  const nav = useNavigate();
  const pieces = useMemo(
    () => Array.from({ length: 36 }, (_, i) => ({ left: Math.random() * 100, delay: Math.random() * 0.6, color: CONFETTI[i % CONFETTI.length], rot: Math.random() * 360 })),
    [],
  );
  useEffect(() => {
    vibrate([18, 40, 28]);
  }, []);
  return (
    <div className="reveal gradient-aurora grain" role="dialog" aria-label="새로운 사람을 발견했어요">
      <div className="confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <i key={i} style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, transform: `rotate(${p.rot}deg)` }} />
        ))}
      </div>
      <div className="inner">
        <div className="topbar" style={{ justifyContent: "flex-end" }}>
          <button className="icon-btn" style={{ color: "var(--fog-text)" }} onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="stack center" style={{ gap: 12, padding: "0 24px" }}>
          {order > 0 && <Chip tone="reward">{order}번째 만남</Chip>}
          <h1 className="t-title2">새로운 사람을 발견했어요!</h1>
        </div>
        <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
          <div className="reveal-card">
            <Avatar person={person} size="xl" />
            <div className="stack center" style={{ gap: 4 }}>
              <p className="t-title1">{person.name}</p>
              <p className="t-body2 c-secondary">{roleLine(person)}</p>
            </div>
            {person.oneLiner && <p className="soft-card t-body2 c-secondary" style={{ width: "100%" }}>“{person.oneLiner}”</p>}
            {person.quizCount > 0 && (
              <p className="row t-caption c-brand">
                <Icon name="spark" size={14} /> {person.name}님 퀴즈 {person.quizCount}개가 도감에 저장됐어요
              </p>
            )}
          </div>
        </div>
        <div className="bottom-cta">
          <Button variant="reward" onClick={onClose}>
            명함 자세히 보기
          </Button>
          <button className="btn text" style={{ color: "var(--fog-text)" }} onClick={() => nav(eventId ? `/events/${eventId}` : "/board")}>
            계속 찾으러 가기
          </button>
        </div>
      </div>
    </div>
  );
}

function Locked({ person, id }) {
  return (
    <Screen>
      <div className="content tight" style={{ paddingTop: 32 }}>
        <p className="row t-body2s c-brand">
          <Icon name="spark" size={16} /> Meetcha
        </p>
        <div className="card stack center" style={{ padding: "28px 24px", gap: 16, borderRadius: 24, boxShadow: "var(--shadow-card)" }}>
          <Avatar person={person} size="l" />
          <p className="t-title1">{person.name}</p>
          <div className="blur-lines" aria-hidden="true">
            <i style={{ width: 180 }} />
            <i style={{ width: 240 }} />
            <i style={{ width: 200 }} />
          </div>
          <p className="row t-caption c-tertiary">
            <Icon name="lock" size={16} /> 직함 · 소개 · 링크 · 퀴즈
          </p>
        </div>
        <p className="t-title2 center" style={{ marginTop: 8 }}>
          로그인하면 {person.name}님이
          <br />내 도감에 바로 저장돼요
        </p>
        <p className="t-body2 c-secondary center">앱 설치 없이, 이메일 하나로 3초면 돼요</p>
      </div>
      <div className="bottom-cta">
        <Link to={`/login?next=${encodeURIComponent(`/u/${id}`)}`} className="btn primary">
          이메일로 계속하기
        </Link>
      </div>
    </Screen>
  );
}

const REASONS = [
  ["harassment", "괴롭힘·원치 않는 연락"],
  ["spam", "스팸·광고"],
  ["impersonation", "다른 사람을 사칭해요"],
  ["inappropriate", "부적절한 내용"],
  ["other", "기타"],
];
function MoreSheet({ person, onClose }) {
  const [mode, setMode] = useState("menu");
  const [reason, setReason] = useState(null);
  const toast = useToast();
  const nav = useNavigate();
  async function report() {
    try {
      await post(`/api/users/${person.id}/report`, { reason });
      toast("신고를 접수했어요. 운영진이 확인할게요");
      onClose();
    } catch (e) {
      toast(e.message);
    }
  }
  async function block() {
    try {
      await post(`/api/users/${person.id}/block`);
      toast(`${person.name}님을 차단했어요`);
      nav("/dex", { replace: true });
    } catch (e) {
      toast(e.message);
    }
  }
  return (
    <Sheet onClose={onClose} label="더 보기">
      {mode === "menu" && (
        <div className="stack">
          <button className="list-item t-body1s" onClick={() => setMode("report")}>신고하기</button>
          <button className="list-item t-body1s c-danger" onClick={() => setMode("block")}>차단하기</button>
        </div>
      )}
      {mode === "report" && (
        <>
          <h2 className="t-title2">어떤 문제가 있었나요?</h2>
          <div className="stack" style={{ gap: 4 }}>
            {REASONS.map(([k, l]) => (
              <button key={k} className="agree-row" aria-pressed={reason === k} onClick={() => setReason(k)}>
                <Icon name="check" size={20} className={`tick ${reason === k ? "on" : ""}`} />
                {l}
              </button>
            ))}
          </div>
          <Button disabled={!reason} onClick={report}>신고하기</Button>
        </>
      )}
      {mode === "block" && (
        <>
          <h2 className="t-title2">{person.name}님을 차단할까요?</h2>
          <p className="t-body2 c-secondary">차단하면 이 사람이 보내는 쪽지를 받지 않아요. 상대에게는 알리지 않아요.</p>
          <Button onClick={block}>차단하기</Button>
        </>
      )}
    </Sheet>
  );
}

export default function Person() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { me, loading } = useSession();
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [order, setOrder] = useState(0);
  const [eventId, setEventId] = useState(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(true);
  const [sheet, setSheet] = useState(params.get("msg") ? "msg" : null);
  const timer = useRef(null);
  const isNew = params.get("new") === "1";

  useEffect(() => {
    get(`/api/users/${id}`)
      .then((x) => {
        setP(x);
        setNote(x.note || "");
      })
      .catch(setError);
  }, [id]);
  useEffect(() => {
    if (!isNew || !me) return;
    get("/api/dex").then((d) => setOrder(d.count)).catch(() => {});
    get("/api/me/events").then((r) => setEventId(r.events.find((e) => e.status === "live")?.id || null)).catch(() => {});
  }, [isNew, me]);

  function changeNote(v) {
    setNote(v);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await put(`/api/users/${id}/note`, { body: v });
        setSaved(true);
      } catch {
        /* 다음 입력 때 다시 저장 */
      }
    }, 600);
  }

  if (error) return <Screen><TopBar /><ErrorState title="찾을 수 없는 사람이에요" message="링크를 다시 확인해 주세요." /></Screen>;
  if (!p || loading) return <Screen><Spinner /></Screen>;
  if (!me) return <Locked person={p} id={id} />;
  const isSelf = me.id === p.id;

  if (p.limited)
    return (
      <Screen>
        <TopBar />
        <div className="content center" style={{ paddingTop: 40 }}>
          <Avatar person={p} size="l" />
          <p className="t-title1">{p.name}</p>
          <p className="t-body2 c-secondary">{p.deleted ? "탈퇴한 사용자예요." : "이 사람은 만난 사람에게만 명함을 보여 줘요. 키링을 태그하면 열려요."}</p>
        </div>
      </Screen>
    );

  const met = p.encounter;
  return (
    <Screen>
      <TopBar
        right={
          isSelf ? (
            <Link to="/me" className="t-body2s c-brand">편집</Link>
          ) : (
            <button className="icon-btn" onClick={() => setSheet("more")} aria-label="더 보기">
              <Icon name="more" />
            </button>
          )
        }
      />
      <div className="content tight">
        <div className="stack" style={{ gap: 12 }}>
          <Avatar person={p} size="l" />
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="t-title1">{p.name}</h1>
            {roleLine(p) && <p className="t-body1 c-secondary">{roleLine(p)}</p>}
          </div>
          {met && (
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <Chip tone="neutral">{dateLabel(met.firstAt)}에 만남</Chip>
              {met.verified && <Chip tone="success">✓ 직접 태그</Chip>}
            </div>
          )}
          {isSelf && <Chip tone="neutral">다른 사람에게 이렇게 보여요</Chip>}
        </div>
        {p.oneLiner && <p className="soft-card t-body1">{p.oneLiner}</p>}
        {p.links?.length > 0 && (
          <div className="row" style={{ flexWrap: "wrap" }}>
            {p.links.map((l) => (
              <a key={l.url} className="link-chip" href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label} ↗
              </a>
            ))}
          </div>
        )}
        {met && p.quizCount > 0 && (
          <Link to={`/quiz/${p.id}`} className="row grain" style={{ background: "var(--brand)", color: "#fff", borderRadius: 24, padding: 20, gap: 12 }}>
            <span className="grow stack" style={{ gap: 4 }}>
              <span className="t-title3">
                {p.name}님을 얼마나
                <br />
                기억하나요?
              </span>
              <span className="t-caption" style={{ opacity: 0.8 }}>
                {met.bestScore != null ? `최고 ${met.bestScore.toLocaleString()}점 · 다시 풀기` : `${p.quizCount}문제 · 문제당 10초`}
              </span>
            </span>
            <span className="chip" style={{ background: "#fff", color: "var(--brand)", height: 40, padding: "0 18px", fontSize: 15 }}>
              {met.bestScore != null ? "다시" : "풀기"}
            </span>
          </Link>
        )}
        {met && (
          <div className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <label htmlFor="memo" className="t-caption c-tertiary">나만 보는 메모</label>
              <span className={`t-caption ${saved ? "c-success" : "c-tertiary"}`}>{saved ? "자동 저장됨" : "저장 중…"}</span>
            </div>
            <textarea id="memo" className="t-body2" rows={3} maxLength={1000} placeholder="어떤 얘기를 나눴는지 적어 두세요" value={note} onChange={(e) => changeNote(e.target.value)} style={{ border: 0, outline: "none", resize: "none", background: "none", padding: 0 }} />
          </div>
        )}
      </div>
      {!isSelf && (
        <div className="bottom-cta">
          <div className="row">
            <a className="btn secondary" href={`/api/users/${p.id}/vcard`}>
              연락처 저장
            </a>
            <Button onClick={() => setSheet("msg")}>쪽지 보내기</Button>
          </div>
        </div>
      )}
      {sheet === "msg" && <NoteSheet person={p} onClose={() => setSheet(null)} />}
      {sheet === "more" && <MoreSheet person={p} onClose={() => setSheet(null)} />}
      {isNew && <Reveal person={p} order={order} eventId={eventId} onClose={() => setParams({}, { replace: true })} />}
    </Screen>
  );
}
