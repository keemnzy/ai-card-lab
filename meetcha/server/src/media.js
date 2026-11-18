// 프로필 사진과 공유 이미지.
// 사진은 받은 그대로 저장하지 않는다: 회전 보정 → 512×512로 자르기 → WebP로 다시 인코딩.
// 이 과정에서 EXIF(촬영 위치, 기기 정보 등) 메타데이터가 모두 빠진다.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { randomId } from "./crypto.js";

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const MEDIA_NAME_RE = /^[A-Za-z0-9_-]{12}\.webp$/;

/** 로컬 디스크 저장소. 운영에서는 같은 모양(put/del/path)으로 S3 등 객체 저장소 구현을 넣는다. */
export function createDiskStorage(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    async put(name, buf) {
      await fs.promises.writeFile(path.join(dir, name), buf);
    },
    async del(name) {
      if (MEDIA_NAME_RE.test(name)) await fs.promises.rm(path.join(dir, name), { force: true });
    },
    path: (name) => path.join(dir, name),
  };
}

/** 업로드된 사진을 안전한 WebP로 바꾼다. 이미지가 아니거나 너무 크면 null. */
export async function processPhoto(buf) {
  try {
    const out = await sharp(buf, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate() // EXIF 방향대로 돌린 뒤 메타데이터는 버린다 (sharp는 기본으로 메타데이터를 남기지 않음)
      .resize(512, 512, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
    return { name: `${randomId()}.webp`, buf: out };
  } catch {
    return null;
  }
}

export const photoUrl = (photo) => (photo ? `/media/${photo}` : null);

// ---------- 리캡 공유 이미지 ----------
const xml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

/** 배경색에 따라 읽히는 글자색 (WCAG 상대 휘도 기준) */
function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#161a2e" : "#ffffff";
}

// 서버에 한글 글꼴이 있어야 한다 (예: Debian/Ubuntu의 fonts-noto-cjk)
const FONT = "Noto Sans CJK KR, Noto Sans KR, WenQuanYi Zen Hei, Apple SD Gothic Neo, sans-serif";

/**
 * 1080×1350 공유 이미지. 만난 사람의 이름·얼굴은 넣지 않는다 (그 사람들이 공유에 동의한 적 없음).
 * 대신 가려진 카드/공개된 카드 모양으로 몇 명을 만났는지 보여 준다.
 */
export async function recapImage({ eventName, color, metCount, metMeCount, lang = "ko" }) {
  const bg = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#4b3cf0";
  const fg = textOn(bg);
  const t =
    lang === "en"
      ? { line1: "I met", unit: metCount === 1 ? "person" : "people", line2: `${metMeCount} tapped my key ring`, foot: "Remembered with Meetcha" }
      : { line1: "에서", unit: "명을 만났어요", line2: `${metMeCount}명이 내 키링을 태그했어요`, foot: "Meetcha로 기억하기" };
  // 카드 격자: 최대 12장(4열 × 최대 3줄), 만난 수만큼 앞면(공개). 줄 수에 맞춰 카드 크기를 줄인다.
  const cols = 4, gap = 28, top = 650, areaH = 520;
  const total = Math.min(12, Math.max(8, Math.ceil(metCount / cols) * cols));
  const rows = Math.ceil(total / cols);
  const h = Math.min(240, (areaH - (rows - 1) * gap) / rows), w = h * 0.75;
  const x0 = (1080 - (cols * w + (cols - 1) * gap)) / 2;
  const cards = Array.from({ length: total }, (_, i) => {
    const x = x0 + (i % cols) * (w + gap), y = top + Math.floor(i / cols) * (h + gap);
    const open = i < metCount;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${open ? fg : "none"}" fill-opacity="${open ? 0.92 : 0}" stroke="${fg}" stroke-opacity="0.55" stroke-width="4" ${open ? "" : 'stroke-dasharray="14 12"'}/>
      <text x="${x + w / 2}" y="${y + h / 2 + h * 0.13}" font-size="${Math.round(h * 0.38)}" text-anchor="middle" font-family="${FONT}" fill="${open ? bg : fg}" fill-opacity="${open ? 1 : 0.55}">${open ? "✓" : "?"}</text>`;
  }).join("");
  const more = metCount > 12 ? `<text x="${1080 - x0}" y="${top + areaH + 50}" font-size="36" text-anchor="end" font-family="${FONT}" fill="${fg}" fill-opacity="0.8">+${metCount - 12}</text>` : "";
  const name = lang === "en" ? (eventName.length > 26 ? eventName.slice(0, 25) + "…" : eventName) : eventName.length > 15 ? eventName.slice(0, 14) + "…" : eventName;
  const headline =
    lang === "en"
      ? `<text x="90" y="230" font-size="64" font-family="${FONT}" fill="${fg}" fill-opacity="0.85">${t.line1}</text>
         <text x="90" y="410" font-size="200" font-weight="700" font-family="${FONT}" fill="${fg}">${metCount}<tspan font-size="72" dx="24">${t.unit}</tspan></text>
         <text x="90" y="490" font-size="56" font-family="${FONT}" fill="${fg}">at ${xml(name)}</text>`
      : `<text x="90" y="250" font-size="60" font-weight="700" font-family="${FONT}" fill="${fg}">${xml(name)}<tspan font-weight="400" fill-opacity="0.85">${t.line1}</tspan></text>
         <text x="90" y="470" font-size="200" font-weight="700" font-family="${FONT}" fill="${fg}">${metCount}<tspan font-size="68" dx="20">${t.unit}</tspan></text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
    <rect width="1080" height="1350" fill="${bg}"/>
    ${headline}
    <text x="90" y="570" font-size="40" font-family="${FONT}" fill="${fg}" fill-opacity="0.8">${xml(t.line2)}</text>
    ${cards}${more}
    <text x="90" y="1270" font-size="38" font-family="${FONT}" fill="${fg}" fill-opacity="0.75">${xml(t.foot)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
