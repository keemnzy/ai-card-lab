// 퀴즈 풀기. 정답은 서버에만 있고, 채점과 속도 점수 계산도 서버가 한다.
import { Router } from "express";
import { randomId } from "../crypto.js";
import { HttpError, forbidden, int, notFound, requireUser } from "../lib.js";
import { hasScanned } from "../encounters.js";
import { loadQuiz } from "./me.js";

export const LIMIT_MS = 10_000; // 문제당 제한 시간
const GRACE_MS = 1_500; // 네트워크 지연 여유

/** 정답일 때 500~1000점. 빨리 맞힐수록 높다. */
export function points(correct, elapsedMs) {
  if (!correct || elapsedMs > LIMIT_MS + GRACE_MS) return 0;
  const t = Math.min(Math.max(elapsedMs, 0), LIMIT_MS);
  return Math.round(1000 * (1 - t / LIMIT_MS / 2));
}

const publicQuestion = (q, index, total) => ({ index, total, question: q.question, options: q.options, limitMs: LIMIT_MS });

export function quizRoutes({ db, now = () => Date.now() }) {
  const r = Router();

  r.post("/api/users/:id/quiz/attempts", requireUser, (req, res) => {
    const ownerId = req.params.id;
    if (!hasScanned(db, req.user.id, ownerId)) throw forbidden("not_met", "도감에 있는 사람의 퀴즈만 풀 수 있어요");
    const quiz = loadQuiz(db, ownerId);
    if (!quiz.length) throw notFound();
    const id = randomId();
    db.prepare("INSERT INTO quiz_attempts (id, scanner_id, owner_id, questions, issued_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      req.user.id,
      ownerId,
      JSON.stringify(quiz),
      now(),
    );
    res.status(201).json({ attemptId: id, question: publicQuestion(quiz[0], 0, quiz.length) });
  });

  r.post("/api/quiz/attempts/:aid/answer", requireUser, (req, res) => {
    const a = db.prepare("SELECT * FROM quiz_attempts WHERE id = ? AND scanner_id = ?").get(req.params.aid, req.user.id);
    if (!a) throw notFound();
    if (a.finished_at) throw new HttpError(409, "finished", "이미 끝난 퀴즈예요");
    const quiz = JSON.parse(a.questions);
    const q = quiz[a.idx];
    // choice = -1 은 시간 초과
    const choice = int(req.body?.choice, "choice", { min: -1, max: 3 });
    const t = now();
    const correct = choice === q.answer;
    const pts = points(correct, t - a.issued_at);
    const score = a.score + pts;
    const right = a.correct + (pts > 0 ? 1 : 0);
    const nextIdx = a.idx + 1;
    const done = nextIdx >= quiz.length;
    db.prepare("UPDATE quiz_attempts SET idx = ?, issued_at = ?, score = ?, correct = ?, finished_at = ? WHERE id = ?").run(
      nextIdx,
      t,
      score,
      right,
      done ? t : null,
      a.id,
    );
    if (done)
      db.prepare("UPDATE encounters SET best_score = MAX(COALESCE(best_score, 0), ?) WHERE scanner_id = ? AND owner_id = ?").run(
        score,
        a.scanner_id,
        a.owner_id,
      );
    res.json({
      correct: pts > 0,
      correctIndex: q.answer,
      points: pts,
      score,
      done,
      ...(done ? { result: { score, correct: right, total: quiz.length } } : { next: publicQuestion(quiz[nextIdx], nextIdx, quiz.length) }),
    });
  });

  return r;
}
