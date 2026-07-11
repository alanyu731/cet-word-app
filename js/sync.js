// ============================================================
// 云端同步模块 - 使用 GitHub Contents API 存储学习数据
// 读取：raw URL（公开免认证）
// 写入：GitHub API + Token（用户输入，存 localStorage）
// ============================================================

(function () {
  "use strict";

  // ---- GitHub 仓库配置 ----
  const REPO_OWNER = "alanyu731";
  const REPO_NAME = "cet-word-app";
  const REPO_BRANCH = "gh-pages";
  const DATA_PATH = "data/progress.json";

  const API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${DATA_PATH}`;
  const RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${DATA_PATH}`;

  // ---- 本地存储键 ----
  const TOKEN_KEY = "cet_sync_token";
  const LAST_SYNC_KEY = "cet_last_sync";
  const PENDING_FLAG = "cet_sync_pending";

  // ---- 同步节流 ----
  let syncTimer = null;
  let lastSyncTs = 0;
  const MIN_INTERVAL = 20000; // 最小同步间隔 20 秒

  // ---- Token 管理 ----
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (token && token.trim()) {
      localStorage.setItem(TOKEN_KEY, token.trim());
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  function hasToken() {
    return !!getToken();
  }

  function getLastSyncTime() {
    return localStorage.getItem(LAST_SYNC_KEY) || null;
  }

  function getLastSyncText() {
    const t = getLastSyncTime();
    if (!t) return "未同步";
    const d = new Date(t);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
    return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  // ---- UTF-8 安全的 Base64 编码 ----
  function utf8ToBase64(str) {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode("0x" + p1)
      )
    );
  }

  // ---- 获取文件 SHA（更新时需要）----
  async function getFileSha() {
    try {
      const resp = await fetch(API_URL);
      if (resp.ok) {
        const data = await resp.json();
        return data.sha;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // ---- 上传数据到 GitHub ----
  async function uploadData(progressData) {
    const token = getToken();
    if (!token) {
      return { success: false, error: "未设置同步 Token" };
    }

    const payload = {
      version: 2,
      studentName: "佳吟同学",
      lastSync: new Date().toISOString(),
      progress: progressData,
    };

    const content = utf8ToBase64(JSON.stringify(payload));
    const sha = await getFileSha();

    const body = {
      message: "sync: " + new Date().toLocaleString("zh-CN"),
      content: content,
      branch: REPO_BRANCH,
    };
    if (sha) body.sha = sha;

    try {
      const resp = await fetch(API_URL, {
        method: "PUT",
        headers: {
          Authorization: "token " + token,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify(body),
      });

      if (resp.ok || resp.status === 201) {
        const now = new Date().toISOString();
        localStorage.setItem(LAST_SYNC_KEY, now);
        lastSyncTs = Date.now();
        localStorage.removeItem(PENDING_FLAG);
        return { success: true, time: now };
      } else {
        const err = await resp.json().catch(() => ({}));
        let msg = err.message || ("HTTP " + resp.status);
        if (resp.status === 401) msg = "Token 无效或已过期";
        if (resp.status === 403) msg = "Token 权限不足或触发频率限制";
        if (resp.status === 404) msg = "仓库路径不存在";
        return { success: false, error: msg };
      }
    } catch (e) {
      return { success: false, error: "网络错误: " + e.message };
    }
  }

  // ---- 从 GitHub 下载数据（公开，无需 Token）----
  async function downloadData() {
    try {
      const url = RAW_URL + "?t=" + Date.now(); // 防缓存
      const resp = await fetch(url);
      if (resp.ok) {
        return await resp.json();
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // ---- 节流自动同步（学习操作后调用）----
  function scheduleSync(getProgressFn) {
    if (!hasToken()) return;

    localStorage.setItem(PENDING_FLAG, "1");

    if (syncTimer) clearTimeout(syncTimer);

    const elapsed = Date.now() - lastSyncTs;
    const delay = Math.max(2000, MIN_INTERVAL - elapsed); // 至少等 2 秒

    syncTimer = setTimeout(async () => {
      const data = typeof getProgressFn === "function" ? getProgressFn() : getProgressFn;
      const result = await uploadData(data);
      if (result.success) {
        console.log("[sync] 自动同步成功", result.time);
      } else {
        console.warn("[sync] 自动同步失败", result.error);
      }
    }, delay);
  }

  // ---- 手动立即同步 ----
  async function syncNow(getProgressFn) {
    if (!hasToken()) {
      return { success: false, error: "请先在设置中输入 GitHub Token" };
    }
    const data = typeof getProgressFn === "function" ? getProgressFn() : getProgressFn;
    return await uploadData(data);
  }

  // ---- 页面离开时自动同步 ----
  function setupAutoSync(getProgressFn) {
    // 页面隐藏时同步
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && hasToken() && localStorage.getItem(PENDING_FLAG) === "1") {
        if (syncTimer) clearTimeout(syncTimer);
        syncNow(getProgressFn);
      }
    });

    // 页面关闭时同步
    window.addEventListener("pagehide", () => {
      if (hasToken() && localStorage.getItem(PENDING_FLAG) === "1") {
        if (syncTimer) clearTimeout(syncTimer);
        syncNow(getProgressFn);
      }
    });
  }

  // ---- 暴露 API ----
  window.cetSync = {
    getToken,
    setToken,
    hasToken,
    getLastSyncTime,
    getLastSyncText,
    uploadData,
    downloadData,
    scheduleSync,
    syncNow,
    setupAutoSync,
    RAW_URL,
    API_URL,
  };
})();
