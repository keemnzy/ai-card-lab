// 서버 API 호출. 같은 주소에서 서비스되므로 로그인 쿠키가 자동으로 붙는다.
// POST는 서버의 출처 검사 규칙 때문에 항상 JSON으로 보낸다.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || "문제가 생겼어요. 잠시 후 다시 시도해 주세요");
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = "GET", body, raw } = {}) {
  const init = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") {
    if (body instanceof Blob) {
      init.headers["Content-Type"] = body.type;
      init.body = body;
    } else {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network", "인터넷 연결을 확인해 주세요");
  }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, "error");
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error, data.message);
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: "POST", body });
export const put = (p, body) => api(p, { method: "PUT", body });
export const del = (p) => api(p, { method: "DELETE" });
