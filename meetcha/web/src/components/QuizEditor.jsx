// 내 퀴즈 만들기. 질문 템플릿부터 고르고, 정답은 보기 옆 체크 한 번.
import Icon from "./Icon.jsx";

export const TEMPLATES = ["제 주말 취미는?", "오늘 발표한 주제는?", "제 MBTI는?", "요즘 빠져 있는 것은?", "제가 사는 동네는?", "제 첫 직업은?"];
export const emptyQuestion = (i = 0) => ({ question: i === 0 ? TEMPLATES[0] : "", options: ["", "", "", ""], answer: 0 });

function QuestionCard({ q, onChange, onRemove }) {
  const set = (patch) => onChange({ ...q, ...patch });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="templates" role="group" aria-label="질문 예시">
        {TEMPLATES.map((t) => (
          <button key={t} aria-pressed={q.question === t} onClick={() => set({ question: t })}>
            {t}
          </button>
        ))}
      </div>
      <label className="box-field">
        <span className="stack grow" style={{ gap: 4 }}>
          <span className="label">질문</span>
          <input value={q.question} maxLength={120} placeholder="직접 써도 돼요" onChange={(e) => set({ question: e.target.value })} />
        </span>
        {onRemove && (
          <button className="icon-btn c-tertiary" onClick={onRemove} aria-label="이 문제 삭제">
            <Icon name="trash" size={20} />
          </button>
        )}
      </label>
      <div className="stack">
        {q.options.map((o, i) => (
          <div key={i} className={`answer-row ${q.answer === i ? "on" : ""}`}>
            <button className={`radio ${q.answer === i ? "on" : ""}`} onClick={() => set({ answer: i })} aria-label={`보기 ${i + 1}을 정답으로`} aria-pressed={q.answer === i}>
              <Icon name="check" size={14} />
            </button>
            <input
              value={o}
              maxLength={40}
              placeholder={`보기 ${i + 1}`}
              onChange={(e) => set({ options: q.options.map((x, k) => (k === i ? e.target.value : x)) })}
            />
            {q.answer === i && <span className="t-label c-brand">정답</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function QuizEditor({ quiz, onChange, single }) {
  return (
    <div className="stack" style={{ gap: 28 }}>
      {quiz.map((q, i) => (
        <QuestionCard
          key={i}
          q={q}
          onChange={(nq) => onChange(quiz.map((x, k) => (k === i ? nq : x)))}
          onRemove={!single && quiz.length > 1 ? () => onChange(quiz.filter((_, k) => k !== i)) : null}
        />
      ))}
      {!single && quiz.length < 5 && (
        <button className="btn neutral medium" style={{ width: "100%" }} onClick={() => onChange([...quiz, emptyQuestion(quiz.length)])}>
          <Icon name="plus" size={18} /> 문제 추가 ({quiz.length}/5)
        </button>
      )}
    </div>
  );
}
