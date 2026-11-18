// 암호 관련 유틸: 토큰 생성, 해시, AES-CMAC(RFC 4493), NTAG 424 DNA SUN 메시지 검증(NXP AN12196).
import crypto from "node:crypto";

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const randomId = () => crypto.randomBytes(9).toString("base64url"); // 12자
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// ---------- AES-128-CMAC (RFC 4493) ----------
function aesBlock(key, block) {
  const c = crypto.createCipheriv("aes-128-ecb", key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ b[i]));
function shiftLeft(b) {
  const out = Buffer.alloc(16);
  for (let i = 0, carry = 0; i < 16; i++) {
    const j = 15 - i;
    out[j] = ((b[j] << 1) | carry) & 0xff;
    carry = b[j] >> 7;
  }
  return out;
}
function subkeys(key) {
  const L = aesBlock(key, Buffer.alloc(16));
  const k1 = shiftLeft(L);
  if (L[0] & 0x80) k1[15] ^= 0x87;
  const k2 = shiftLeft(k1);
  if (k1[0] & 0x80) k2[15] ^= 0x87;
  return [k1, k2];
}
export function cmac(key, msg) {
  const [k1, k2] = subkeys(key);
  const n = Math.max(1, Math.ceil(msg.length / 16));
  const complete = msg.length > 0 && msg.length % 16 === 0;
  let last;
  if (complete) last = xor(msg.subarray((n - 1) * 16), k1);
  else {
    const p = Buffer.alloc(16);
    msg.copy(p, 0, (n - 1) * 16);
    p[msg.length - (n - 1) * 16] = 0x80;
    last = xor(p, k2);
  }
  let x = Buffer.alloc(16);
  for (let i = 0; i < n - 1; i++) x = aesBlock(key, xor(x, msg.subarray(i * 16, i * 16 + 16)));
  return aesBlock(key, xor(x, last));
}

// ---------- NTAG 424 DNA SUN (Secure Unique NFC) ----------
// 칩이 태그될 때마다 URL에 붙여 주는 값:
//   e = 암호화된 PICCData (UID 7바이트 + 읽기 카운터 3바이트), 32 hex
//   c = 잘린 CMAC, 16 hex
// metaKey: 모든 칩 공통 K_SDMMetaRead. fileKeyFor(uid): 칩별 K_SDMFileRead.

/** 칩별 파일 키를 마스터 키에서 파생. 칩에 키를 쓸 때(프로비저닝)도 같은 함수를 써야 한다. */
export function deriveTagKey(masterKey, uid) {
  return cmac(masterKey, Buffer.concat([Buffer.from([0x01]), uid, Buffer.from("meetcha-sdm-file")]));
}

/**
 * SUN 메시지를 검증한다. 성공하면 { uid: "04DE...", counter: 61 }, 실패하면 null.
 * 카운터 재사용(복사된 링크) 여부는 호출하는 쪽에서 DB의 마지막 카운터와 비교한다.
 */
export function verifySun(e, c, { metaKey, fileKeyFor }) {
  if (!/^[0-9a-fA-F]{32}$/.test(e || "") || !/^[0-9a-fA-F]{16}$/.test(c || "")) return null;
  const d = crypto.createDecipheriv("aes-128-cbc", metaKey, Buffer.alloc(16));
  d.setAutoPadding(false);
  const picc = Buffer.concat([d.update(Buffer.from(e, "hex")), d.final()]);
  const tag = picc[0];
  // bit7 = UID 미러링, bit6 = 카운터 미러링, 하위 4비트 = UID 길이(7)
  if ((tag & 0xc0) !== 0xc0 || (tag & 0x0f) !== 7) return null;
  const uid = picc.subarray(1, 8);
  const ctrBytes = picc.subarray(8, 11);
  const counter = ctrBytes[0] | (ctrBytes[1] << 8) | (ctrBytes[2] << 16);

  const sv2 = Buffer.concat([Buffer.from("3CC300010080", "hex"), uid, ctrBytes]);
  const sessionKey = cmac(fileKeyFor(uid), sv2);
  const full = cmac(sessionKey, Buffer.alloc(0));
  const mac = Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => full[i]));
  if (!safeEqual(mac, Buffer.from(c, "hex"))) return null;
  return { uid: uid.toString("hex").toUpperCase(), counter };
}

/** 칩이 만드는 것과 같은 SUN 값(e, c)을 만든다. 테스트와 개발용 시뮬레이터에서 사용. */
export function encodeSun(uidHex, counter, { metaKey, fileKey }) {
  const uid = Buffer.from(uidHex, "hex");
  const ctrBytes = Buffer.from([counter & 0xff, (counter >> 8) & 0xff, (counter >> 16) & 0xff]);
  const picc = Buffer.concat([Buffer.from([0xc7]), uid, ctrBytes, crypto.randomBytes(5)]);
  const enc = crypto.createCipheriv("aes-128-cbc", metaKey, Buffer.alloc(16));
  enc.setAutoPadding(false);
  const e = Buffer.concat([enc.update(picc), enc.final()]).toString("hex").toUpperCase();
  const sv2 = Buffer.concat([Buffer.from("3CC300010080", "hex"), uid, ctrBytes]);
  const full = cmac(cmac(fileKey, sv2), Buffer.alloc(0));
  const c = Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => full[i])).toString("hex").toUpperCase();
  return { e, c };
}
