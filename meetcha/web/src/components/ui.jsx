// 공용 화면 부품. Figma 컴포넌트(Button, Avatar, Chip, SlotCard, TopBar, ProgressBar, TabBar…)와 1:1.
import { createContext, useCallback, useContext, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { avatarColor, initial } from "../lib/format.js";
import { useSession } from "../lib/session.jsx";

export function Screen({ tone = "surface", className = "", children }) {
  return <div className={`screen ${tone === "surface" ? "" : tone} ${className}`}>{children}</div>;
}

export function TopBar({ type = "back", title, right, onBack }) {
  const nav = useNavigate();
  const back = onBack || (() => (window.history.length > 1 ? nav(-1) : nav("/")));
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={back} aria-label={type === "close" ? "닫기" : "뒤로"}>
        <Icon name={type === "close" ? "close" : "back"} />
      </button>
      <div className="title t-body1s">{title}</div>
      <div style={{ width: 40, display: "flex", justifyContent: "flex-end" }}>{right}</div>
    </header>
  );
}

export function Button({ variant = "primary", size, className = "", ...rest }) {
  return <button className={`btn ${variant} ${size || ""} ${className}`} {...rest} />;
}

export function Avatar({ person, size = "m" }) {
  const p = person || {};
  const style = p.photoUrl ? { backgroundImage: `url(${p.photoUrl})` } : { background: avatarColor(p.id) };
  return (
    <div className={`avatar ${size}`} style={style} aria-hidden="true">
      {!p.photoUrl && initial(p.name)}
    </div>
  );
}

export const Chip = ({ tone = "brand", children }) => <span className={`chip ${tone}`}>{children}</span>;

export function Progress({ value, total, thin, gradient = true }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className={`progress ${thin ? "thin" : ""}`} role="progressbar" aria-valuenow={value} aria-valuemax={total}>
      <i className={gradient ? "gradient-progress" : ""} style={{ width: `${pct}%`, background: gradient ? undefined : "var(--brand)" }} />
    </div>
  );
}

export function Slot({ slot, onClick, justFound }) {
  const no = String(slot.slot ?? "").padStart(2, "0");
  if (!slot.found)
    return (
      <button className="slot hidden" onClick={onClick} aria-label={`아직 못 만난 참가자${slot.hint ? `, 힌트 ${slot.hint}` : ""}`}>
        <span className="no">{no}</span>
        <span className="mark">?</span>
        <Chip tone="fog">{slot.hint || "???"}</Chip>
      </button>
    );
  const u = slot.user;
  return (
    <Link to={`/u/${u.id}`} className={`slot found ${justFound ? "just-found" : ""}`}>
      <span className="no">{no}</span>
      <span className="stack center" style={{ gap: 0 }}>
        <Avatar person={u} size="m" />
        <span className="name">{u.name}</span>
      </span>
      <span className="role">{u.role || u.org || " "}</span>
    </Link>
  );
}

export function TabBar() {
  const cls = ({ isActive }) => (isActive ? "active" : "");
  const { pathname } = useLocation();
  const { unread } = useSession() || {};
  // 행사 보드(/events/:id)도 '보드' 탭으로 친다. 리캡은 도감 쪽
  const onBoard = pathname === "/board" || (pathname.startsWith("/events/") && !pathname.endsWith("/recap"));
  return (
    <nav className="tabbar" aria-label="메뉴">
      <NavLink to="/board" className={() => (onBoard ? "active" : "")}>
        <Icon name="grid" />
        보드
      </NavLink>
      <NavLink to="/dex" className={cls}>
        <Icon name="book" />
        도감
      </NavLink>
      <NavLink to="/notes" className={cls} aria-label={unread ? `쪽지, 안 읽은 쪽지 ${unread}개` : "쪽지"}>
        <span className="tab-icon">
          <Icon name="note" />
          {unread > 0 && <span className="badge-count">{unread > 99 ? "99+" : unread}</span>}
        </span>
        쪽지
      </NavLink>
      <NavLink to="/me" className={cls}>
        <Icon name="user" />
        내 명함
      </NavLink>
    </nav>
  );
}

export function Sheet({ onClose, children, label }) {
  return (
    <>
      <div className="dim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="grab" />
        {children}
      </div>
    </>
  );
}

export const Spinner = () => <div className="spinner" role="status" aria-label="불러오는 중" />;

export function ErrorState({ title = "문제가 생겼어요", message, action }) {
  return (
    <div className="empty">
      <p className="t-title3">{title}</p>
      {message && <p className="t-body2 c-tertiary">{message}</p>}
      {action}
    </div>
  );
}

// ---------- 토스트 ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const show = useCallback((text, person) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs.slice(-2), { id, text, person }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.person ? "" : "plain"}`}>
            {t.person && <Avatar person={t.person} size="s" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
