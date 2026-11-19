import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 중에는 API·태그·사진 요청을 Express 서버(3000)로 넘긴다.
// 서버는 APP_ORIGIN=http://localhost:5173 으로 띄워야 로그인 링크와 출처 검사가 맞는다.
const target = process.env.MEETCHA_API || "http://localhost:3000";
const proxy = Object.fromEntries(["/api", "/t", "/media", "/legal", "/healthz"].map((p) => [p, { target }]));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false },
});
