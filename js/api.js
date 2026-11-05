/* Tầng gọi API Google Apps Script + phiên đăng nhập */
const Api = (function () {
  const SESSION_KEY = "survey_editor_session";
  let memSession = null;
  let onUnauthorized = null;

  function setUnauthorizedHandler(fn) {
    onUnauthorized = fn;
  }

  function loadSession() {
    if (memSession) return memSession;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) memSession = JSON.parse(raw);
    } catch (e) {
      memSession = null;
    }
    return memSession;
  }

  function saveSession(session) {
    memSession = session;
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* giữ trong bộ nhớ nếu sessionStorage lỗi */
    }
  }

  function clearSession() {
    saveSession(null);
  }

  function getSession() {
    return loadSession();
  }

  function ApiError(message, code) {
    const err = new Error(message || "Lỗi API");
    err.code = code || "";
    err.name = "ApiError";
    return err;
  }

  async function once(action, payload, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
    try {
      const body = Object.assign({}, payload || {}, { action });
      const session = loadSession();
      if (session && session.key && body.key == null) body.key = session.key;

      const res = await fetch(CONFIG.ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw ApiError("Phản hồi không hợp lệ từ máy chủ", "BAD_RESPONSE");
      }
      if (!data || data.ok === false) {
        const code = (data && data.error) || "ERROR";
        throw ApiError(code === "UNAUTHORIZED" ? "UNAUTHORIZED" : String(code), code);
      }
      return data.data !== undefined ? data.data : data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function api(action, payload) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await once(action, payload, 15000);
      } catch (e) {
        lastErr = e;
        if (e && e.code === "UNAUTHORIZED") {
          clearSession();
          if (typeof onUnauthorized === "function") onUnauthorized();
          throw e;
        }
        const isNet =
          e.name === "AbortError" ||
          e.message === "Failed to fetch" ||
          e.code === "BAD_RESPONSE" ||
          (typeof navigator !== "undefined" && !navigator.onLine);
        if (!isNet || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastErr || ApiError("Không gọi được máy chủ", "NETWORK");
  }

  async function ping() {
    const res = await fetch(CONFIG.ENDPOINT + "?action=ping", { method: "GET", redirect: "follow" });
    const data = JSON.parse(await res.text());
    if (!data || data.ok === false) throw ApiError((data && data.error) || "Ping thất bại");
    return data.data || data;
  }

  return {
    api,
    ping,
    getSession,
    saveSession,
    clearSession,
    setUnauthorizedHandler,
  };
})();
window.Api = Api;
