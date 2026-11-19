// B2 메일 링크로 돌아온 화면. 버튼을 눌러야 로그인된다(메일 보안 스캐너가 링크를 미리 열어도 안전).
// 처음 가입이면 동의 바텀시트가 뜬다.
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { post } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { Button, Screen, Sheet } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";

const ITEMS = [
  { key: "age", label: "[필수] 만 14세 이상이에요" },
  { key: "terms", label: "[필수] 이용약관", href: "/legal/terms" },
  { key: "privacy", label: "[필수] 개인정보 수집·이용", href: "/legal/privacy" },
];

export default function Verify() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const nav = useNavigate();
  const { refresh } = useSession();
  const [needConsent, setNeedConsent] = useState(false);
  const [agree, setAgree] = useState({ age: false, terms: false, privacy: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const all = ITEMS.every((i) => agree[i.key]);

  async function go(consent) {
    setBusy(true);
    setError("");
    try {
      const r = await post("/api/auth/verify", consent ? { token, consent } : { token });
      await refresh();
      let next = r.redirect && r.redirect !== "/" ? r.redirect : null;
      try {
        next = next || sessionStorage.getItem("meetcha-next");
        sessionStorage.removeItem("meetcha-next");
      } catch {
        /* 무시 */
      }
      // 새로 가입했으면 내 명함부터 만든다
      if (consent) nav(`/onboarding?next=${encodeURIComponent(next || "/")}`, { replace: true });
      else nav(next || "/", { replace: true });
    } catch (e) {
      if (e.code === "consent_required") setNeedConsent(true);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen tone="base">
      <div className="content" style={{ paddingTop: 72 }}>
        <div className="heading">
          <p className="row t-body2s c-brand">
            <Icon name="spark" size={16} /> Meetcha
          </p>
          <h1 className="t-title1">{"메일 확인 완료!\n이제 시작해 볼까요?"}</h1>
          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
      <div className="bottom-cta">
        <Button disabled={!token || busy} onClick={() => go()}>
          {busy ? "확인 중…" : "로그인"}
        </Button>
      </div>
      {needConsent && (
        <Sheet onClose={() => setNeedConsent(false)} label="가입 동의">
          <h2 className="t-title2" style={{ whiteSpace: "pre-line" }}>
            {"Meetcha를 시작하려면\n아래 내용에 동의해 주세요"}
          </h2>
          <button className="agree-all" onClick={() => setAgree({ age: !all, terms: !all, privacy: !all })} aria-pressed={all}>
            <span className={`check ${all ? "on" : ""}`}>
              <Icon name="check" size={16} />
            </span>
            전체 동의하기
          </button>
          <div className="stack" style={{ gap: 4 }}>
            {ITEMS.map((i) => (
              <div key={i.key} className="row">
                <button className="agree-row" aria-pressed={agree[i.key]} onClick={() => setAgree((a) => ({ ...a, [i.key]: !a[i.key] }))}>
                  <Icon name="check" size={20} className={`tick ${agree[i.key] ? "on" : ""}`} />
                  <span className="grow">{i.label}</span>
                </button>
                {i.href && (
                  <a href={i.href} target="_blank" rel="noreferrer" className="icon-btn c-tertiary" aria-label={`${i.label} 보기`}>
                    <Icon name="chev" size={18} />
                  </a>
                )}
              </div>
            ))}
          </div>
          {error && <p className="error-text">{error}</p>}
          <Button disabled={!all || busy} onClick={() => go(agree)}>
            동의하고 시작하기
          </Button>
        </Sheet>
      )}
    </Screen>
  );
}
