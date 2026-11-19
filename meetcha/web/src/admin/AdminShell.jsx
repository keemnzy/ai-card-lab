// 운영진 콘솔 틀: 로그인·운영진 확인, 상단 메뉴, 공용 부품(통계 카드, 대화상자, 파일 저장).
import { Link, NavLink, Navigate, useLocation } from "react-router-dom";
import { useSession } from "../lib/session.jsx";
import { Spinner } from "../components/ui.jsx";
import Icon from "../components/Icon.jsx";
import "../styles/admin.css";

export function AdminShell({ children }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <div className="admin"><Spinner /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!me.isAdmin)
    return (
      <div className="admin">
        <div className="empty" style={{ paddingTop: 120 }}>
          <p className="t-title2">운영진만 볼 수 있어요</p>
          <p className="t-body2 c-tertiary">운영진 계정으로 로그인했는지 확인해 주세요. ({me.email})</p>
          <Link to="/" className="btn neutral medium">참가자 화면으로</Link>
        </div>
      </div>
    );
  const cls = ({ isActive }) => (isActive ? "active" : "");
  return (
    <div className="admin">
      <header className="admin-top">
        <Link to="/admin" className="brand">
          <Icon name="spark" size={18} className="c-brand" /> Meetcha <small>운영진 콘솔</small>
        </Link>
        <nav>
          <NavLink to="/admin" end className={({ isActive }) => (isActive || loc.pathname.startsWith("/admin/events") ? "active" : "")}>
            행사
          </NavLink>
          <NavLink to="/admin/reports" className={cls}>
            신고
          </NavLink>
        </nav>
        <span className="who t-caption c-tertiary">{me.name || me.email}</span>
        <Link to="/" className="btn neutral medium fit" style={{ height: 36 }}>
          참가자 화면
        </Link>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}

export function Stat({ label, value, unit, sub, hl }) {
  return (
    <div className={`stat-card ${hl ? "hl" : ""}`}>
      <span className="t-caption c-tertiary">{label}</span>
      <span className="v">
        {value ?? "—"}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="t-caption c-tertiary">{sub}</span>}
    </div>
  );
}

export function Dialog({ title, children, onClose }) {
  return (
    <div className="dialog-wrap" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between">
          <h2 className="t-title2">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 파일 이름에 쓸 수 있게: 영문·숫자·하이픈만 (한글 이름은 일부 브라우저에서 "download"로 바뀜) */
export const fileSafe = (s) => s.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "event";

export function saveBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const STATUS = { live: ["success", "● 진행 중"], upcoming: ["brand", "예정"], ended: ["neutral", "종료"] };
