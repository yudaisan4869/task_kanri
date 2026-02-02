/* ========= State ========= */
const STORAGE_KEY = "gift_manager_v3";

// v2から移行（あれば）
function migrateIfNeeded() {
  const v3 = localStorage.getItem(STORAGE_KEY);
  if (v3) return;

  const v2 = localStorage.getItem("gift_manager_v2");
  if (v2) {
    localStorage.setItem(STORAGE_KEY, v2);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ campaigns: [], logs: [], externalTotals: [], tasks: [] }));
  }
}
migrateIfNeeded();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      campaigns: Array.isArray(s.campaigns) ? s.campaigns : [],
      logs: Array.isArray(s.logs) ? s.logs : [],
      externalTotals: Array.isArray(s.externalTotals) ? s.externalTotals : [],
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
    };
  } catch {
    return { campaigns: [], logs: [], externalTotals: [], tasks: [] };
  }
}
let state = loadState();
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function uid() { return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function escapeHtml(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function formatCampaignDate(c) {
  if (c.date_mode === "single") return c.start_date;
  const end = c.end_date || c.start_date;
  return `${c.start_date}–${end}`;
}
function incompleteCountByCampaign(campaignId) {
  return state.tasks.filter(t => t.campaign_id === campaignId && t.status !== "done").length;
}
function overallCounts() {
  const open = state.tasks.filter(t => t.status !== "done").length;
  const done = state.tasks.filter(t => t.status === "done").length;
  return { open, done };
}

/* ========= Toast ========= */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 1600);
}

/* ========= Views ========= */
const views = {
  home: document.getElementById("view-home"),
  tasks: document.getElementById("view-tasks"),
  campaigns: document.getElementById("view-campaigns"),
  campaign: document.getElementById("view-campaign"),
};

function showView(name) {
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
  setActiveNav(name);
}

/* ========= Nav Active ========= */
function setActiveNav(viewName) {
  document.querySelectorAll(".navlink").forEach(a => a.classList.remove("active"));
  const map = { home:"home", tasks:"tasks", campaigns:"campaigns", campaign:"campaigns" };
  const key = map[viewName] || "home";
  const el = document.querySelector(`.navlink[data-nav="${key}"]`);
  if (el) el.classList.add("active");
}

/* ========= Routing ========= */
let currentCampaignId = null;
function parseHash() {
  const h = (location.hash || "#home").replace("#", "");

  if (h.startsWith("campaign=")) {
    const id = h.split("=")[1];
    if (id && state.campaigns.some(c => c.id === id)) {
      currentCampaignId = id;
      showView("campaign");
      renderCampaignDetail();
      return;
    }
    location.hash = "#campaigns";
    return;
  }

  if (h === "tasks") {
    showView("tasks");
    renderTaskHub();
    return;
  }

  if (h === "campaigns") {
    showView("campaigns");
    renderCampaigns();
    return;
  }

  showView("home");
  renderHome();
}
window.addEventListener("hashchange", parseHash);

/* ========= Home ========= */
const statCampaigns = document.getElementById("statCampaigns");
const statTasksOpen = document.getElementById("statTasksOpen");
const statTasksDone = document.getElementById("statTasksDone");
const overallPill = document.getElementById("overallPill");
document.getElementById("quickNewTask")?.addEventListener("click", () => location.hash = "#tasks");
document.getElementById("quickNewCampaign")?.addEventListener("click", () => location.hash = "#campaigns");

function renderHome() {
  const { open, done } = overallCounts();
  statCampaigns.textContent = String(state.campaigns.length);
  statTasksOpen.textContent = String(open);
  statTasksDone.textContent = String(done);

  if (open > 0) {
    overallPill.textContent = `未完了 ${open}`;
  } else {
    overallPill.textContent = "未完了なし";
  }
}

/* ========= Campaigns ========= */
const campaignListEl = document.getElementById("campaignList");
const campaignSearchEl = document.getElementById("campaignSearch");
const createCampaignForm = document.getElementById("createCampaignForm");
const dateModeEl = document.getElementById("date_mode");
const endDateWrap = document.getElementById("endDateWrap");

dateModeEl?.addEventListener("change", () => {
  endDateWrap.style.display = (dateModeEl.value === "range") ? "block" : "none";
});

campaignSearchEl?.addEventListener("input", renderCampaigns);

createCampaignForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(createCampaignForm);
  const name = (fd.get("name") || "").toString().trim();
  const date_mode = fd.get("date_mode");
  const start_date = (fd.get("start_date") || "").toString().trim();
  const end_date_raw = (fd.get("end_date") || "").toString().trim();
  const source_mode = fd.get("source_mode");

  if (!name || !start_date) return;

  state.campaigns.unshift({
    id: uid(),
    name,
    date_mode,
    start_date,
    end_date: date_mode === "single" ? null : (end_date_raw || null),
    source_mode,
    created_at: new Date().toISOString(),
  });
  saveState();
  createCampaignForm.reset();
  endDateWrap.style.display = "none";
  renderCampaigns();
  renderTaskHubCampaignOptions();
  renderHome();
  toast("企画を作成");
});

function renderCampaigns() {
  const q = (campaignSearchEl?.value || "").trim().toLowerCase();
  const list = state.campaigns.filter(c => c.name.toLowerCase().includes(q));

  if (!campaignListEl) return;
  if (!list.length) {
    campaignListEl.innerHTML = `<div class="muted">企画がありません。</div>`;
    return;
  }

  campaignListEl.innerHTML = list.map(c => {
    const dateLabel = formatCampaignDate(c);
    const open = incompleteCountByCampaign(c.id);
    const icon = open > 0 ? "🔴" : "✅";
    const badge = c.source_mode === "internal" ? "internal" : "external";
    return `
      <div class="item">
        <div>
          <div>
            <a href="#campaign=${c.id}"><strong>${escapeHtml(c.name)}</strong></a>
            <span class="badge">${badge}</span>
          </div>
          <div class="muted">${escapeHtml(dateLabel)} · 未完了 ${open}</div>
        </div>
        <div style="font-size:18px;">${icon}</div>
      </div>
    `;
  }).join("");
}

/* ========= Campaign Detail ========= */
const campaignTitleEl = document.getElementById("campaignTitle");
const campaignMetaEl = document.getElementById("campaignMeta");
const campaignStatusPill = document.getElementById("campaignStatusPill");
const deleteCampaignBtn = document.getElementById("deleteCampaignBtn");

const leaderboardBody = document.getElementById("leaderboardBody");
const liveCard = document.getElementById("liveCard");
const externalCard = document.getElementById("externalCard");

const listenerNameInput = document.getElementById("listenerName");
const customPointsInput = document.getElementById("customPoints");
const liveMsg = document.getElementById("liveMsg");
const csvText = document.getElementById("csvText");
const kanbanEl = document.getElementById("kanban");
const createTaskFormDetail = document.getElementById("createTaskForm");

function getCurrentCampaign() {
  return state.campaigns.find(c => c.id === currentCampaignId) || null;
}

deleteCampaignBtn?.addEventListener("click", () => {
  const c = getCurrentCampaign();
  if (!c) return;
  if (!confirm(`「${c.name}」を削除します。関連ログ/タスクも消えます。OK？`)) return;

  state.campaigns = state.campaigns.filter(x => x.id !== c.id);
  state.logs = state.logs.filter(x => x.campaign_id !== c.id);
  state.externalTotals = state.externalTotals.filter(x => x.campaign_id !== c.id);
  state.tasks = state.tasks.filter(x => x.campaign_id !== c.id);
  saveState();

  renderTaskHubCampaignOptions();
  renderHome();
  location.hash = "#campaigns";
  toast("企画を削除");
});

function computeTotals(c) {
  if (!c) return [];
  if (c.source_mode === "external") {
    const rows = state.externalTotals
      .filter(r => r.campaign_id === c.id)
      .map(r => ({ listener_name: r.listener_name, points: r.total_points }));
    rows.sort((a,b)=> b.points - a.points || a.listener_name.localeCompare(b.listener_name));
    return rows;
  }
  const map = new Map();
  for (const log of state.logs.filter(l => l.campaign_id === c.id)) {
    map.set(log.listener_name, (map.get(log.listener_name)||0) + log.delta_points);
  }
  const rows = Array.from(map.entries()).map(([listener_name, points]) => ({ listener_name, points }));
  rows.sort((a,b)=> b.points - a.points || a.listener_name.localeCompare(b.listener_name));
  return rows;
}

function renderLeaderboard(totals) {
  if (!leaderboardBody) return;
  if (!totals.length) {
    leaderboardBody.innerHTML = `<tr><td colspan="2" class="muted">データなし</td></tr>`;
    return;
  }
  leaderboardBody.innerHTML = totals.map(r =>
    `<tr><td>${escapeHtml(r.listener_name)}</td><td class="right">${r.points}</td></tr>`
  ).join("");
}

function setLiveMsg(msg){ if (liveMsg) liveMsg.textContent = msg || ""; }

function renderCampaignDetail() {
  const c = getCurrentCampaign();
  if (!c) { location.hash = "#campaigns"; return; }

  const open = incompleteCountByCampaign(c.id);
  campaignTitleEl.textContent = c.name;
  campaignMetaEl.textContent = `${formatCampaignDate(c)} / source: ${c.source_mode}`;
  campaignStatusPill.textContent = open > 0 ? `未完了 ${open}` : "未完了なし";

  liveCard.classList.toggle("hidden", c.source_mode !== "internal");
  externalCard.classList.toggle("hidden", c.source_mode !== "external");

  renderLeaderboard(computeTotals(c));
  renderKanban(c.id, kanbanEl);

  setLiveMsg("");
}

/* --- Live input --- */
document.querySelectorAll("[data-add]").forEach(btn => {
  btn.addEventListener("click", () => addLog(parseInt(btn.getAttribute("data-add"), 10)));
});

document.getElementById("addCustomBtn")?.addEventListener("click", () => {
  const v = parseInt(customPointsInput.value, 10);
  if (!v) return setLiveMsg("任意ptを入れて。");
  addLog(v); customPointsInput.value = "";
});

document.getElementById("subtractBtn")?.addEventListener("click", () => {
  const v = parseInt(customPointsInput.value, 10);
  if (!v) return setLiveMsg("訂正したいpt（正の数）を入れて。");
  addLog(-Math.abs(v)); customPointsInput.value = "";
});

document.getElementById("undoBtn")?.addEventListener("click", () => undoLastLog());

function addLog(delta) {
  const c = getCurrentCampaign();
  if (!c) return;
  if (c.source_mode !== "internal") return setLiveMsg("この企画は外部集計モードです。");
  const name = (listenerNameInput.value || "").trim();
  if (!name) return setLiveMsg("リスナー名を入力して。");

  state.logs.push({
    id: uid(),
    campaign_id: c.id,
    listener_name: name,
    delta_points: delta,
    created_at: new Date().toISOString(),
  });
  saveState();
  renderCampaignDetail();
  renderCampaigns();
  renderHome();
  toast("投げ銭を反映");
}

function undoLastLog() {
  const c = getCurrentCampaign();
  if (!c) return;
  if (c.source_mode !== "internal") return setLiveMsg("この企画は外部集計モードです。");

  for (let i = state.logs.length - 1; i >= 0; i--) {
    if (state.logs[i].campaign_id === c.id) {
      state.logs.splice(i, 1);
      saveState();
      renderCampaignDetail();
      renderCampaigns();
      renderHome();
      toast("Undo");
      return;
    }
  }
  setLiveMsg("取り消すログがありません。");
}

/* --- External CSV --- */
document.getElementById("importCsvBtn")?.addEventListener("click", () => {
  const c = getCurrentCampaign();
  if (!c || c.source_mode !== "external") return;

  const text = (csvText.value || "").trim();
  if (!text) return alert("CSVが空です。");

  const rows = text.split("\n")
    .map(l => l.trim()).filter(Boolean)
    .map(l => l.split(","))
    .filter(p => p.length >= 2)
    .map(p => ({ name: (p[0]||"").trim(), pts: parseInt((p[1]||"").trim(), 10) }))
    .filter(x => x.name && Number.isFinite(x.pts));

  if (!rows.length) return alert("有効な行がありません（name,total_points）。");

  for (const r of rows) {
    const ex = state.externalTotals.find(x => x.campaign_id === c.id && x.listener_name === r.name);
    if (ex) {
      ex.total_points = r.pts;
      ex.updated_at = new Date().toISOString();
    } else {
      state.externalTotals.push({
        id: uid(),
        campaign_id: c.id,
        listener_name: r.name,
        total_points: r.pts,
        updated_at: new Date().toISOString()
      });
    }
  }

  saveState();
  renderCampaignDetail();
  renderCampaigns();
  renderHome();
  toast("外部集計を更新");
});

document.getElementById("clearExternalBtn")?.addEventListener("click", () => {
  const c = getCurrentCampaign();
  if (!c || c.source_mode !== "external") return;
  if (!confirm("この企画の外部集計データを全削除します。OK？")) return;

  state.externalTotals = state.externalTotals.filter(x => x.campaign_id !== c.id);
  saveState();
  renderCampaignDetail();
  renderHome();
  toast("外部集計をクリア");
});

/* ========= Tasks (shared) ========= */
const STATUS = ["todo","waiting","doing","ship","done"];
const STATUS_LABEL = {
  todo: "未着手",
  waiting: "必要情報待ち",
  doing: "制作/準備中",
  ship: "納品/発送待ち",
  done: "完了",
};

function renderKanban(campaignIdOrNull, mountEl, opts = {}) {
  const { searchText = "", openOnly = false } = opts;

  const q = searchText.trim().toLowerCase();
  const tasks = state.tasks.filter(t => {
    const inCampaign = campaignIdOrNull ? (t.campaign_id === campaignIdOrNull) : true;
    if (!inCampaign) return false;
    if (openOnly && t.status === "done") return false;

    if (!q) return true;

    const campaignName = t.campaign_id
      ? (state.campaigns.find(c => c.id === t.campaign_id)?.name || "")
      : "";
    const hay = `${t.listener_name} ${t.title} ${campaignName}`.toLowerCase();
    return hay.includes(q);
  });

  const grouped = Object.fromEntries(STATUS.map(s => [s, []]));
  for (const t of tasks) grouped[t.status].push(t);
  for (const s of STATUS) grouped[s].sort((a,b) => (b.updated_at||"").localeCompare(a.updated_at||""));

  mountEl.innerHTML = STATUS.map(st => {
    const list = grouped[st];
    const cards = list.length ? list.map(t => {
      const campaignName = t.campaign_id ? (state.campaigns.find(c => c.id === t.campaign_id)?.name || "（企画なし）") : "（企画なし）";
      return `
        <div class="task">
          <div class="taskTitle">${escapeHtml(t.title)}</div>
          <div class="taskSub">${escapeHtml(t.listener_name)} · ${escapeHtml(campaignName)}</div>
          <div class="taskBtns">
            ${STATUS.filter(x=>x!==st).map(to => `
              <button class="btn ghost" type="button" data-move="${t.id}:${to}">→${STATUS_LABEL[to]}</button>
            `).join("")}
            <button class="btn danger" type="button" data-del="${t.id}">削除</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="muted">なし</div>`;

    return `
      <div class="col">
        <div class="colHead">
          <div style="font-weight:850;">${STATUS_LABEL[st]}</div>
          <div class="pill">${list.length}</div>
        </div>
        ${cards}
      </div>
    `;
  }).join("");

  mountEl.querySelectorAll("[data-move]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [taskId, to] = btn.getAttribute("data-move").split(":");
      const t = state.tasks.find(x => x.id === taskId);
      if (!t) return;
      t.status = to;
      t.updated_at = new Date().toISOString();
      saveState();

      // 再描画（どの画面でも崩れない）
      renderHome();
      if (location.hash.startsWith("#campaign=")) renderCampaignDetail();
      if (location.hash === "#tasks") renderTaskHub();
      if (location.hash === "#campaigns") renderCampaigns();

      toast("タスクを移動");
    });
  });

  mountEl.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-del");
      if (!confirm("このタスクを削除しますか？")) return;
      state.tasks = state.tasks.filter(x => x.id !== taskId);
      saveState();

      renderHome();
      if (location.hash.startsWith("#campaign=")) renderCampaignDetail();
      if (location.hash === "#tasks") renderTaskHub();
      if (location.hash === "#campaigns") renderCampaigns();

      toast("タスクを削除");
    });
  });
}

/* --- Task Hub --- */
const taskHubForm = document.getElementById("taskHubForm");
const taskHubBoard = document.getElementById("taskHubBoard");
const taskHubCampaign = document.getElementById("taskHubCampaign");
const taskSearch = document.getElementById("taskSearch");
const taskFilter = document.getElementById("taskFilter");

function renderTaskHubCampaignOptions() {
  if (!taskHubCampaign) return;

  const current = taskHubCampaign.value || "";
  const opts = [
    `<option value="">（企画なし）</option>`,
    ...state.campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
  ].join("");
  taskHubCampaign.innerHTML = opts;

  if (Array.from(taskHubCampaign.options).some(o => o.value === current)) {
    taskHubCampaign.value = current;
  }
}

taskHubForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(taskHubForm);
  const campaign_id = (fd.get("campaign_id") || "").toString().trim() || null;
  const listener_name = (fd.get("listener_name") || "").toString().trim();
  const title = (fd.get("title") || "").toString().trim();
  const status = fd.get("status");

  if (!listener_name || !title) return;

  state.tasks.unshift({
    id: uid(),
    campaign_id,
    listener_name,
    title,
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  saveState();

  taskHubForm.reset();
  renderHome();
  renderCampaigns();
  renderTaskHub();
  toast("タスクを追加");
});

taskSearch?.addEventListener("input", renderTaskHub);
taskFilter?.addEventListener("change", renderTaskHub);

function renderTaskHub() {
  renderTaskHubCampaignOptions();
  const openOnly = (taskFilter?.value || "open") === "open";
  const q = taskSearch?.value || "";
  renderKanban(null, taskHubBoard, { searchText: q, openOnly });
}

/* --- Campaign detail task creation --- */
createTaskFormDetail?.addEventListener("submit", (e) => {
  e.preventDefault();
  const c = getCurrentCampaign();
  if (!c) return;

  const fd = new FormData(createTaskFormDetail);
  const listener_name = (fd.get("listener_name") || "").toString().trim();
  const title = (fd.get("title") || "").toString().trim();
  const status = fd.get("status");

  if (!listener_name || !title) return;

  state.tasks.unshift({
    id: uid(),
    campaign_id: c.id,
    listener_name,
    title,
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  saveState();

  createTaskFormDetail.reset();
  renderCampaignDetail();
  renderCampaigns();
  renderTaskHubCampaignOptions();
  renderHome();
  toast("タスクを追加");
});

/* ========= Backup / Restore ========= */
document.getElementById("exportBtn")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gift-manager-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("バックアップを書き出し");
});

document.getElementById("importFile")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try{
    const obj = JSON.parse(text);
    state = {
      campaigns: Array.isArray(obj.campaigns) ? obj.campaigns : [],
      logs: Array.isArray(obj.logs) ? obj.logs : [],
      externalTotals: Array.isArray(obj.externalTotals) ? obj.externalTotals : [],
      tasks: Array.isArray(obj.tasks) ? obj.tasks : [],
    };
    saveState();
    toast("復元しました");
    parseHash();
  }catch{
    alert("復元に失敗：JSONが不正です。");
  }finally{
    e.target.value = "";
  }
});

/* ========= Init ========= */
renderTaskHubCampaignOptions();
parseHash();
renderHome();
