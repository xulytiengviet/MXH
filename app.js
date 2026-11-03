"use strict";

/**
 * MXH Live Studio — static dashboard / control client.
 * Backend contract: WebSocket control channel (default path: /ws/control).
 * This client does NOT connect to TikTok or Xiaozhi without a real backend.
 * Sensitive Xiaozhi URLs are held in memory only, not stored in localStorage.
 */
const byId = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("vi-VN");
const state = {
  socket: null,
  socketId: 0,
  backendConnected: false,
  target: "",
  reconnectTimer: null,
  reconnectAttempts: 0,
  userClosed: false,
  mode: "idle",
  status: "stopped",
  startedAt: 0,
  elapsedAtStop: 0,
  uptimeTimer: null,
  demoTimer: null,
  demoIndex: 0,
  motion: true,
  bgObjectUrl: null,
  counters: { comments: 0, sent: 0, viewers: 0, joins: 0 },
  logs: []
};

const statusLabels = {
  stopped: "Chưa kết nối",
  connecting: "Đang khởi động",
  connecting_xiaozhi: "Kết nối Xiaozhi...",
  connecting_tiktok: "Kết nối TikTok...",
  running: "Đang LIVE",
  disconnected: "Mất kết nối",
  error: "Có lỗi kết nối",
  stopping: "Đang dừng",
  demo: "DEMO · Dữ liệu mô phỏng"
};

function timestamp() {
  return new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function text(id, value) {
  byId(id).textContent = String(value);
}

function clearChildren(el) {
  el.replaceChildren();
}

function validWss(value, allowLocalWs = false) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "wss:") return true;
    return allowLocalWs && url.protocol === "ws:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      location.protocol === "http:";
  } catch {
    return false;
  }
}

function redact(raw) {
  // Never display secrets from backend logs, accidentally pasted credentials or URLs.
  return String(raw ?? "")
    .replace(/wss?:\/\/[^\s"'<>]+/gi, "[WebSocket URL đã ẩn]")
    .replace(/\b(token|api[_-]?key|secret|authorization)\s*[:=]\s*[^\s,;&]+/gi, "$1=[đã ẩn]")
    .slice(0, 1800);
}

function addLog(level, message) {
  const safeLevel = ["info", "success", "warning", "error"].includes(level) ? level : "info";
  const record = { at: timestamp(), level: safeLevel, message: redact(message) };
  state.logs.push(record);
  if (state.logs.length > 200) state.logs.shift();
  const row = document.createElement("div");
  row.className = "log-row " + record.level;
  const timeEl = document.createElement("span");
  timeEl.className = "log-time";
  timeEl.textContent = record.at;
  const msgEl = document.createElement("span");
  msgEl.className = "log-message";
  msgEl.textContent = record.message;
  row.append(timeEl, msgEl);
  const container = byId("logConsole");
  container.append(row);
  while (container.children.length > 200) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
}

function message(textValue, severity = "") {
  const el = byId("formMessage");
  el.textContent = textValue;
  el.className = "form-message" + (severity ? " " + severity : "");
}

function resetCounters() {
  state.counters = { comments: 0, sent: 0, viewers: 0, joins: 0 };
  state.elapsedAtStop = 0;
  state.startedAt = 0;
  paintStats();
  text("statUptime", "00:00");
  text("stageViewers", "0");
  byId("commentFeed").replaceChildren();
  byId("joinFeed").replaceChildren();
  emptyState("commentFeed", "commentEmpty", "☷", "Chưa có bình luận", "Dữ liệu sẽ xuất hiện khi LIVE bắt đầu.");
  emptyState("joinFeed", "joinEmpty", "♧", "Chưa có thành viên", "Đang chờ sự kiện từ TikTok.");
}

function emptyState(parentId, id, symbol, title, description) {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  wrapper.id = id;
  const icon = document.createElement("span");
  icon.textContent = symbol;
  const strong = document.createElement("strong");
  strong.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = description;
  wrapper.append(icon, strong, paragraph);
  byId(parentId).append(wrapper);
}

function paintStats() {
  text("statComments", fmt.format(state.counters.comments));
  text("statSent", fmt.format(state.counters.sent));
  text("statViewers", fmt.format(state.counters.viewers));
  text("statJoins", fmt.format(state.counters.joins));
  text("stageViewers", fmt.format(state.counters.viewers));
  text("commentCount", fmt.format(state.counters.comments) + " tin");
}

function elapsedString(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return (h ? pad(h) + ":" : "") + pad(m) + ":" + pad(r);
}

function updateUptime() {
  if (!state.startedAt) return;
  state.elapsedAtStop = Math.floor((Date.now() - state.startedAt) / 1000);
  text("statUptime", elapsedString(state.elapsedAtStop));
}
function startUptime() {
  stopUptime(false);
  state.startedAt = Date.now();
  state.uptimeTimer = setInterval(updateUptime, 1000);
}
function stopUptime(clearStart = true) {
  if (state.uptimeTimer) clearInterval(state.uptimeTimer);
  state.uptimeTimer = null;
  if (clearStart) state.startedAt = 0;
}

function displayStatus(status) {
  state.status = status;
  const badge = byId("modeBadge");
  const stageBadge = byId("stageStatus");
  const stage = byId("stage");
  badge.className = "mode-badge";
  stageBadge.className = "stage-status";
  stage.classList.remove("active");
  let color = "gray";
  let headline = "Sẵn sàng lên sóng";
  let detail = "Kết nối TikTok và Xiaozhi để AI bắt đầu đồng hành cùng bạn.";
  let stageTitle = "OFFLINE";
  let preview = "● PREVIEW";

  if (status === "demo") {
    badge.classList.add("demo");
    stageBadge.classList.add("demo");
    stage.classList.add("active");
    color = "amber";
    headline = "Đang mô phỏng livestream";
    detail = "Đây là dữ liệu ví dụ, không phải bình luận TikTok thực.";
    stageTitle = "DEMO";
    preview = "● DEMO ONLY";
  } else if (status === "running") {
    badge.classList.add("running");
    stageBadge.classList.add("live");
    stage.classList.add("active");
    color = "green";
    headline = "Xiaozhi đang đồng hành";
    detail = "AI voice bridge đang hoạt động cùng phiên TikTok LIVE.";
    stageTitle = "● LIVE";
    preview = "● ON AIR";
  } else if (status === "connecting" || status === "connecting_tiktok" || status === "connecting_xiaozhi" || status === "stopping") {
    badge.classList.add("connecting");
    color = "amber";
    headline = status === "stopping" ? "Đang dừng phiên LIVE" : "Đang thiết lập kết nối...";
    detail = "Đợi máy chủ Bridge xác nhận trạng thái.";
    stageTitle = "CONNECTING";
  } else if (status === "disconnected" || status === "error") {
    badge.classList.add("error");
    color = "red";
    headline = "Không thể kết nối";
    detail = "Kiểm tra máy chủ Bridge và thông tin cấu hình.";
    stageTitle = "OFFLINE";
  }

  text("statusText", statusLabels[status] || status);
  text("stageTitle", headline);
  text("stageSubtitle", detail);
  text("stageStatus", stageTitle);
  text("stageLiveTag", preview);
  const statusDot = badge.querySelector(".dot");
  statusDot.className = "dot " + color;
  byId("tiktokDot").className = "dot " + (
    status === "running" ? "green" :
    status === "connecting_tiktok" ? "amber" : "gray"
  );
  byId("xiaozhiDot").className = "dot " + (
    status === "running" ? "green" :
    status === "connecting_xiaozhi" ? "amber" : "gray"
  );
  text("dataSource", state.mode === "demo" ? "Dữ liệu giả lập — không phải LIVE" :
    status === "running" ? "Dữ liệu từ backend LIVE" : "Chưa có dữ liệu LIVE");
  byId("startBtn").disabled = state.mode === "demo" ||
    ["running", "connecting", "connecting_tiktok", "connecting_xiaozhi", "stopping"].includes(status);
  byId("stopBtn").disabled = state.mode !== "demo" &&
    !["running", "connecting", "connecting_tiktok", "connecting_xiaozhi"].includes(status);
}

function setSocketStatus(connected, detail) {
  state.backendConnected = connected;
  text("backendLabel", connected ? "Backend đã kết nối" : "Backend offline");
  byId("backendDot").className = "dot " + (connected ? "green" : "gray");
  text("socketState", detail || (connected ? "Sẵn sàng nhận lệnh." : "Chưa có socket."));
  byId("connectBtn").disabled = false;
  byId("connectBtn").textContent = connected ? "✓" : "↗";
  byId("connectBtn").title = connected ? "Kết nối lại backend" : "Kết nối backend";
}

function send(data) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    addLog("warning", "Không thể gửi lệnh: backend chưa kết nối.");
    return false;
  }
  try {
    state.socket.send(JSON.stringify(data));
    return true;
  } catch {
    addLog("error", "Không gửi được lệnh điều khiển đến backend.");
    return false;
  }
}

function connectBackend(isRetry = false) {
  if (state.mode === "demo") {
    message("Hãy dừng demo trước khi kết nối máy chủ.", "error");
    return;
  }
  const target = byId("backendUrl").value.trim();
  if (!validWss(target, true)) {
    message("Nhập URL backend wss:// hợp lệ (ws:// chỉ cho localhost trên HTTP).", "error");
    return;
  }
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (!isRetry) state.reconnectAttempts = 0;
  state.userClosed = false;
  state.target = target;
  const ownId = ++state.socketId;
  if (state.socket) {
    state.socket.onopen = null;
    state.socket.onmessage = null;
    state.socket.onclose = null;
    state.socket.onerror = null;
    state.socket.close();
  }
  state.socket = null;
  byId("connectBtn").disabled = true;
  setSocketStatus(false, isRetry ? "Đang kết nối lại..." : "Đang mở WebSocket...");
  byId("connectBtn").disabled = true;
  message("Đang kết nối backend...");
  let socket;
  try {
    socket = new WebSocket(target);
  } catch {
    setSocketStatus(false, "URL không thể mở WebSocket.");
    message("Không thể tạo WebSocket đến máy chủ.", "error");
    return;
  }
  state.socket = socket;
  socket.addEventListener("open", () => {
    if (ownId !== state.socketId) return;
    state.reconnectAttempts = 0;
    setSocketStatus(true, "WebSocket đã sẵn sàng.");
    message("Backend đã kết nối. Điền cấu hình và nhấn Bắt đầu Live.", "success");
    addLog("success", "Đã kết nối backend điều khiển.");
  });
  socket.addEventListener("message", (event) => {
    if (ownId !== state.socketId) return;
    try {
      const msg = JSON.parse(event.data);
      if (msg && typeof msg === "object") handleMessage(msg);
    } catch {
      addLog("warning", "Nhận gói tin không phải JSON hợp lệ từ backend.");
    }
  });
  socket.addEventListener("error", () => {
    if (ownId !== state.socketId) return;
    addLog("error", "WebSocket backend gặp lỗi. Kiểm tra HTTPS, URL, CORS/Origin và máy chủ.");
  });
  socket.addEventListener("close", () => {
    if (ownId !== state.socketId) return;
    setSocketStatus(false, "Mất kết nối WebSocket.");
    if (state.mode === "live") {
      stopUptime();
      state.mode = "idle";
      displayStatus("disconnected");
      message("Mất kết nối backend. Lệnh LIVE không còn được xác nhận.", "error");
    }
    if (state.userClosed) return;
    if (state.reconnectAttempts < 3) {
      state.reconnectAttempts += 1;
      const delay = state.reconnectAttempts * 3000;
      addLog("warning", "Mất kết nối backend; thử lại lần " + state.reconnectAttempts + "/3.");
      state.reconnectTimer = setTimeout(() => connectBackend(true), delay);
    } else {
      addLog("error", "Đã dừng thử lại. Kiểm tra backend rồi bấm Kết nối.");
    }
  });
}

function handleMessage(msg) {
  if (state.mode === "demo") return; // Never mix real backend events into demo metrics.
  // Server remains authoritative for LIVE state and counters.
  const event = String(msg.event || "");
  if (event === "log") {
    const line = String(msg.message || "");
    addLog(msg.level, line);
    // Compatibility with legacy DB-ROBOT, whose send count is reported only via log.
    if (msg.level === "info" && line.includes("Gửi →")) {
      state.counters.sent += 1;
      paintStats();
    }
  } else if (event === "comment") {
    addComment(msg.user, msg.message);
  } else if (event === "viewer") {
    state.counters.viewers = validCount(msg.count);
    paintStats();
  } else if (event === "join") {
    addJoin(msg.user);
  } else if (event === "sent") {
    // Prefer a dedicated 'sent' event in newer backends; do not emit both it
    // and a legacy 'Gửi →' log for the same message.
    state.counters.sent += 1;
    paintStats();
  } else if (event === "status") {
    const next = String(msg.status || "stopped");
    if (!Object.prototype.hasOwnProperty.call(statusLabels, next) || next === "demo") return;
    if (next === "running") {
      state.mode = "live";
      if (!state.startedAt) startUptime();
      message("Phiên LIVE đang chạy qua backend.", "success");
    } else if (["stopped", "error", "disconnected"].includes(next)) {
      stopUptime();
      state.mode = "idle";
      message("Phiên LIVE đã dừng hoặc mất kết nối.", next === "stopped" ? "" : "error");
    }
    displayStatus(next);
  } else if (event === "error") {
    addLog("error", msg.message || "Backend báo lỗi không xác định.");
    message("Backend báo lỗi: kiểm tra Console Log.", "error");
  }
}

function validCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100000000, Math.floor(n))) : 0;
}

function addComment(username, messageText) {
  const user = String(username ?? "khach").replace(/^@/, "").slice(0, 80);
  const content = String(messageText ?? "").slice(0, 1200);
  const container = byId("commentFeed");
  const empty = byId("commentEmpty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "event-row";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = user.slice(0, 2).toUpperCase();
  const body = document.createElement("div");
  body.className = "event-content";
  const title = document.createElement("div");
  title.className = "event-user";
  title.textContent = "@" + user;
  const desc = document.createElement("div");
  desc.className = "event-text";
  desc.textContent = content;
  body.append(title, desc);
  const time = document.createElement("time");
  time.className = "event-time";
  time.textContent = timestamp().slice(0, 5);
  row.append(avatar, body, time);
  container.append(row);
  while (container.children.length > 60) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
  state.counters.comments += 1;
  paintStats();
}

function addJoin(username) {
  const user = String(username ?? "khach").replace(/^@/, "").slice(0, 80);
  const container = byId("joinFeed");
  const empty = byId("joinEmpty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "event-row";
  const avatar = document.createElement("div");
  avatar.className = "avatar join-avatar";
  avatar.textContent = user.slice(0, 2).toUpperCase();
  const body = document.createElement("div");
  body.className = "event-content";
  const title = document.createElement("div");
  title.className = "event-user";
  title.textContent = "@" + user;
  const desc = document.createElement("div");
  desc.className = "event-text";
  desc.textContent = "Vừa tham gia phòng LIVE";
  body.append(title, desc);
  const time = document.createElement("time");
  time.className = "event-time";
  time.textContent = timestamp().slice(0, 5);
  row.append(avatar, body, time);
  container.append(row);
  while (container.children.length > 60) container.firstElementChild.remove();
  container.scrollTop = container.scrollHeight;
  state.counters.joins += 1;
  paintStats();
}

function startBridge() {
  if (state.mode === "demo") {
    message("Dừng demo trước khi bắt đầu LIVE thực.", "error");
    return;
  }
  const username = byId("tiktokUser").value.trim().replace(/^@/, "");
  const xiaozhi = byId("xiaozhiAddr").value.trim();
  if (!/^[A-Za-z0-9._]{2,64}$/.test(username)) {
    message("Nhập TikTok username hợp lệ (chữ, số, dấu chấm hoặc gạch dưới).", "error");
    byId("tiktokUser").focus();
    return;
  }
  if (!validWss(xiaozhi, true)) {
    message("Nhập URL WebSocket Xiaozhi hợp lệ, bắt đầu bằng wss://.", "error");
    byId("xiaozhiAddr").focus();
    return;
  }
  if (!state.backendConnected) {
    message("Backend chưa kết nối. Nhập Backend Control WSS và bấm nút ↗.", "error");
    return;
  }
  const cooldown = Math.min(60, Math.max(1, Number(byId("cooldown").value) || 5));
  const joinCooldown = Math.min(60, Math.max(2, Number(byId("joinCooldown").value) || 4));
  byId("cooldown").value = cooldown;
  byId("joinCooldown").value = joinCooldown;
  resetCounters();
  const ok = send({
    action: "start",
    tiktok_username: username,
    xiaozhi_address: xiaozhi,
    token: "",
    cooldown: String(cooldown),
    filter_keyword: byId("filterKw").value.trim(),
    greet_newcomers: byId("greetToggle").checked,
    join_cooldown: String(joinCooldown)
  });
  if (!ok) return;
  state.mode = "live";
  displayStatus("connecting");
  message("Đã gửi lệnh start; chờ backend xác nhận. Không mặc định coi như đã LIVE.");
  addLog("info", "Đã gửi lệnh bắt đầu LIVE tới backend.");
  text("stageCaptionTitle", "@" + username);
  text("stageCaptionText", "Đang thiết lập TikTok × Xiaozhi");
}

function stopBridge() {
  if (state.mode === "demo") {
    stopDemo();
    return;
  }
  if (state.mode !== "live") return;
  if (!send({ action: "stop" })) {
    state.mode = "idle";
    stopUptime();
    displayStatus("disconnected");
    return;
  }
  displayStatus("stopping");
  message("Đã gửi lệnh stop; chờ máy chủ xác nhận.");
  addLog("info", "Đã gửi lệnh dừng phiên LIVE.");
}

const demoItems = [
  { user: "minhanh_89", msg: "Shop ơi sản phẩm này còn hàng không?", join: "thuynguyen" },
  { user: "thanhphat", msg: "Xin chào Xiaozhi! Hôm nay có ưu đãi gì?", join: "hoangngoc" },
  { user: "vietanh22", msg: "Bạn AI tư vấn giúp mình sản phẩm phù hợp nhé", join: "mai.phuong" },
  { user: "ngocmai", msg: "Được freeship không ạ?", join: "tuanbao" },
  { user: "hanh.le", msg: "Chào cả nhà, livestream vui quá!", join: "quynhchi" },
  { user: "khanhvy", msg: "Cho mình xin thông tin chi tiết nhé", join: "ducminh" }
];

function demoStep() {
  const index = state.demoIndex++;
  const item = demoItems[index % demoItems.length];
  addComment(item.user, item.msg);
  if (index % 2 === 0) addJoin(item.join);
  if (index % 3 !== 2) {
    state.counters.sent += 1;
    addLog("success", "[DEMO] Chuyển yêu cầu ví dụ sang Xiaozhi.");
  }
  state.counters.viewers = 112 + ((index * 13) % 57);
  paintStats();
}

function startDemo() {
  if (state.mode === "live") {
    message("Dừng phiên LIVE thực trước khi sử dụng chế độ demo.", "error");
    return;
  }
  state.mode = "demo";
  resetCounters();
  startUptime();
  displayStatus("demo");
  text("demoBtn", "■ Dừng demo");
  text("stageCaptionTitle", "MXH Demo Assistant");
  text("stageCaptionText", "Chỉ để kiểm tra giao diện");
  message("Chế độ DEMO đang chạy — không kết nối TikTok hoặc Xiaozhi.");
  addLog("warning", "[DEMO] Đây là dữ liệu mô phỏng, không phải người xem thật.");
  demoStep();
  state.demoTimer = setInterval(demoStep, 3200);
}

function stopDemo() {
  if (state.demoTimer) clearInterval(state.demoTimer);
  state.demoTimer = null;
  state.mode = "idle";
  stopUptime();
  resetCounters();
  displayStatus("stopped");
  text("demoBtn", "✦ Xem demo");
  text("stageCaptionTitle", "Xiaozhi AI Assistant");
  text("stageCaptionText", "Real-time AI voice companion");
  message("Đã dừng demo. Kết nối backend để chạy LIVE thực.");
  addLog("info", "Đã dừng chế độ demo.");
}

const backgrounds = {
  aurora: "radial-gradient(ellipse at 38% 26%,#3c375ea3,transparent 52%),radial-gradient(ellipse at 72% 68%,#21687580,transparent 55%),linear-gradient(135deg,#10152e,#172439 50%,#0c1223)",
  cyber: "radial-gradient(ellipse at 22% 65%,#fd367a88,transparent 45%),radial-gradient(ellipse at 81% 25%,#28c4e588,transparent 50%),linear-gradient(120deg,#241035,#141932,#0c1729)",
  sunset: "radial-gradient(circle at 35% 80%,#ed7b6388,transparent 50%),radial-gradient(circle at 70% 20%,#c23d7888,transparent 55%),linear-gradient(130deg,#261332,#49315b,#1c2037)",
  midnight: "radial-gradient(circle at 75% 34%,#255c9270,transparent 50%),linear-gradient(120deg,#0a1120,#1b2b45,#080f21)",
  "anime-warrior": 'url("https://cdn-media.sforum.vn/storage/app/media/thanhhuyen/%E1%BA%A3nh%20%C4%91%E1%BB%99ng%20anime/1/anh-dong-anime-4.gif")',
  "anime-cool": 'url("https://cdn-media.sforum.vn/storage/app/media/thanhhuyen/%E1%BA%A3nh%20%C4%91%E1%BB%99ng%20anime/1/anh-dong-anime-3.gif")',
  "anime-lady": 'url("https://cdn-media.sforum.vn/storage/app/media/thanhhuyen/%E1%BA%A3nh%20%C4%91%E1%BB%99ng%20anime/4/anh-dong-anime-26.gif")'
};

function applyPreset(name) {
  if (!Object.prototype.hasOwnProperty.call(backgrounds, name)) return;
  if (state.bgObjectUrl) {
    URL.revokeObjectURL(state.bgObjectUrl);
    state.bgObjectUrl = null;
  }
  const el = byId("stageBg");
  el.style.backgroundImage = backgrounds[name];
  el.style.backgroundPosition = "center";
  el.style.backgroundSize = "cover";
  document.querySelectorAll(".preset").forEach((button) => button.classList.toggle("selected", button.dataset.bg === name));
  byId("bgUrl").value = "";
  byId("bgFile").value = "";
}

function applyImageUrl(url, objectUrl = false) {
  if (!objectUrl) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("URL");
    } catch {
      message("Chỉ nhận URL ảnh HTTPS hợp lệ.", "error");
      return false;
    }
  }
  if (state.bgObjectUrl) URL.revokeObjectURL(state.bgObjectUrl);
  state.bgObjectUrl = objectUrl ? url : null;
  const el = byId("stageBg");
  // Use property assignment, not innerHTML. Strip CSS quote / backslash controls.
  el.style.backgroundImage = 'url("' + url.replace(/["\\\n\r]/g, "") + '")';
  el.style.backgroundSize = "cover";
  el.style.backgroundPosition = "center";
  document.querySelectorAll(".preset").forEach((button) => button.classList.remove("selected"));
  message("Đã thay hình nền xem trước.", "success");
  return true;
}

function wireControls() {
  byId("connectBtn").addEventListener("click", () => connectBackend());
  byId("startBtn").addEventListener("click", startBridge);
  byId("stopBtn").addEventListener("click", stopBridge);
  byId("demoBtn").addEventListener("click", () => state.mode === "demo" ? stopDemo() : startDemo());
  byId("toggleSecret").addEventListener("click", () => {
    const el = byId("xiaozhiAddr");
    el.type = el.type === "password" ? "text" : "password";
    byId("toggleSecret").title = el.type === "text" ? "Ẩn URL Xiaozhi" : "Hiện URL Xiaozhi";
  });
  byId("clearLogBtn").addEventListener("click", () => {
    state.logs = [];
    clearChildren(byId("logConsole"));
    addLog("info", "Nhật ký đã được xóa trên màn hình.");
  });
  byId("exportLogBtn").addEventListener("click", () => {
    if (!state.logs.length) {
      message("Chưa có nhật ký để xuất.");
      return;
    }
    const lines = state.logs.map((item) => "[" + item.at + "] " + item.level.toUpperCase() + " " + item.message);
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mxh-console-" + new Date().toISOString().slice(0, 10) + ".txt";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  byId("motionBtn").addEventListener("click", () => {
    state.motion = !state.motion;
    byId("stageBg").classList.toggle("motion", state.motion);
    byId("motionBtn").classList.toggle("selected", state.motion);
    byId("motionBtn").setAttribute("aria-pressed", String(state.motion));
  });
  byId("resetBgBtn").addEventListener("click", () => applyPreset("aurora"));
  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.bg));
  });
  byId("applyBgBtn").addEventListener("click", () => {
    const value = byId("bgUrl").value.trim();
    if (!value) return message("Hãy nhập URL ảnh nền HTTPS.", "error");
    applyImageUrl(value);
  });
  byId("bgFile").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      message("Chỉ chấp nhận JPEG, PNG, WebP hoặc GIF.", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      message("Ảnh phải nhỏ hơn hoặc bằng 10 MB.", "error");
      return;
    }
    applyImageUrl(URL.createObjectURL(file), true);
  });
  window.addEventListener("beforeunload", () => {
    state.userClosed = true;
    clearTimeout(state.reconnectTimer);
    if (state.mode === "live") send({ action: "stop" });
    if (state.socket) state.socket.close();
    if (state.bgObjectUrl) URL.revokeObjectURL(state.bgObjectUrl);
  });
}

function init() {
  byId("stageBg").classList.add("motion");
  displayStatus("stopped");
  setSocketStatus(false, "Chưa thiết lập kết nối. Nhập URL WSS backend.");
  wireControls();
  addLog("info", "MXH Live Studio đã sẵn sàng.");
  addLog("info", "Chạy demo hoặc kết nối backend WSS để điều khiển LIVE.");
  // Neither the Xiaozhi secret URL nor the backend URL is saved anywhere.
}
document.addEventListener("DOMContentLoaded", init);
