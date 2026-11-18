// 환경 변수 → 설정. 비밀 값(칩 키)은 코드나 저장소에 넣지 말고 환경 변수로만 넣는다.
function hexKey(name, v) {
  if (!v) return null;
  if (!/^[0-9a-fA-F]{32}$/.test(v)) throw new Error(`${name}는 16바이트(32자리 hex)여야 해요`);
  return Buffer.from(v, "hex");
}

export function loadConfig(env = process.env) {
  const origin = (env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
  const cfg = {
    port: Number(env.PORT || 3000),
    origin,
    dbPath: env.DB_PATH || "meetcha.db",
    uploadDir: env.UPLOAD_DIR || "uploads",
    secureCookies: origin.startsWith("https://"),
    trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : false,
    adminEmails: (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    sunMetaKey: hexKey("SUN_META_KEY", env.SUN_META_KEY),
    sunMasterKey: hexKey("SUN_MASTER_KEY", env.SUN_MASTER_KEY),
    production: env.NODE_ENV === "production",
  };
  if (cfg.production && !cfg.secureCookies) throw new Error("운영 환경에서는 APP_ORIGIN이 https:// 여야 해요");
  return cfg;
}
