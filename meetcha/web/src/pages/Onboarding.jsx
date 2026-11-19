// C1~C3 첫 설정: 내 정보 확인 → 행사 힌트·사진 → 나에 대한 퀴즈. 30초 안에 끝나도록.
import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, put } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { Avatar, Button, Chip, Progress, Screen, Spinner, TopBar } from "../components/ui.jsx";
import QuizEditor, { emptyQuestion } from "../components/QuizEditor.jsx";
import Icon from "../components/Icon.jsx";

export const HINTS = ["개발", "디자인", "기획", "투자", "마케팅", "창업", "데이터", "세일즈", "연구", "학생"];

export default function Onboarding() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(null);
  const [prefilled] = useState(() => ({ name: !!me?.name, role: !!me?.role, org: !!me?.org }));
  const [quiz, setQuiz] = useState([emptyQuestion(0)]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  if (!me) return <Screen><Spinner /></Screen>;
  const f = form || { name: me.name, role: me.role, org: me.org, oneLiner: me.oneLiner, hint: me.hint, visibility: me.visibility };
  const set = (k, v) => setForm({ ...f, [k]: v });

  async function saveProfile() {
    await put("/api/me/profile", f);
  }
  async function nextStep() {
    setBusy(true);
    setError("");
    try {
      if (step === 1) {
        if (!f.name?.trim()) throw new Error("이름을 입력해 주세요");
        await saveProfile();
        await refresh(); // 다음 단계의 아바타에 이름 첫 글자가 보이도록
        setStep(2);
      } else if (step === 2) {
        await saveProfile();
        setStep(3);
      } else {
        const filled = quiz.filter((q) => q.question.trim() && q.options.every((o) => o.trim()));
        if (filled.length) await put("/api/me/quiz", { quiz: filled });
        await refresh();
        nav(next, { replace: true });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadPhoto(file) {
    if (!file) return;
    setBusy(true);
    try {
      await api("/api/me/photo", { method: "PUT", body: file });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <TopBar title={`${step} / 3`} onBack={() => (step > 1 ? setStep(step - 1) : nav(-1))} />
      <div style={{ padding: "0 24px" }}>
        <Progress value={step} total={3} thin gradient={false} />
      </div>
      <div className="content" style={{ paddingTop: 24 }}>
        {step === 1 && (
          <>
            <div className="heading">
              <h1 className="t-title1">{prefilled.name ? "행사 명단에서\n정보를 불러왔어요" : "어떻게 소개할까요?"}</h1>
              <p className="t-body2 c-secondary">{prefilled.name ? "맞는지 확인만 해 주세요. 탭하면 고칠 수 있어요." : "키링을 태그한 사람에게 보여 줄 명함이에요."}</p>
            </div>
            <div className="stack" style={{ gap: 12 }}>
              {[
                ["name", "이름", "김민지"],
                ["role", "직함", "Product Designer"],
                ["org", "소속", "회사·학교·팀"],
              ].map(([k, label, ph]) => (
                <label key={k} className="box-field">
                  <span className="stack grow" style={{ gap: 4 }}>
                    <span className="label">{label}</span>
                    <input value={f[k] || ""} placeholder={ph} maxLength={k === "name" ? 40 : 60} onChange={(e) => set(k, e.target.value)} />
                  </span>
                  {prefilled[k] && <Chip>불러옴</Chip>}
                </label>
              ))}
              <label className="box-field" style={{ alignItems: "flex-start" }}>
                <span className="stack grow" style={{ gap: 4 }}>
                  <span className="label">한 줄 소개 (선택)</span>
                  <textarea rows={2} maxLength={200} placeholder="주말엔 클라이밍, 평일엔 Postgres 튜닝" value={f.oneLiner || ""} onChange={(e) => set("oneLiner", e.target.value)} />
                </span>
              </label>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="heading">
              <h1 className="t-title1">{"행사장에서\n나를 찾을 힌트를 골라요"}</h1>
              <p className="t-body2 c-secondary">아직 못 만난 사람에게 가려진 카드와 함께 이 힌트만 보여요.</p>
            </div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {HINTS.map((h) => (
                <div key={h} className="templates" style={{ margin: 0, padding: 0 }}>
                  <button aria-pressed={f.hint === h} onClick={() => set("hint", f.hint === h ? "" : h)}>
                    {h}
                  </button>
                </div>
              ))}
            </div>
            <div className="soft-card row" style={{ gap: 14 }}>
              <Avatar person={me} size="m" />
              <div className="grow stack" style={{ gap: 2 }}>
                <p className="t-body2s">프로필 사진 (선택)</p>
                <p className="t-caption c-tertiary">위치 정보 등은 지우고 저장해요</p>
              </div>
              <Button variant="secondary" size="medium" style={{ flex: "none" }} onClick={() => fileRef.current?.click()} disabled={busy}>
                <Icon name="camera" size={18} />
                {me.photoUrl ? "바꾸기" : "올리기"}
              </Button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <div className="heading">
              <h1 className="t-title1">{"나에 대한 퀴즈를\n하나 내 볼까요?"}</h1>
              <p className="t-body2 c-secondary">오늘 만난 사람이 나중에 풀면서 나를 떠올려요.</p>
            </div>
            <QuizEditor quiz={quiz} onChange={setQuiz} single />
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="bottom-cta">
        <Button disabled={busy} onClick={nextStep}>
          {step === 1 ? (prefilled.name ? "맞아요" : "다음") : step === 2 ? "다음" : "완료하고 시작하기"}
        </Button>
        {step === 3 && (
          <button className="btn text" onClick={() => nav(next, { replace: true })}>
            다음에 할게요
          </button>
        )}
      </div>
    </Screen>
  );
}
