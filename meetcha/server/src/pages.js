// 서버에서 바로 그리는 최소 HTML 페이지 (로그인 확인, 태그 후 프로필 카드).
// 정식 프론트엔드가 붙기 전까지 NFC 태그 → 프로필 흐름이 실제로 동작하게 하는 용도.
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 이메일로 로그인 링크를 받는 상자 (태그 후 페이지들에서 공용) */
export function loginBox(nonce, title) {
  return `<div class="card"><b>${esc(title)}</b>
    <input id="email" type="email" placeholder="이메일" style="font:inherit;padding:10px;border-radius:8px;border:1px solid var(--line)">
    <button id="send">로그인 링크 받기</button><p id="msg" class="muted"></p></div>
    <script nonce="${nonce}">
      document.getElementById("send").onclick = async () => {
        const r = await fetch("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: document.getElementById("email").value }) });
        const j = await r.json();
        document.getElementById("msg").textContent = r.ok ? "메일함을 확인하세요. 15분 안에 링크를 눌러 주세요." : j.message;
      };
    </script>`;
}

export function page(title, body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Meetcha</title>
<style>
:root{--bg:#eef0f7;--card:#fff;--fg:#161a2e;--muted:#5d6280;--accent:#4b3cf0;--line:#cfd3e4}
@media (prefers-color-scheme:dark){:root{--bg:#0f1120;--card:#191c33;--fg:#eceefb;--muted:#9ba0c3;--accent:#7b6dff;--line:#2e3358;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Noto Sans KR",sans-serif}
main{max-width:440px;margin:0 auto;padding:24px 16px;display:flex;flex-direction:column;gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px}
h1{font-size:24px;margin:0}.muted{color:var(--muted);font-size:14px}
a.chip{display:inline-block;padding:6px 10px;border-radius:8px;background:var(--bg);color:var(--fg);text-decoration:none;margin:0 6px 6px 0;font-size:14px}
button,.btn{font:inherit;font-weight:700;border:0;border-radius:10px;padding:12px 16px;background:var(--accent);color:#fff;text-decoration:none;text-align:center;cursor:pointer}
</style></head><body><main>${body}</main></body></html>`;
}
