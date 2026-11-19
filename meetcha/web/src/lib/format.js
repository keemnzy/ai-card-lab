const AVATAR_COLORS = ["#FF8A65", "#4FC3F7", "#81C784", "#BA68C8", "#FFD54F", "#F06292"];

/** 사람 ID로 항상 같은 아바타 색 */
export function avatarColor(id = "") {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const initial = (name = "") => (name.trim()[0] || "?").toUpperCase();

export const dateLabel = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export const timeRange = (start, end) => {
  const f = (ms) => {
    const d = new Date(ms);
    const h = d.getHours();
    const m = d.getMinutes();
    return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}시${m ? ` ${m}분` : ""}`;
  };
  return `${f(start)} ~ ${f(end)}`;
};

export const roleLine = (p) => [p.role, p.org].filter(Boolean).join(" · ");

export const vibrate = (pattern) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 지원 안 하는 기기 */
  }
};
