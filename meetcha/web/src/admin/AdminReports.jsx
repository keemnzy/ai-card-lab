// H8 신고 처리: 신고가 많이 쌓인 사람 먼저. 기각 / 조치 완료 / 이용 정지·해제.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../lib/api.js";
import { dateLabel } from "../lib/format.js";
import { Button, Chip, ErrorState, Spinner, useToast } from "../components/ui.jsx";
import { AdminShell, Dialog } from "./AdminShell.jsx";

const REASON = { harassment: "괴롭힘·원치 않는 연락", spam: "스팸·광고", impersonation: "사칭", inappropriate: "부적절한 내용", other: "기타" };
const PERIODS = [[1, "1일"], [7, "7일"], [30, "30일"], [null, "영구"]];

function SuspendDialog({ report, onClose, onDone }) {
  const [days, setDays] = useState(7);
  const [reason, setReason] = useState(REASON[report.reason]);
  const [error, setError] = useState("");
  async function go() {
    try {
      await post(`/api/admin/users/${report.target.id}/suspend`, days ? { days, reason } : { reason });
      await post(`/api/admin/reports/${report.id}/resolve`, { status: "actioned", note: `${days ? `${days}일` : "영구"} 정지: ${reason}` });
      onDone(`${report.target.name}님을 ${days ? `${days}일` : "영구"} 정지했어요`);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Dialog title={`${report.target.name}님 이용 정지`} onClose={onClose}>
      <p className="t-body2 c-secondary">정지하면 바로 로그아웃되고, 명함은 이름만 보이며, 키링을 태그해도 열리지 않아요. 행사 보드와 리더보드에서도 빠져요.</p>
      <div className="segmented">
        {PERIODS.map(([d, l]) => (
          <button key={l} aria-pressed={days === d} onClick={() => setDays(d)}>{l}</button>
        ))}
      </div>
      <label className="form-label">
        정지 사유 (기록용)
        <input className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <Button disabled={!reason.trim()} onClick={go}>정지하기</Button>
    </Dialog>
  );
}

export default function AdminReports() {
  const toast = useToast();
  const [status, setStatus] = useState("open");
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [suspending, setSuspending] = useState(null);
  const load = useCallback(() => {
    setList(null);
    get(`/api/admin/reports?status=${status}`).then((r) => setList(r.reports)).catch(setError);
  }, [status]);
  useEffect(load, [load]);

  async function resolve(r, st) {
    try {
      await post(`/api/admin/reports/${r.id}/resolve`, { status: st, note: st === "dismissed" ? "문제없음" : "확인함" });
      toast(st === "dismissed" ? "기각했어요" : "조치 완료로 옮겼어요");
      load();
    } catch (e) {
      toast(e.message);
    }
  }
  async function unsuspend(r) {
    await post(`/api/admin/users/${r.target.id}/unsuspend`);
    toast(`${r.target.name}님의 정지를 풀었어요`);
    load();
  }
  const suspended = (r) => r.target.suspendedUntil && r.target.suspendedUntil > Date.now();

  return (
    <AdminShell>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>신고</h1>
          <p className="t-body2 c-tertiary">신고가 많이 쌓인 사람이 위에 보여요. 신고 기록은 접수 1년 뒤 자동으로 지워져요.</p>
        </div>
      </div>
      <div className="segmented" style={{ maxWidth: 420 }}>
        {[["open", "처리 전"], ["actioned", "조치함"], ["dismissed", "기각"]].map(([k, l]) => (
          <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      {error && <ErrorState message={error.message} />}
      {!list && !error && <Spinner />}
      {list?.length === 0 && <div className="panel"><ErrorState title={status === "open" ? "처리할 신고가 없어요" : "아직 없어요"} message={status === "open" ? "평화로운 행사네요 🙌" : null} /></div>}
      {list?.map((r) => (
        <div key={r.id} className="panel" style={{ gap: 12 }}>
          <div className="panel-head">
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Link to={`/u/${r.target.id}`} className="t-title3">{r.target.name}</Link>
              {r.target.openReports > 1 && <Chip tone="brand">처리 전 신고 {r.target.openReports}건</Chip>}
              {suspended(r) && <Chip tone="neutral">정지 중 · {r.target.suspendedUntil > 8e15 ? "영구" : `${dateLabel(r.target.suspendedUntil)}까지`}</Chip>}
            </div>
            <span className="t-caption c-tertiary">{dateLabel(r.createdAt)} · 신고한 사람 {r.reporter.name || "이름 없음"}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Chip tone="neutral">{REASON[r.reason]}</Chip>
          </div>
          {r.detail && <p className="soft-card t-body2">{r.detail}</p>}
          {r.note && <p className="t-caption c-tertiary">처리 메모: {r.note}</p>}
          <div className="row" style={{ flexWrap: "wrap" }}>
            {status === "open" && (
              <>
                <Button size="medium" variant="neutral" onClick={() => resolve(r, "dismissed")}>기각</Button>
                <Button size="medium" variant="secondary" onClick={() => resolve(r, "actioned")}>조치 완료</Button>
                {!suspended(r) && <Button size="medium" onClick={() => setSuspending(r)}>이용 정지</Button>}
              </>
            )}
            {suspended(r) && <Button size="medium" variant="neutral" onClick={() => unsuspend(r)}>정지 해제</Button>}
          </div>
        </div>
      ))}
      {suspending && (
        <SuspendDialog
          report={suspending}
          onClose={() => setSuspending(null)}
          onDone={(msg) => {
            setSuspending(null);
            toast(msg);
            load();
          }}
        />
      )}
    </AdminShell>
  );
}
