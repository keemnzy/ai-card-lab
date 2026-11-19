// 라이트/다크 모드. 기본은 휴대폰 설정을 따르고, 내 명함 > 설정에서 바꿀 수 있다.
const KEY = "meetcha-theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function getThemePref() {
  try {
    return localStorage.getItem(KEY) || "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref = getThemePref()) {
  const dark = pref === "dark" || (pref === "system" && media?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemePref(pref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* 저장 못 해도 이번 화면에는 적용 */
  }
  applyTheme(pref);
}

media?.addEventListener?.("change", () => applyTheme());
