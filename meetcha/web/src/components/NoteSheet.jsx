// 쪽지 쓰기 (바텀시트). 명함 화면, 퀴즈 결과, 쪽지함 답장에서 같이 쓴다.
import { useState } from "react";
import { post } from "../lib/api.js";
import { Avatar, Button, Sheet, useToast } from "./ui.jsx";

export const NOTE_MAX = 500;

export default function NoteSheet({ person, onClose, onSent }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  async function send() {
    setBusy(true);
    setError("");
    try {
      await post(`/api/users/${person.id}/messages`, { body: body.trim() });
      toast(`${person.name}님에게 쪽지를 보냈어요`);
      onSent?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet onClose={onClose} label="쪽지 쓰기">
      <div className="row" style={{ gap: 12 }}>
        <Avatar person={person} size="m" />
        <div className="grow">
          <p className="t-caption c-tertiary">받는 사람</p>
          <h2 className="t-title3">{person.name}님에게 쪽지</h2>
        </div>
      </div>
      <label className="box-field" style={{ alignItems: "flex-start" }}>
        <textarea rows={5} maxLength={NOTE_MAX} autoFocus placeholder="오늘 반가웠어요! 다음에 커피 한잔해요" value={body} onChange={(e) => setBody(e.target.value)} aria-label="쪽지 내용" />
      </label>
      <p className="t-caption c-tertiary" style={{ textAlign: "right", marginTop: -12 }}>
        {body.length} / {NOTE_MAX}
      </p>
      {error && <p className="error-text">{error}</p>}
      <Button disabled={!body.trim() || busy} onClick={send}>
        {busy ? "보내는 중…" : "보내기"}
      </Button>
    </Sheet>
  );
}
