// 행사 상세: 현황(H2) · 참가자(H3·H4) · 키링(H6) · 체크인(H7·H10) · 테마(H5) · 마무리(H9 + 대형 화면)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { api, get, post, put } from "../lib/api.js";
import { dateLabel, timeRange } from "../lib/format.js";
import { Button, Chip, ErrorState, Progress, Spinner, useToast } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { AdminShell, Dialog, STATUS, Stat, fileSafe, saveBlob } from "./AdminShell.jsx";

const TABS = [
  ["overview", "현황"],
  ["attendees", "참가자"],
  ["tags", "키링"],
  ["checkin", "체크인"],
  ["theme", "테마"],
  ["wrapup", "마무리"],
];

// ---------- 현황 ----------
function Overview({ ev, att, report }) {
  const invited = att?.invited ?? 0;
  return (
    <>
      <div className="stat-grid">
        <Stat hl label="체크인" value={ev.checkedIn} unit="명" sub={invited ? `명단 ${invited}명 중 ${Math.round(((att?.checkedIn ?? 0) / invited) * 100)}%` : "명단 없이 진행 중"} />
        <Stat label="만남 (태그)" value={ev.encounters} unit="번" sub={report ? `정품 키링 ${report.verifiedEncounters}번` : null} />
        <Stat label="1인당 평균 만남" value={report?.avgPeopleMet ?? "—"} unit="명" />
        <Stat label="퀴즈 완료" value={report?.quizzesFinished ?? "—"} unit="번" sub={report?.avgQuizScore ? `평균 ${report.avgQuizScore.toLocaleString()}점` : null} />
        <Stat label="참가자끼리 메시지" value={report?.messagesBetweenAttendees ?? "—"} unit="개" />
        <Stat label="키링 등록" value={`${ev.tags.claimed}/${ev.tags.issued}`} sub="등록 / 발급" />
      </div>
      {invited > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2 className="t-title3">명단 진행 상황</h2>
            <Link to="?tab=attendees" className="t-body2s c-brand">참가자 보기</Link>
          </div>
          {[["가입", att.joined], ["체크인", att.checkedIn]].map(([l, v]) => (
            <div key={l} className="stack" style={{ gap: 6 }}>
              <div className="row between t-body2">
                <span>{l}</span>
                <span className="c-tertiary">{v} / {invited}명</span>
              </div>
              <Progress value={v} total={invited} gradient={l === "체크인"} />
            </div>
          ))}
          {att.walkIns > 0 && <p className="t-caption c-tertiary">명단에 없던 현장 참가자 {att.walkIns}명</p>}
        </div>
      )}
      <div className="notice info">
        <Icon name="lock" size={18} />
        <span>숫자는 모두 통계예요. 고객사에는 개인을 알아볼 수 없는 숫자만 전달돼요 (개인정보처리방침 제3조).</span>
      </div>
    </>
  );
}

// ---------- 참가자 ----------
function Attendees({ eventId, ev, att, reload }) {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const [over, setOver] = useState(false);
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const unsent = (att?.attendees || []).filter((a) => !a.invitedEmailSentAt && !a.joined).length;

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    try {
      const csv = await file.text();
      const r = await post(`/api/admin/events/${eventId}/attendees/import`, { csv });
      setResult(r);
      reload();
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  }
  async function sendInvites() {
    setBusy(true);
    try {
      const r = await post(`/api/admin/events/${eventId}/invites/send`);
      toast(`${r.sent}명에게 안내 메일을 보냈어요`);
      setConfirm(false);
      reload();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (att?.attendees || []).filter((a) => !t || [a.name, a.email, a.org, a.role].some((x) => x?.toLowerCase().includes(t)));
  }, [att, q]);
  const status = (a) => (a.checkedInAt ? ["success", "체크인"] : a.joined ? ["brand", "가입"] : a.invitedEmailSentAt ? ["neutral", "메일 보냄"] : ["fog", "대기"]);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="t-title3">명단 올리기</h2>
            <p className="t-caption c-tertiary">Luma·Eventbrite에서 내려받은 CSV를 그대로 올려도 돼요. 첫 줄에 email 열이 있어야 해요.</p>
          </div>
        </div>
        <div
          className={`dropzone ${over ? "over" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            upload(e.dataTransfer.files?.[0]);
          }}
          role="button"
          tabIndex={0}
        >
          <Icon name="plus" size={28} className="c-brand" />
          <p className="t-body1s">{busy ? "올리는 중…" : "CSV 파일을 끌어다 놓거나 눌러서 선택"}</p>
          <p className="t-caption c-tertiary">email(필수) · name 또는 First/Last Name · Company · Job Title</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        {result?.error && <div className="notice warn">{result.error}</div>}
        {result && !result.error && (
          <div className={`notice ${result.invalid.length ? "warn" : "ok"}`}>
            <Icon name="check" size={18} />
            <span>
              새로 {result.added}명, 갱신 {result.updated}명 · 지금 명단 {result.total}명
              {result.invalid.length > 0 && (
                <>
                  <br />
                  건너뛴 행 {result.invalid.length}개: {result.invalid.slice(0, 5).map((r) => `${r.row}행(${r.reason})`).join(", ")}
                  {result.invalid.length > 5 ? " …" : ""}
                </>
              )}
            </span>
          </div>
        )}
        <p className="t-caption c-tertiary">가입하지 않은 사람의 명단은 행사 종료 30일 뒤 자동으로 지워져요. 명단을 넘긴다는 사실은 주최사가 참가자에게 알려야 해요.</p>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h2 className="t-title3">
            참가자 {att?.invited ?? 0}명 <span className="t-body2 c-tertiary">· 가입 {att?.joined ?? 0} · 체크인 {att?.checkedIn ?? 0} · 현장 {att?.walkIns ?? 0}</span>
          </h2>
          <div className="row">
            <input className="input" style={{ width: 200, padding: "8px 12px" }} placeholder="이름·이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="medium" disabled={!unsent || ev.status === "ended"} onClick={() => setConfirm(true)}>
              안내 메일 보내기 {unsent ? `(${unsent})` : ""}
            </Button>
          </div>
        </div>
        {!att ? (
          <Spinner />
        ) : att.attendees.length === 0 ? (
          <ErrorState title="아직 명단이 없어요" message="명단 없이도 행사는 진행돼요. 참가자는 입구 QR이나 행사용 키링으로 체크인해요." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>직함 · 소속</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const [tone, label] = status(a);
                  return (
                    <tr key={a.email}>
                      <td className="t-body2s">{a.name || "—"}</td>
                      <td className="c-secondary">{a.email}</td>
                      <td className="c-secondary">{[a.role, a.org].filter(Boolean).join(" · ") || "—"}</td>
                      <td>
                        <Chip tone={tone}>{label}</Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirm && (
        <Dialog title={`${unsent}명에게 안내 메일을 보낼까요?`} onClose={() => setConfirm(false)}>
          <p className="t-body2 c-secondary">“{ev.name}: 내 Meetcha 카드를 미리 만들어 두세요” 메일이 가요. 링크로 바로 가입되고, 명단의 이름·직함·소속이 미리 채워져요. 이미 보낸 사람에게는 다시 보내지 않아요.</p>
          <Button disabled={busy} onClick={sendInvites}>보내기</Button>
        </Dialog>
      )}
    </>
  );
}

// ---------- 키링 ----------
function Tags({ eventId, ev, reload }) {
  const toast = useToast();
  const [kind, setKind] = useState("static");
  const [count, setCount] = useState(50);
  const [label, setLabel] = useState(ev.name);
  const [uids, setUids] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  async function issue() {
    setBusy(true);
    try {
      const body = kind === "static" ? { kind, count: Number(count), label, eventId, format: "csv" } : { kind, uids: uids.split(/[\s,]+/).filter(Boolean), label, eventId, format: "csv" };
      const res = await api("/api/admin/tags", { method: "POST", body, raw: true });
      const blob = await res.blob();
      const n = (await blob.text()).trim().split(/\r?\n/).length - 1;
      saveBlob(blob, `meetcha-keyrings-${fileSafe(ev.name)}-${n}.csv`);
      setDone(n);
      toast(`키링 ${n}개를 발급했어요`);
      reload();
    } catch (e) {
      toast(e.message || "발급하지 못했어요. 입력을 확인해 주세요");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="stat-grid">
        <Stat label="발급한 키링" value={ev.tags.issued} unit="개" />
        <Stat label="참가자가 등록" value={ev.tags.claimed} unit="개" sub={ev.tags.issued ? `${Math.round((ev.tags.claimed / ev.tags.issued) * 100)}%` : null} />
      </div>
      <div className="panel">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="t-title3">행사용 키링 발급</h2>
          <p className="t-caption c-tertiary">이 행사로 발급한 키링은 등록 코드 없이, 처음 태그한 사람이 자기 것으로 등록하면서 바로 체크인돼요.</p>
        </div>
        <div className="segmented" style={{ maxWidth: 520 }}>
          <button aria-pressed={kind === "static"} onClick={() => setKind("static")}>일반 NFC (NTAG215 등)</button>
          <button aria-pressed={kind === "sun"} onClick={() => setKind("sun")}>위조 방지 칩 (NTAG 424)</button>
        </div>
        <div className="form-grid">
          {kind === "static" ? (
            <label className="form-label">
              수량 (최대 500)
              <input className="input" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
          ) : (
            <label className="form-label full">
              칩 UID 목록 (14자리, 줄바꿈이나 쉼표로 구분)
              <textarea className="input" rows={4} placeholder="04A1B2C3D4E5F6" value={uids} onChange={(e) => setUids(e.target.value)} />
            </label>
          )}
          <label className="form-label">
            라벨 (관리용)
            <input className="input" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </div>
        <div className="notice warn">
          <Icon name="lock" size={18} />
          <span>
            발급하면 <b>칩에 쓸 주소와 포장에 인쇄할 등록 코드</b>가 담긴 CSV 파일이 바로 내려받아져요. 보안을 위해 서버에는 원래 값을 남기지 않아서, <b>이 파일은 지금 한 번만</b> 받을 수 있어요.
          </span>
        </div>
        <Button className="fit" disabled={busy || (kind === "static" ? !(count >= 1 && count <= 500) : !uids.trim())} onClick={issue}>
          발급하고 CSV 받기
        </Button>
        {done != null && <div className="notice ok"><Icon name="check" size={18} /> 키링 {done}개 발급 완료. 내려받은 파일을 3D 프린팅·칩 기록 작업에 쓰세요.</div>}
      </div>
    </>
  );
}

// ---------- 체크인 ----------
function CheckIn({ eventId, ev }) {
  const toast = useToast();
  const [code, setCode] = useState(null);
  const [full, setFull] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [desk, setDesk] = useState(() => {
    try {
      return sessionStorage.getItem("meetcha-desk") === eventId;
    } catch {
      return false;
    }
  });
  const canvasRef = useRef(null);
  const bigRef = useRef(null);

  useEffect(() => {
    if (!code) return;
    const opts = { margin: 1, color: { dark: "#000215", light: "#ffffff" } };
    if (canvasRef.current) QRCode.toCanvas(canvasRef.current, code.url, { ...opts, width: 220 });
    if (full && bigRef.current) QRCode.toCanvas(bigRef.current, code.url, { ...opts, width: Math.min(window.innerWidth, window.innerHeight) * 0.55 });
  }, [code, full]);

  async function makeCode() {
    setConfirm(false);
    try {
      setCode(await post(`/api/admin/events/${eventId}/checkin-code`));
    } catch (e) {
      toast(e.message);
    }
  }
  async function toggleDesk() {
    const on = !desk;
    await post(`/api/admin/events/${eventId}/desk`, { on });
    try {
      if (on) sessionStorage.setItem("meetcha-desk", eventId);
      else sessionStorage.removeItem("meetcha-desk");
    } catch {
      /* 무시 */
    }
    setDesk(on);
    toast(on ? "이 기기가 체크인 데스크가 됐어요" : "데스크 모드를 껐어요");
  }
  async function savePng() {
    const c = document.createElement("canvas");
    await QRCode.toCanvas(c, code.url, { width: 1200, margin: 2 });
    c.toBlob((b) => saveBlob(b, `meetcha-checkin-${fileSafe(ev.name)}.png`));
  }

  return (
    <>
      <div className="panel">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="t-title3">입구 체크인 QR</h2>
          <p className="t-caption c-tertiary">참가자가 휴대폰 카메라로 찍으면 체크인 화면이 열려요. 키링을 처음 받는 사람은 키링 태그만으로도 체크인돼요.</p>
        </div>
        {code ? (
          <div className="qr-stage">
            <div className="qr-box">
              <canvas ref={canvasRef} />
            </div>
            <div className="stack" style={{ gap: 12 }}>
              <span className="t-caption c-tertiary">체크인 코드 (직접 입력용)</span>
              <span className="code-text">{code.checkinCode}</span>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Button size="medium" onClick={() => setFull(true)}>전체 화면으로 띄우기</Button>
                <Button size="medium" variant="neutral" onClick={savePng}>인쇄용 이미지 저장</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button className="fit" onClick={() => setConfirm(true)}>체크인 QR 만들기</Button>
        )}
        <p className="t-caption c-tertiary">보안상 코드는 만들 때만 볼 수 있어요. 다시 만들면 이전 코드와 인쇄해 둔 QR은 쓸 수 없게 돼요.</p>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="t-title3">체크인 데스크 모드</h2>
            <p className="t-caption c-tertiary">이미 키링이 있는 참가자(지난 행사에서 받은 사람)를 입구에서 체크인할 때 써요.</p>
          </div>
          <Button size="medium" variant={desk ? "secondary" : "primary"} onClick={toggleDesk}>
            {desk ? "데스크 모드 끄기" : "이 기기를 데스크로"}
          </Button>
        </div>
        <ol className="t-body2 c-secondary" style={{ margin: 0, paddingLeft: 20, lineHeight: "28px" }}>
          <li>입구에서 쓸 <b>운영진 휴대폰</b>으로 이 화면을 열고 데스크 모드를 켜요.</li>
          <li>참가자 키링에 그 휴대폰을 대면 도감에 저장되는 대신 <b>“OO님 체크인 완료”</b>가 떠요.</li>
          <li>행사 중 다른 사람을 만날 때는 꼭 꺼 주세요 (24시간 뒤 자동으로 꺼져요).</li>
        </ol>
        {desk && <div className="notice ok"><Icon name="nfc" size={18} /> 이 기기는 지금 {ev.name}의 체크인 데스크예요.</div>}
      </div>
      {confirm && (
        <Dialog title="체크인 QR을 만들까요?" onClose={() => setConfirm(false)}>
          <p className="t-body2 c-secondary">새 코드를 만들면 이전에 만든 코드와 인쇄한 QR은 더 이상 쓸 수 없어요.</p>
          <Button onClick={makeCode}>새로 만들기</Button>
        </Dialog>
      )}
      {full && code && (
        <div className="qr-full gradient-aurora grain" onClick={() => setFull(false)} role="dialog" aria-label="체크인 QR 전체 화면">
          <p className="t-title1">{ev.name}</p>
          <div className="qr-box" style={{ padding: 24 }}>
            <canvas ref={bigRef} />
          </div>
          <p className="t-title2">휴대폰 카메라로 찍고 체크인하세요</p>
          <p className="t-body1" style={{ opacity: 0.7 }}>코드 {code.checkinCode} · 화면을 누르면 닫혀요</p>
        </div>
      )}
    </>
  );
}

// ---------- 테마 ----------
function Theme({ eventId, ev, reload }) {
  const toast = useToast();
  const [f, setF] = useState({ logoUrl: ev.theme?.logoUrl || "", color: ev.theme?.color || "#E11D6C", welcome: ev.theme?.welcome || "" });
  const [error, setError] = useState("");
  async function save() {
    setError("");
    try {
      await put(`/api/admin/events/${eventId}/theme`, { logoUrl: f.logoUrl.trim() || undefined, color: f.color.toUpperCase(), welcome: f.welcome });
      toast("테마를 저장했어요");
      reload();
    } catch (e) {
      setError(e.message);
    }
  }
  const valid = /^#[0-9a-fA-F]{6}$/.test(f.color);
  return (
    <div className="panel">
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="t-title3">행사 테마</h2>
        <p className="t-caption c-tertiary">참가자 발견 보드의 강조색과 로고, 환영 문구가 바뀌어요. 퀴즈 정답·발견 같은 보상 순간은 Meetcha 연두를 그대로 써요.</p>
      </div>
      <div className="row" style={{ alignItems: "flex-start", gap: 32, flexWrap: "wrap" }}>
        <div className="stack grow" style={{ gap: 14, minWidth: 260 }}>
          <label className="form-label">
            로고 이미지 주소 (https)
            <input className="input" placeholder="https://…/logo.png" value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} />
          </label>
          <label className="form-label">
            강조색
            <span className="row">
              <input type="color" value={valid ? f.color : "#E11D6C"} onChange={(e) => setF({ ...f, color: e.target.value })} style={{ width: 48, height: 44, border: 0, background: "none", padding: 0 }} aria-label="색 고르기" />
              <input className="input" value={f.color} maxLength={7} onChange={(e) => setF({ ...f, color: e.target.value })} />
            </span>
          </label>
          <label className="form-label">
            환영 문구
            <input className="input" maxLength={200} placeholder="오늘 최소 5명과 인사해 보세요!" value={f.welcome} onChange={(e) => setF({ ...f, welcome: e.target.value })} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <Button className="fit" disabled={!valid} onClick={save}>저장</Button>
        </div>
        <div className="theme-preview" style={{ "--brand": valid ? f.color : "var(--brand)" }} aria-label="미리보기">
          <div className="row" style={{ padding: "16px 20px", gap: 12 }}>
            <div className="event-logo">{f.logoUrl ? <img src={f.logoUrl} alt="" /> : ev.name[0]}</div>
            <div className="grow">
              <p className="t-body2s">{ev.name}</p>
              <p className="t-caption c-tertiary">참가자 화면 미리보기</p>
            </div>
          </div>
          <div className="stack" style={{ padding: "4px 20px 20px", gap: 12 }}>
            {f.welcome && <p className="t-body2 c-secondary">{f.welcome}</p>}
            <p className="t-title2">
              24명 중 <span style={{ color: "var(--brand)" }}>7명</span>을 만났어요
            </p>
            <div className="progress"><i style={{ width: "30%", background: "var(--brand)" }} /></div>
            <button className="btn primary medium" style={{ width: "100%" }}>퀴즈 풀기</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 마무리 ----------
function Wrapup({ eventId, ev, report, reload }) {
  const toast = useToast();
  const [display, setDisplay] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const ended = ev.status === "ended";
  async function sendRecap() {
    setConfirm(null);
    try {
      const r = await post(`/api/admin/events/${eventId}/recap/send`);
      toast(`${r.sent}명에게 리캡 메일을 보냈어요`);
      reload();
    } catch (e) {
      toast(e.message);
    }
  }
  async function makeDisplay() {
    setConfirm(null);
    try {
      setDisplay(await post(`/api/admin/events/${eventId}/display`));
    } catch (e) {
      toast(e.message);
    }
  }
  const summary = report
    ? `[${ev.name}] Meetcha 리포트\n체크인 ${report.attendees}명 · 만남 ${report.encounters}번(정품 키링 ${report.verifiedEncounters}번)\n1인당 평균 ${report.avgPeopleMet}명과 만남 · 퀴즈 ${report.quizzesFinished}번 완료${report.avgQuizScore ? `(평균 ${report.avgQuizScore}점)` : ""} · 참가자끼리 메시지 ${report.messagesBetweenAttendees}개`
    : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      toast("리포트를 복사했어요");
    } catch {
      toast("복사하지 못했어요. 직접 선택해서 복사해 주세요");
    }
  }
  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="t-title3">고객사 리포트</h2>
            <p className="t-caption c-tertiary">개인을 알아볼 수 없는 통계만 담겨요.</p>
          </div>
          <Button size="medium" variant="neutral" disabled={!report} onClick={copy}>텍스트로 복사</Button>
        </div>
        <pre className="soft-card t-body2" style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{summary || "불러오는 중…"}</pre>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="t-title3">리캡 메일</h2>
            <p className="t-caption c-tertiary">“OO에서 N명을 만났어요” 메일과 리캡 화면 링크가 체크인한 모든 참가자에게 가요. 행사가 끝난 뒤 한 번만 보낼 수 있어요.</p>
          </div>
          <Button size="medium" disabled={!ended || !!ev.recapSentAt} onClick={() => setConfirm("recap")}>
            {ev.recapSentAt ? `${dateLabel(ev.recapSentAt)}에 보냄` : ended ? "리캡 메일 보내기" : "행사 종료 후 보낼 수 있어요"}
          </Button>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="t-title3">행사장 대형 화면</h2>
            <p className="t-caption c-tertiary">빔프로젝터·TV에 리더보드와 실시간 만남 수를 띄워요. 로그인 없이 링크로 열리고, 개인 알림은 나오지 않아요. 행사 종료 하루 뒤 만료돼요.</p>
          </div>
          <Button size="medium" onClick={() => (ev.hasDisplay || display ? setConfirm("display") : makeDisplay())}>
            {display ? "링크 다시 만들기" : "대형 화면 링크 만들기"}
          </Button>
        </div>
        {display && (
          <div className="row" style={{ flexWrap: "wrap" }}>
            <code className="soft-card t-body2 grow" style={{ wordBreak: "break-all" }}>{display.url}</code>
            <a className="btn primary medium" href={`/display/${display.token}`} target="_blank" rel="noreferrer">새 창으로 열기</a>
          </div>
        )}
      </div>
      {confirm === "recap" && (
        <Dialog title="리캡 메일을 보낼까요?" onClose={() => setConfirm(null)}>
          <p className="t-body2 c-secondary">체크인한 참가자 {report?.attendees ?? ""}명에게 한 번만 보낼 수 있어요.</p>
          <Button onClick={sendRecap}>보내기</Button>
        </Dialog>
      )}
      {confirm === "display" && (
        <Dialog title="링크를 다시 만들까요?" onClose={() => setConfirm(null)}>
          <p className="t-body2 c-secondary">이전 링크로 열어 둔 대형 화면은 바로 멈춰요.</p>
          <Button onClick={makeDisplay}>다시 만들기</Button>
        </Dialog>
      )}
    </>
  );
}

export default function AdminEvent() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "overview";
  const [ev, setEv] = useState(null);
  const [att, setAtt] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [list, a, r] = await Promise.all([get("/api/admin/events"), get(`/api/admin/events/${id}/attendees`), get(`/api/admin/events/${id}/report`)]);
      const e = list.events.find((x) => x.id === id);
      if (!e) throw Object.assign(new Error("행사를 찾을 수 없어요"), { code: "not_found" });
      setEv(e);
      setAtt(a);
      setReport(r);
    } catch (e) {
      setError(e);
    }
  }, [id]);
  useEffect(() => {
    reload();
  }, [reload]);
  // 진행 중이면 10초마다 숫자 갱신
  useEffect(() => {
    if (ev?.status !== "live") return;
    const t = setInterval(reload, 10_000);
    return () => clearInterval(t);
  }, [ev?.status, reload]);

  if (error) return <AdminShell><ErrorState message={error.message} action={<Link to="/admin" className="btn neutral medium">행사 목록</Link>} /></AdminShell>;
  if (!ev) return <AdminShell><Spinner /></AdminShell>;
  const [tone, label] = STATUS[ev.status];
  const props = { eventId: id, ev, att, report, reload };

  return (
    <AdminShell>
      <div className="stack" style={{ gap: 8 }}>
        <Link to="/admin" className="row t-body2s c-tertiary" style={{ gap: 2 }}>
          <Icon name="back" size={18} /> 행사
        </Link>
        <div className="page-head">
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 10 }}>
              <h1>{ev.name}</h1>
              <Chip tone={tone}>{label}</Chip>
            </div>
            <p className="t-body2 c-tertiary">
              {ev.client ? `${ev.client} · ` : ""}
              {dateLabel(ev.startsAt)} {timeRange(ev.startsAt, ev.endsAt)}
            </p>
          </div>
        </div>
      </div>
      {params.get("created") && tab === "overview" && (
        <div className="notice ok">
          <Icon name="check" size={18} />
          <span>
            행사를 만들었어요. 다음 순서로 준비해 보세요: <Link className="c-brand t-body2s" to="?tab=attendees">명단 올리기</Link> → <Link className="c-brand t-body2s" to="?tab=tags">키링 발급</Link> → <Link className="c-brand t-body2s" to="?tab=checkin">체크인 QR</Link>
          </span>
        </div>
      )}
      <nav className="tabs" aria-label="행사 메뉴">
        {TABS.map(([k, l]) => (
          <Link key={k} to={`?tab=${k}`} className={tab === k ? "active" : ""} replace>
            {l}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <Overview {...props} />}
      {tab === "attendees" && <Attendees {...props} />}
      {tab === "tags" && <Tags {...props} />}
      {tab === "checkin" && <CheckIn {...props} />}
      {tab === "theme" && <Theme {...props} />}
      {tab === "wrapup" && <Wrapup {...props} />}
    </AdminShell>
  );
}
