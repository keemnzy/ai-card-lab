// B1 이메일로 시작. 비밀번호 없이 메일 링크로 로그인한다.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { post } from "../lib/api.js";
import { Button, Screen, TopBar } from "../components/ui.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function Login() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const next = params.get("next");

  useEffect(() => {
    // 로그인 후 돌아갈 곳 (태그한 사람, 키링 등록 등)
    try {
      if (next) sessionStorage.setItem("meetcha-next", next);
    } catch {
      /* 무시 */
    }
  }, [next]);
  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function send(e) {
    e?.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError("이메일 주소를 확인해 주세요");
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/request", { email: email.trim() });
      setSent(true);
      setCooldown(30);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <Screen>
        <TopBar onBack={() => setSent(false)} />
        <div className="content">
          <div className="heading">
            <h1 className="t-title1">{"메일함을 확인해 주세요"}</h1>
            <p className="t-body2 c-secondary">
              <b>{email}</b>로 로그인 링크를 보냈어요. 15분 안에 링크를 누르면 바로 시작돼요.
            </p>
          </div>
          <div className="soft-card t-body2 c-secondary">메일이 안 보이면 스팸함도 확인해 주세요.</div>
        </div>
        <div className="bottom-cta">
          <Button variant="neutral" disabled={cooldown > 0 || busy} onClick={send}>
            {cooldown > 0 ? `${cooldown}초 뒤에 다시 보낼 수 있어요` : "메일 다시 보내기"}
          </Button>
        </div>
      </Screen>
    );

  return (
    <Screen>
      <TopBar />
      <form className="content" style={{ gap: 40 }} onSubmit={send}>
        <div className="heading">
          <h1 className="t-title1">이메일을 알려주세요</h1>
          <p className="t-body2 c-secondary">비밀번호 없이, 메일로 받은 링크를 누르면 바로 로그인돼요.</p>
        </div>
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input
            id="email"
            className="underline"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error ? <p className="error-text">{error}</p> : <p className="helper">행사 명단에 있는 이메일이면 내 정보를 미리 채워 둘게요</p>}
        </div>
        <button type="submit" hidden />
      </form>
      <div className="bottom-cta">
        <Button disabled={!email || busy} onClick={send}>
          {busy ? "보내는 중…" : "로그인 링크 받기"}
        </Button>
      </div>
    </Screen>
  );
}
