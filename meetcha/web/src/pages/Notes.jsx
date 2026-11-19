// F1 쪽지함: 받은 쪽지 / 보낸 쪽지. 쪽지를 누르면 바텀시트로 열리고 그때 읽음 처리. 답장은 새 쪽지.
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { get, post } from "../lib/api.js";
import { useSession } from "../lib/session.jsx";
import { roleLine } from "../lib/format.js";
import { Avatar, Button, ErrorState, Screen, Sheet, Spinner, TabBar } from "../components/ui.jsx";
import NoteSheet from "../components/NoteSheet.jsx";
import Icon from "../components/Icon.jsx";

// "방금", "5분 전", "어제", "11월 18일"
function when(ms) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return `${d.getHours() < 12 ? "오전" : "오후"} ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "어제";
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function ReadSheet({ note, box, onClose, onReply }) {
  const person = box === "sent" ? note.to : note.from;
  const canReply = box === "inbox" && !person.deleted;
  return (
    <Sheet onClose={onClose} label="쪽지">
      <div className="row" style={{ gap: 12 }}>
        <Avatar person={person} size="m" />
        <div className="grow">
          <p className="t-body1s">{box === "sent" ? `${person.name}님에게` : person.name}</p>
          <p className="t-caption c-tertiary">{[!person.limited && roleLine(person), when(note.at)].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <p className="note-body t-body1">{note.body}</p>
      <div className="row">
        {!person.deleted && (
          <Link to={`/u/${person.id}`} className="btn secondary" onClick={onClose}>
            명함 보기
          </Link>
        )}
        {canReply && <Button onClick={onReply}>답장 쓰기</Button>}
      </div>
    </Sheet>
  );
}

export default function Notes() {
  const { me, loading, refreshUnread } = useSession();
  const [box, setBox] = useState("inbox");
  // 목록이 어느 쪽지함 것인지 함께 기억한다. 탭을 바꾼 직후 이전 탭 목록을 새 탭 모양으로 그리지 않도록.
  const [data, setData] = useState({ box: null, notes: null });
  const notes = data.box === box ? data.notes : null;
  const setNotes = (fn) => setData((d) => ({ ...d, notes: fn(d.notes) }));
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // 읽는 쪽지
  const [replyTo, setReplyTo] = useState(null);

  const load = useCallback(() => {
    get(`/api/me/notes?box=${box}`).then((r) => setData({ box: r.box, notes: r.notes })).catch(setError);
  }, [box]);
  useEffect(() => {
    if (me) load();
  }, [me, load]);

  async function openNote(n) {
    setOpen(n);
    if (box === "inbox" && !n.read) {
      setNotes((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      try {
        await post(`/api/me/notes/${n.id}/read`);
      } finally {
        refreshUnread();
      }
    }
  }

  if (loading) return <Screen><Spinner /></Screen>;
  if (!me) return <Navigate to="/login?next=/notes" replace />;
  const unreadHere = box === "inbox" ? (notes || []).filter((n) => !n.read).length : 0;

  return (
    <Screen>
      <header style={{ padding: "16px 24px 8px" }}>
        <h1 className="t-title1">쪽지</h1>
      </header>
      <div className="content tight" style={{ paddingTop: 8 }}>
        <div className="segmented" role="group" aria-label="쪽지함">
          <button aria-pressed={box === "inbox"} onClick={() => setBox("inbox")}>
            받은 쪽지{unreadHere ? ` ${unreadHere}` : ""}
          </button>
          <button aria-pressed={box === "sent"} onClick={() => setBox("sent")}>
            보낸 쪽지
          </button>
        </div>
        {error && <ErrorState message={error.message} />}
        {!notes && !error && <Spinner />}
        {notes?.length === 0 && (
          <ErrorState
            title={box === "inbox" ? "아직 받은 쪽지가 없어요" : "아직 보낸 쪽지가 없어요"}
            message={box === "inbox" ? "만난 사람에게 먼저 인사를 남겨 보세요." : "도감에서 만난 사람의 명함을 열고 쪽지를 보내 보세요."}
            action={<Link to="/dex" className="btn neutral medium">도감 보기</Link>}
          />
        )}
        {notes?.length > 0 && (
          <div className="stack" style={{ gap: 0 }}>
            {notes.map((n) => {
              const p = box === "sent" ? n.to : n.from;
              const unread = box === "inbox" && !n.read;
              return (
                <button key={n.id} className={`list-item note-row ${unread ? "unread" : ""}`} onClick={() => openNote(n)}>
                  <Avatar person={p} size="m" />
                  <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="row between" style={{ gap: 8 }}>
                      <span className="t-body1s" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {box === "sent" ? `${p.name}님에게` : p.name}
                      </span>
                      <span className="t-caption c-tertiary" style={{ flex: "none" }}>{when(n.at)}</span>
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      <span className={`t-body2 ${unread ? "" : "c-tertiary"} preview`}>{n.body}</span>
                      {unread && <span className="dot" aria-label="안 읽음" />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <TabBar />
      {open && !replyTo && <ReadSheet note={open} box={box} onClose={() => setOpen(null)} onReply={() => setReplyTo(open.from)} />}
      {replyTo && (
        <NoteSheet
          person={replyTo}
          onClose={() => {
            setReplyTo(null);
            setOpen(null);
          }}
        />
      )}
    </Screen>
  );
}
