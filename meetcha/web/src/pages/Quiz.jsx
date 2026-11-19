// E3 퀴즈(문제 → 정답 공개) / E4 결과. 정답은 서버가 채점한다.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { get, post } from "../lib/api.js";
import { vibrate } from "../lib/format.js";
import { Avatar, Button, Chip, ErrorState, Screen, Spinner, TopBar } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

const AUTO_NEXT_MS = 1400;

function Timer({ startedAt, limitMs, stopped, onTimeout }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (stopped) return;
    let raf;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t - startedAt >= limitMs) onTimeout();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, limitMs, stopped, onTimeout]);
  const left = Math.max(0, limitMs - (now - startedAt));
  const urgent = left <= 3000;
  return (
    <div className="timer">
      <div className="progress">
        <i style={{ width: `${(left / limitMs) * 100}%`, background: urgent ? "var(--warning)" : "var(--brand)" }} />
      </div>
      <span className="row t-body2s" style={{ gap: 4, color: urgent ? "var(--warning)" : "var(--text-secondary)", minWidth: 44 }}>
        <Icon name="clock" size={16} /> {Math.ceil(left / 1000)}초
      </span>
    </div>
  );
}

export default function Quiz() {
  const { userId } = useParams();
  const nav = useNavigate();
  const [owner, setOwner] = useState(null);
  const [attempt, setAttempt] = useState(null); // { id, question }
  const [startedAt, setStartedAt] = useState(0);
  const [picked, setPicked] = useState(null);
  const [answer, setAnswer] = useState(null); // 서버 응답
  const [times, setTimes] = useState([]);
  const [result, setResult] = useState(null);
  const [nextPerson, setNextPerson] = useState(null);
  const [error, setError] = useState(null);
  const sending = useRef(false);
  const autoTimer = useRef(null);

  const start = useCallback(async () => {
    setResult(null);
    setAnswer(null);
    setPicked(null);
    setTimes([]);
    try {
      const r = await post(`/api/users/${userId}/quiz/attempts`);
      setAttempt({ id: r.attemptId, question: r.question });
      setStartedAt(Date.now());
    } catch (e) {
      setError(e);
    }
  }, [userId]);

  useEffect(() => {
    get(`/api/users/${userId}`).then(setOwner).catch(setError);
    start();
    return () => clearTimeout(autoTimer.current);
  }, [userId, start]);

  const goNext = useCallback(
    (resp) => {
      clearTimeout(autoTimer.current);
      if (resp.done) {
        setResult(resp.result);
        // 다음에 풀 사람: 도감에서 아직 안 푼 사람
        get("/api/dex")
          .then((d) => setNextPerson(d.people.find((x) => x.id !== userId && !x.limited && x.quizCount > 0 && x.bestScore == null) || null))
          .catch(() => {});
      } else {
        setAttempt((a) => ({ ...a, question: resp.next }));
        setAnswer(null);
        setPicked(null);
        setStartedAt(Date.now());
      }
    },
    [userId],
  );

  const choose = useCallback(
    async (choice) => {
      if (sending.current || answer) return;
      sending.current = true;
      setPicked(choice);
      const spent = Date.now() - startedAt;
      try {
        const r = await post(`/api/quiz/attempts/${attempt.id}/answer`, { choice });
        setTimes((t) => [...t, spent]);
        setAnswer(r);
        vibrate(r.correct ? [15, 30, 15] : 60);
        autoTimer.current = setTimeout(() => goNext(r), r.done ? AUTO_NEXT_MS + 400 : AUTO_NEXT_MS);
      } catch (e) {
        setError(e);
      } finally {
        sending.current = false;
      }
    },
    [answer, startedAt, attempt, goNext],
  );
  const onTimeout = useCallback(() => choose(-1), [choose]);

  if (error)
    return (
      <Screen>
        <TopBar type="close" />
        <ErrorState title={error.code === "not_met" ? "도감에 있는 사람의 퀴즈만 풀 수 있어요" : "퀴즈를 열 수 없어요"} message={error.code === "not_found" ? "이 사람은 아직 퀴즈를 만들지 않았어요." : error.message} />
      </Screen>
    );
  if (!owner || !attempt) return <Screen><Spinner /></Screen>;

  // ---------- E4 결과 ----------
  if (result) {
    const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1) : null;
    const ratio = result.correct / result.total;
    const headline = ratio === 1 ? "아주 잘 기억하고 있어요" : ratio >= 0.5 ? "꽤 기억하고 있어요" : "다시 만나면 기억날 거예요";
    return (
      <Screen>
        <TopBar type="close" onBack={() => nav(`/u/${userId}`, { replace: true })} />
        <div className="content center" style={{ paddingTop: 32, gap: 16 }}>
          <div style={{ width: 136, height: 136, borderRadius: "50%", background: "var(--brand-weak)", display: "grid", placeItems: "center" }}>
            <Avatar person={owner} size="xl" />
          </div>
          {ratio === 1 && <Chip tone="reward">전부 정답!</Chip>}
          <h1 className="t-title1">
            {owner.name}님을
            <br />
            {headline}
          </h1>
          <p className="t-display c-brand">
            {result.score.toLocaleString()}
            <span className="t-title2">점</span>
          </p>
          <p className="t-body2 c-tertiary">
            {result.total}문제 중 {result.correct}개 정답{avg ? ` · 평균 ${avg}초` : ""}
          </p>
          {nextPerson && (
            <Link to={`/quiz/${nextPerson.id}`} replace className="soft-card row" style={{ width: "100%", gap: 12, textAlign: "left" }}>
              <Avatar person={nextPerson} size="s" />
              <span className="grow stack" style={{ gap: 0 }}>
                <span className="t-body2s">다음은 {nextPerson.name}님</span>
                <span className="t-caption c-tertiary">퀴즈 {nextPerson.quizCount}개</span>
              </span>
              <Icon name="chev" size={18} className="c-tertiary" />
            </Link>
          )}
        </div>
        <div className="bottom-cta">
          <div className="row">
            <Button variant="secondary" onClick={() => nav(`/u/${userId}?msg=1`, { replace: true })}>
              쪽지 보내기
            </Button>
            {nextPerson ? (
              <Button onClick={() => nav(`/quiz/${nextPerson.id}`, { replace: true })}>다음 사람</Button>
            ) : (
              <Button onClick={start}>다시 풀기</Button>
            )}
          </div>
        </div>
      </Screen>
    );
  }

  // ---------- E3 문제 / 정답 공개 ----------
  const q = attempt.question;
  const stateOf = (i) => {
    if (!answer) return picked === i ? "selected" : "";
    if (i === answer.correctIndex) return "correct";
    if (i === picked) return "wrong";
    return "dimmed";
  };
  return (
    <Screen>
      <TopBar type="close" title={`${q.index + 1} / ${q.total}`} onBack={() => nav(`/u/${userId}`, { replace: true })} />
      <Timer key={`${attempt.id}-${q.index}`} startedAt={startedAt} limitMs={q.limitMs} stopped={!!answer || picked !== null} onTimeout={onTimeout} />
      <div className="content" style={{ paddingTop: 32, gap: 28 }}>
        <div className="row" style={{ gap: 10 }}>
          <Avatar person={owner} size="s" />
          <span className="t-body2s c-secondary">{owner.name}님이 낸 문제</span>
        </div>
        <h1 className="t-title1">{q.question}</h1>
        <div className="stack" style={{ gap: 12 }}>
          {q.options.map((o, i) => {
            const st = stateOf(i);
            return (
              <button key={i} className={`option ${st}`} disabled={!!answer || picked !== null} onClick={() => choose(i)}>
                <span className="badge">{st === "correct" ? <Icon name="check" size={16} /> : st === "wrong" ? <Icon name="close" size={16} /> : i + 1}</span>
                {o}
              </button>
            );
          })}
        </div>
      </div>
      <div className="bottom-cta">
        {answer ? (
          <>
            <div className={`feedback ${answer.correct ? "ok" : "no"}`}>
              <div className="row between">
                <span className={`t-title3 ${answer.correct ? "c-success" : "c-danger"}`}>{answer.correct ? "정답이에요!" : picked === -1 ? "시간이 다 됐어요" : "아쉬워요"}</span>
                {answer.correct && <span className="t-title2 c-success">+{answer.points}점</span>}
              </div>
              {owner.oneLiner && <p className="t-caption c-secondary">“{owner.oneLiner}” — {owner.name}님 소개</p>}
            </div>
            <Button onClick={() => goNext(answer)}>{answer.done ? "결과 보기" : "다음 문제"}</Button>
          </>
        ) : (
          <p className="t-caption c-tertiary center">빨리 맞힐수록 점수가 높아요</p>
        )}
      </div>
    </Screen>
  );
}
