// Express 앱 조립. 테스트에서도 같은 함수로 앱을 만든다.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { HttpError, createLimiter, loadSession } from "./lib.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";
import { socialRoutes } from "./routes/social.js";
import { quizRoutes } from "./routes/quiz.js";
import { tagRoutes } from "./routes/tags.js";
import { eventRoutes } from "./routes/events.js";
import { adminRoutes } from "./routes/admin.js";
import { createBus, createMeet } from "./realtime.js";

const LEGAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../legal");

export function createApp({ db, cfg, mailer, now, limit = createLimiter() }) {
  const app = express();
  const bus = createBus();
  const deps = { db, cfg, mailer, limit, now, bus, meet: createMeet(db, bus) };

  app.disable("x-powered-by");
  app.set("trust proxy", cfg.trustProxy);

  // 보안 헤더. 인라인 스크립트는 요청마다 바뀌는 nonce가 있어야만 실행된다.
  app.use((req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString("base64");
    res.set({
      "Content-Security-Policy": `default-src 'self'; script-src 'nonce-${res.locals.nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      ...(cfg.secureCookies ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    });
    next();
  });

  // CSRF 방어: Origin이 있으면 우리 도메인이어야 하고, POST는 JSON만 받는다.
  // (SameSite=Lax 쿠키와 함께 이중 방어)
  app.use("/api", (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    // HTML form은 GET/POST만 보낼 수 있으므로 POST는 반드시 JSON. PUT/DELETE는 브라우저가 사전 요청(CORS)으로 막는다.
    if (req.method === "POST" && !req.is("application/json")) return next(new HttpError(415, "json_required", "Content-Type: application/json 이 필요해요"));
    const origin = req.get("origin");
    if (origin && origin !== cfg.origin) return next(new HttpError(403, "bad_origin", "허용되지 않은 출처예요"));
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.use(loadSession(db));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  // 약관·개인정보처리방침 원문 (?lang=en 이면 영문). 정식 화면이 생기면 그쪽에서 보기 좋게 렌더링한다.
  const LEGAL = { terms: "terms-of-service", privacy: "privacy-policy" };
  app.get("/legal/:doc", (req, res, next) => {
    const name = LEGAL[req.params.doc];
    if (!name) return next();
    const file = path.join(LEGAL_DIR, `${name}${req.query.lang === "en" ? ".en" : ""}.md`);
    res.type("text/plain; charset=utf-8").sendFile(file, (err) => err && next(new HttpError(404, "not_found", "문서를 찾을 수 없어요")));
  });
  app.use(authRoutes(deps));
  app.use(meRoutes(deps));
  app.use(socialRoutes(deps));
  app.use(quizRoutes(deps));
  app.use(tagRoutes(deps));
  app.use(eventRoutes(deps));
  app.use(adminRoutes(deps));

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "not_found", "없는 API예요")));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === "entity.parse.failed") err = new HttpError(400, "invalid_json", "JSON 형식이 올바르지 않아요");
    if (err.type === "entity.too.large") err = new HttpError(413, "too_large", "요청이 너무 커요");
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.code || "server_error", message: status === 500 ? "서버 오류가 났어요" : err.message });
  });
  return app;
}
