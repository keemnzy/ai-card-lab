// 내 명함: 미리보기, 편집(프로필·링크·공개 범위·퀴즈·사진), 키링, 설정.
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { api, del, post, put } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { getThemePref, setThemePref } from "../lib/theme.js";
import { roleLine } from "../lib/format.js";
import { Avatar, Button, Chip, Screen, Sheet, Spinner, TabBar, TopBar, useToast } from "../components/ui.jsx";
import QuizEditor, { emptyQuestion } from "../components/QuizEditor.jsx";
import Icon from "../components/Icon.jsx";
import { HINTS } from "./Onboarding.jsx";

const VIS = [
  ["public", "전체 공개", "누구나 내 명함을 볼 수 있어요"],
  ["encountered", "만난 사람만", "키링을 서로 태그한 사람만 볼 수 있어요"],
  ["private", "비공개", "다른 사람에겐 이름만 보여요"],
];

function EditProfile({ me, onDone }) {
  const [f, setF] = useState({ name: me.name, role: me.role, org: me.org, oneLiner: me.oneLiner, hint: me.hint, visibility: me.visibility });
  const [links, setLinks] = useState(me.links.length ? me.links : [{ label: "LinkedIn", url: "https://" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  async function save() {
    setBusy(true);
    setError("");
    try {
      await put("/api/me/profile", f);
      await put("/api/me/links", { links: links.filter((l) => l.label.trim() && l.url.trim() && l.url.trim() !== "https://") });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <TopBar title="명함 편집" onBack={() => onDone(false)} />
      <div className="content tight">
        {[["name", "이름"], ["role", "직함"], ["org", "소속"]].map(([k, l]) => (
          <label key={k} className="box-field">
            <span className="stack grow" style={{ gap: 4 }}>
              <span className="label">{l}</span>
              <input value={f[k] || ""} onChange={(e) => set(k, e.target.value)} />
            </span>
          </label>
        ))}
        <label className="box-field" style={{ alignItems: "flex-start" }}>
          <span className="stack grow" style={{ gap: 4 }}>
            <span className="label">한 줄 소개</span>
            <textarea rows={2} maxLength={200} value={f.oneLiner || ""} onChange={(e) => set("oneLiner", e.target.value)} />
          </span>
        </label>
        <p className="t-body2s" style={{ marginTop: 8 }}>행사 힌트</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {HINTS.map((h) => (
            <div key={h} className="templates" style={{ margin: 0, padding: 0 }}>
              <button aria-pressed={f.hint === h} onClick={() => set("hint", f.hint === h ? "" : h)}>{h}</button>
            </div>
          ))}
        </div>
        <p className="t-body2s" style={{ marginTop: 8 }}>링크</p>
        {links.map((l, i) => (
          <div key={i} className="box-field" style={{ gap: 8 }}>
            <input style={{ maxWidth: 96, fontSize: 15 }} placeholder="이름" value={l.label} onChange={(e) => setLinks(links.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
            <input style={{ fontSize: 15, fontWeight: 400 }} placeholder="https://" inputMode="url" value={l.url} onChange={(e) => setLinks(links.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} />
            <button className="icon-btn c-tertiary" onClick={() => setLinks(links.filter((_, k) => k !== i))} aria-label="링크 삭제">
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
        {links.length < 8 && (
          <button className="btn neutral medium" style={{ width: "100%" }} onClick={() => setLinks([...links, { label: "", url: "https://" }])}>
            <Icon name="plus" size={18} /> 링크 추가
          </button>
        )}
        <p className="t-body2s" style={{ marginTop: 8 }}>공개 범위</p>
        <div className="stack" style={{ gap: 4 }}>
          {VIS.map(([k, l, d]) => (
            <button key={k} className="agree-row" aria-pressed={f.visibility === k} onClick={() => set("visibility", k)}>
              <Icon name="check" size={20} className={`tick ${f.visibility === k ? "on" : ""}`} />
              <span className="grow stack" style={{ gap: 0 }}>
                <span className="t-body2s" style={{ color: "var(--text-primary)" }}>{l}</span>
                <span className="t-caption c-tertiary">{d}</span>
              </span>
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="bottom-cta">
        <Button disabled={busy || !f.name?.trim()} onClick={save}>저장</Button>
      </div>
    </Screen>
  );
}

function EditQuiz({ me, onDone }) {
  const [quiz, setQuiz] = useState(me.quiz.length ? me.quiz : [emptyQuestion(0)]);
  const [error, setError] = useState("");
  async function save() {
    try {
      await put("/api/me/quiz", { quiz: quiz.filter((q) => q.question.trim() && q.options.every((o) => o.trim())) });
      onDone();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Screen>
      <TopBar title="내 퀴즈" onBack={() => onDone(false)} />
      <div className="content">
        <p className="t-body2 c-secondary">나를 태그한 사람이 나중에 풀어요. 최대 5문제, 보기는 4개예요.</p>
        <QuizEditor quiz={quiz} onChange={setQuiz} />
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="bottom-cta">
        <Button onClick={save}>저장</Button>
      </div>
    </Screen>
  );
}

export default function MyCard() {
  const { me, loading, refresh } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState(null);
  const [theme, setTheme] = useState(getThemePref());
  const [sheet, setSheet] = useState(null);
  const fileRef = useRef(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [mode]);

  if (loading) return <Screen><Spinner /></Screen>;
  if (!me) return <Navigate to="/login?next=/me" replace />;
  const done = async (changed = true) => {
    if (changed) {
      await refresh();
      toast("저장했어요");
    }
    setMode(null);
  };
  if (mode === "profile") return <EditProfile me={me} onDone={done} />;
  if (mode === "quiz") return <EditQuiz me={me} onDone={done} />;

  async function uploadPhoto(file) {
    if (!file) return;
    try {
      await api("/api/me/photo", { method: "PUT", body: file });
      await refresh();
      toast("사진을 바꿨어요");
    } catch (e) {
      toast(e.message);
    }
  }
  async function lost(tag) {
    await post(`/api/me/tags/${tag.id}/lost`);
    await refresh();
    toast("분실 신고했어요. 이 키링으로는 이제 명함이 열리지 않아요");
  }
  async function logout() {
    await post("/api/auth/logout");
    await refresh();
    nav("/", { replace: true });
  }
  async function leave() {
    await del("/api/me");
    await refresh();
    nav("/", { replace: true });
  }

  return (
    <Screen tone="base">
      <header style={{ padding: "16px 24px 8px" }}>
        <h1 className="t-title1">내 명함</h1>
      </header>
      <div className="content tight">
        <div className="soft-card stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 16 }}>
            <button onClick={() => fileRef.current?.click()} style={{ border: 0, background: "none", padding: 0, position: "relative" }} aria-label="사진 바꾸기">
              <Avatar person={me} size="l" />
              <span style={{ position: "absolute", right: -2, bottom: -2, width: 26, height: 26, borderRadius: "50%", background: "var(--bg-surface)", display: "grid", placeItems: "center", boxShadow: "0 1px 4px rgba(0,0,0,.15)" }}>
                <Icon name="camera" size={15} />
              </span>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
            <div className="grow">
              <p className="t-title2">{me.name || "이름을 입력해 주세요"}</p>
              <p className="t-body2 c-secondary">{roleLine(me) || "직함·소속 없음"}</p>
            </div>
          </div>
          {me.oneLiner && <p className="t-body2">{me.oneLiner}</p>}
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <Chip tone="neutral">{VIS.find((v) => v[0] === me.visibility)?.[1]}</Chip>
            {me.hint && <Chip tone="neutral">힌트: {me.hint}</Chip>}
            <Chip tone="neutral">링크 {me.links.length}개</Chip>
          </div>
          <div className="row">
            <Button variant="secondary" size="medium" style={{ flex: 1 }} onClick={() => setMode("profile")}>명함 편집</Button>
            <Link to={`/u/${me.id}`} className="btn neutral medium" style={{ flex: 1 }}>미리보기</Link>
          </div>
        </div>
        <button className="soft-card row" style={{ border: 0, textAlign: "left", width: "100%" }} onClick={() => setMode("quiz")}>
          <span className="grow stack" style={{ gap: 2 }}>
            <span className="t-body1s">내 퀴즈 {me.quiz.length}개</span>
            <span className="t-caption c-tertiary">{me.quiz[0]?.question || "나를 태그한 사람이 풀 퀴즈를 만들어 보세요"}</span>
          </span>
          <Icon name="chev" size={18} className="c-tertiary" />
        </button>
        <div className="soft-card stack" style={{ gap: 4 }}>
          <p className="t-body1s">내 키링 {me.tags.filter((t) => t.status === "active").length}개</p>
          {me.tags.length === 0 && <p className="t-caption c-tertiary">행사에서 받은 키링을 내 휴대폰으로 태그하면 연결돼요</p>}
          {me.tags.map((t) => (
            <div key={t.id} className="list-item">
              <Icon name="nfc" size={20} className="c-brand" />
              <span className="grow t-body2">{t.label || "Meetcha 키링"}</span>
              {t.status === "active" ? (
                <button className="btn text" style={{ height: 32, width: "auto" }} onClick={() => setSheet({ type: "lost", tag: t })}>분실 신고</button>
              ) : (
                <Chip tone="neutral">사용 중지</Chip>
              )}
            </div>
          ))}
        </div>
        <div className="soft-card stack" style={{ gap: 12 }}>
          <p className="t-body1s">화면 모드</p>
          <div className="segmented" role="group" aria-label="화면 모드">
            {[["system", "기기 설정"], ["light", "라이트"], ["dark", "다크"]].map(([k, l]) => (
              <button key={k} aria-pressed={theme === k} onClick={() => { setTheme(k); setThemePref(k); }}>{l}</button>
            ))}
          </div>
        </div>
        <div className="list">
          {me.isAdmin && (
            <Link className="list-item t-body2s c-brand" to="/admin">
              운영진 콘솔 열기
            </Link>
          )}
          <a className="list-item t-body2" href="/legal/terms" target="_blank" rel="noreferrer">이용약관</a>
          <a className="list-item t-body2" href="/legal/privacy" target="_blank" rel="noreferrer">개인정보처리방침</a>
          <button className="list-item t-body2" onClick={logout}>로그아웃</button>
          <button className="list-item t-body2 c-tertiary" onClick={() => setSheet({ type: "leave" })}>탈퇴하기</button>
        </div>
      </div>
      <TabBar />
      {sheet?.type === "lost" && (
        <Sheet onClose={() => setSheet(null)} label="분실 신고">
          <h2 className="t-title2">이 키링을 분실 신고할까요?</h2>
          <p className="t-body2 c-secondary">신고하면 누가 이 키링을 태그해도 내 명함이 열리지 않아요. 되돌릴 수 없어요.</p>
          <Button onClick={async () => { setSheet(null); await lost(sheet.tag); }}>분실 신고하기</Button>
        </Sheet>
      )}
      {sheet?.type === "leave" && (
        <Sheet onClose={() => setSheet(null)} label="탈퇴">
          <h2 className="t-title2">정말 탈퇴할까요?</h2>
          <p className="t-body2 c-secondary">내 명함, 퀴즈, 도감, 메시지가 모두 지워지고 되돌릴 수 없어요. 내가 만난 사람들의 도감에는 "탈퇴한 사용자"로만 남아요.</p>
          <Button variant="neutral" onClick={leave}>탈퇴하기</Button>
        </Sheet>
      )}
    </Screen>
  );
}
