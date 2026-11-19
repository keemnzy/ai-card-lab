// H1 행사 목록·만들기
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { get, post } from "../lib/api.js";
import { dateLabel, timeRange } from "../lib/format.js";
import { Button, Chip, ErrorState, Spinner } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import { AdminShell, Dialog, STATUS } from "./AdminShell.jsx";

const pad = (n) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function CreateDialog({ onClose }) {
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", client: "", date: today(), start: "19:00", end: "22:00" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function create(e) {
    e.preventDefault();
    const startsAt = new Date(`${f.date}T${f.start}`).getTime();
    let endsAt = new Date(`${f.date}T${f.end}`).getTime();
    if (endsAt <= startsAt) endsAt += 86400_000; // 자정을 넘기는 행사
    setBusy(true);
    try {
      const r = await post("/api/admin/events", { name: f.name.trim(), client: f.client.trim(), startsAt, endsAt });
      nav(`/admin/events/${r.id}?created=1`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Dialog title="새 행사 만들기" onClose={onClose}>
      <form className="stack" style={{ gap: 14 }} onSubmit={create}>
        <label className="form-label">
          행사 이름
          <input className="input" autoFocus required maxLength={80} placeholder="GSSC 네트워킹 나이트" value={f.name} onChange={set("name")} />
        </label>
        <label className="form-label">
          고객사 (주최)
          <input className="input" maxLength={80} placeholder="GSSC" value={f.client} onChange={set("client")} />
        </label>
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <label className="form-label full">
            날짜
            <input className="input" type="date" required value={f.date} onChange={set("date")} />
          </label>
          <label className="form-label">
            시작
            <input className="input" type="time" required value={f.start} onChange={set("start")} />
          </label>
          <label className="form-label">
            종료
            <input className="input" type="time" required value={f.end} onChange={set("end")} />
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <Button disabled={busy || !f.name.trim()}>만들기</Button>
      </form>
    </Dialog>
  );
}

export default function AdminEvents() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    get("/api/admin/events").then((r) => setEvents(r.events)).catch(setError);
  }, []);
  const list = useMemo(() => (events || []).filter((e) => filter === "all" || e.status === filter), [events, filter]);
  const count = (s) => (events || []).filter((e) => e.status === s).length;

  return (
    <AdminShell>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>행사</h1>
          <p className="t-body2 c-tertiary">행사를 만들고, 명단·키링·체크인을 준비해요.</p>
        </div>
        <Button className="fit" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} /> 새 행사 만들기
        </Button>
      </div>
      <div className="segmented" style={{ maxWidth: 480 }} role="group" aria-label="상태">
        {[["all", `전체 ${events?.length ?? 0}`], ["live", `진행 중 ${count("live")}`], ["upcoming", `예정 ${count("upcoming")}`], ["ended", `종료 ${count("ended")}`]].map(([k, l]) => (
          <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {error && <ErrorState message={error.message} />}
      {!events && !error && <Spinner />}
      {events && list.length === 0 && (
        <div className="panel">
          <ErrorState title={events.length ? "해당하는 행사가 없어요" : "아직 행사가 없어요"} message="새 행사를 만들면 체크인 코드, 키링, 명단을 준비할 수 있어요." />
        </div>
      )}
      <div className="event-grid">
        {list.map((e) => {
          const [tone, label] = STATUS[e.status];
          return (
            <Link key={e.id} to={`/admin/events/${e.id}`} className="event-card">
              <div className="row between">
                <Chip tone={tone}>{label}</Chip>
                {e.theme?.color && <span className="swatch" style={{ background: e.theme.color }} title="행사 테마 색" />}
              </div>
              <div className="stack" style={{ gap: 2 }}>
                <p className="t-title3">{e.name}</p>
                <p className="t-caption c-tertiary">
                  {e.client ? `${e.client} · ` : ""}
                  {dateLabel(e.startsAt)} {timeRange(e.startsAt, e.endsAt)}
                </p>
              </div>
              <div className="nums">
                {[["명단", e.invited], ["체크인", e.checkedIn], ["만남", e.encounters], ["키링", `${e.tags.claimed}/${e.tags.issued}`]].map(([l, v]) => (
                  <span key={l} className="t-caption c-tertiary">
                    <b className="c-primary" style={{ color: "var(--text-primary)" }}>{v}</b>
                    {l}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </AdminShell>
  );
}
