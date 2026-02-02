/* ========= State ========= */
const STORAGE_KEY = "gift_manager_v4";

// v3/v2から移行（あれば）
function migrate() {
  if (localStorage.getItem(STORAGE_KEY)) return;

  const v3 = localStorage.getItem("gift_manager_v3");
  const v2 = localStorage.getItem("gift_manager_v2");
  const src = v3 || v2;
  if (src) {
    try {
      const s = JSON.parse(src);
      // 旧campaignにsource_modeがあっても無視して内部入力化
      const migrated = {
        campaigns: (Array.isArray(s.campaigns) ? s.campaigns : []).map(c => ({
          id: c.id || uid(),
          name: c.name || "無名企画",
          start_date: c.start_date || "",
          // v4: rules を持つ（無ければ空）
          rules: Array.isArray(c.rules) ? c.rules : [],
          created_at: c.created_at || new Date().toISOString(),
        })),
        logs: Array.isArray(s.logs) ? s.logs : [],
        tasks: Array.isArray(s.tasks) ? s.tasks : [],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return;
    } catch {}
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify({ campaigns: [], logs: [], tasks: [] }));
}
migrate();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      campaigns: Array.isArray(s.campaigns) ? s.campaigns : [],
      logs: Array.isArray(s.logs) ? s.logs : [],
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
    };
  } catch {
    return { campaigns: [], logs: [], tasks: [] };
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

function byISODateOnly(iso) {
  // "2026-02-02T..." -> "2026-02-02"
  return (iso || "").slice(0, 10);
}

/* ========= Toast ========= */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 1500);
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
  const map = { home:"home", tasks:"tasks", campaigns:"campaigns", campaign:"tasks" };
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
    location.hash = "#tasks";
    return;
  }

  if (h === "tasks") {
    showView("tasks");
    renderTaskCampaignList();
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

function overallCounts() {
  const open = state.tasks.filter(t => t.status !== "done").length;
  const done = state.tasks.filter(t => t.status === "done").length;
  return { open, done };
}

function renderHome() {
  const { open, done } = overallCounts();
  statCampaigns.textContent = String(state.campaigns.length);
  statTasksOpen.textContent = String(open);
  statTasksDone.textContent = String(done);
  overallPill.textContent = open > 0 ? `未完了 ${open}` : "未完了なし";
}

/* ========= Reward rules ========= */
/**
 * rules: [{ threshold: number, reward: string }]
 * returns matched reward (highest threshold <= points), else ""
 */
function getRewardForPoints(rules, points) {
  const sorted = (Array.isArray(rules) ? rules : [])
    .filter(r => Number.isFinite(r.threshold) && (r.reward || "").trim())
    .slice()
    .sort((a,b) => a.threshold - b.threshold);

  let matched = "";
  for (const r of sorted) {
    if (points >= r.threshold) matched = r.reward;
    else break;
  }
  return matched;
}

/* ========= Totals ========= */
function computeTotalsForCampaign(campaignId) {
  const map = new Map();
  for (const log of state.logs.filter(l => l.campaign_id === campaignId)) {
    const name = (l.listener_name || "").trim();
    if (!name) continue;
    map.set(name, (map.get(name) || 0) + (l.delta_points || 0));
  }
  const rows = Array.from(map.entries()).map(([listener_name, points]) => ({ listener_name, points }));
  rows.sort((a,b) => b.points - a.points || a.listener_name.localeCompare(b.listener_name));
  return rows;
}

function incompleteCountByCampaign(campaignId) {
  return state.tasks.filter(t => t.campaign_id === campaignId && t.status !== "done").length;
}

/* ========= Campaign creation (rules) ========= */
const rulesBox = document.getElementById("rulesBox");
const addRuleRowBtn = document.getElementById("addRuleRowBtn");

function addRuleRow(threshold = "", reward = "") {
  const rowId = uid();
  const el = document.createElement("div");
  el.className = "ruleRow";
  el.dataset.rowid = rowId;
  el.innerHTML = `
    <label class="field">
      <span>ポイント</span>
      <input class="input" type="number" min="0" step="1" data-threshold value="${escapeHtml(threshold)}" placeholder="例：1000" />
    </label>
    <label class="field">
      <span>返礼品内容</span>
      <input class="input" type="text" data-reward value="${escapeHtml(reward)}" placeholder="例：デジグッズA / 実写チェキ / 発送" />
    </label>
    <div class="field">
      <span>&nbsp;</span>
      <button class="btn ghost" type="button" data-del>削除</button>
    </div>
  `;
  el.querySelector("[data-del]").addEventListener("click", () => {
    el.remove();
  });
  rulesBox.appendChild(el);
}

addRuleRowBtn?.addEventListener("click", () => addRuleRow("", ""));

// 初期3行（使わないなら空でもOK）
if (rulesBox) {
  addRuleRow("1000", "デジグッズA");
  addRuleRow("3000", "デジグッズB");
  addRuleRow("5000", "リアルグッズ発送");
}

/* ========= Campaigns ========= */
const campaignListEl = document.getElementById("campaignList");
const campaignSearchEl = document.getElementById("campaignSearch");
const createCampaignForm = document.getElementById("createCampaignForm");

campaignSearchEl?.addEventListener("input", renderCampaigns);

createCampaignForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(createCampaignForm);
  const name = (fd.get("name") || "").toString().trim();
  const start_date = (fd.get("start_date") || "").toString().trim();
  if (!name || !start_date) return;

  // rules collect
  const rules = [];
  rulesBox.querySelectorAll(".ruleRow").forEach(row => {
    const th = parseInt(row.querySelector("[data-threshold]")?.value, 10);
    const rw = (row.querySelector("[data-reward]")?.value || "").toString().trim();
    if (Number.isFinite(th) && rw) rules.push({ threshold: th, reward: rw });
  });
  rules.sort((a,b) => a.threshold - b.threshold);

  state.campaigns.unshift({
    id: uid(),
    name,
    start_date,
    rules,
    created_at: new Date().toISOString(),
  });
  saveState();

  createCampaignForm.reset();
  // ルールは残す（毎回ゼロから入力したくない想定）。消したければここでrulesBoxを初期化して。
  renderCampaigns();
  renderTaskCampaignList();
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
    const open = incompleteCountByCampaign(c.id);
    const icon = open > 0 ? "🔴" : "✅";
    const totals = computeTotalsForCampaign(c.id);
    const top = totals.slice(0, 2).map(r => `${escapeHtml(r.listener_name)} ${r.points}pt`).join(" / ");
    const ruleSummary = (c.rules || []).slice(0, 2).map(r => `${r.threshold}→${escapeHtml(r.reward)}`).join(" / ");
    return `
      <div class="item">
        <div>
          <div>
            <a href="#campaign=${c.id}"><strong>${escapeHtml(c.name)}</strong></a>
            <span class="badge">${escapeHtml(c.start_date)}</span>
          </div>
          <div class="muted">未完了 ${open} · 上位: ${top || "—"} · ルール: ${ruleSummary || "—"}</div>
        </div>
        <div style="font-size:18px;">${icon}</div>
      </div>
    `;
  }).join("");
}

/* ========= Task management: Campaign list ========= */
const taskCampaignListEl = document.getElementById("taskCampaignList");
const tasksCampaignSearchEl = document.getElementById("tasksCampaignSearch");
tasksCampaignSearchEl?.addEventListener("input", renderTaskCampaignList);

function renderTaskCampaignList() {
  const q = (tasksCampaignSearchEl?.value || "").trim().toLowerCase();
  const list = state.campaigns.filter(c => c.name.toLowerCase().includes(q));

  if (!taskCampaignListEl) return;
  if (!list.length) {
    taskCampaignListEl.innerHTML = `<div class="muted">企画がありません。まず企画作成へ。</div>`;
    return;
  }

  taskCampaignListEl.innerHTML = list.map(c => {
    const open = incompleteCountByCampaign(c.id);
    const icon = open > 0 ? "🔴" : "✅";
    const totals = computeTotalsForCampaign(c.id);
    // 企画ごとに「ポイント＆返礼品」をすぐ見れるよう、上位2名だけ表示（重くしない）
    const top2 = totals.slice(0, 2).map(r => {
      const reward = getRewardForPoints(c.rules, r.points);
      return `${escapeHtml(r.listener_name)} ${r.points}pt（${escapeHtml(reward || "—")}）`;
    }).join(" / ");
    return `
      <div class="item">
        <div>
          <div>
            <a href="#campaign=${c.id}"><strong>${escapeHtml(c.name)}</strong></a>
            <span class="badge">${escapeHtml(c.start_date)}</span>
          </div>
          <div class="muted">未完了 ${open} · 上位: ${top2 || "—"}</div>
        </div>
        <div style="font-size:18px;">${icon}</div>
      </div>
    `;
  }).join("");
}

/* ========= Campaign detail ========= */
const campaignTitleEl = document.getElementById("campaignTitle");
const campaignMetaEl = document.getElementById("campaignMeta");
const campaignStatusPill = document.getElementById("campaignStatusPill");
const deleteCampaignBtn = document.getElementById("deleteCampaignBtn");
const leaderboardBody = document.getElementById("leaderboardBody");

function getCurrentCampaign() {
  return state.campaigns.find(c => c.id === currentCampaignId) || null;
}

deleteCampaignBtn?.addEventListener("click", () => {
  const c = getCurrentCampaign();
  if (!c) return;
  if (!confirm(`「${c.name}」を削除します。関連ログ/タスクも消えます。OK？`)) return;

  state.campaigns = state.campaigns.filter(x => x.id !== c.id);
  state.logs = state.logs.filter(x => x.campaign_id !== c.id);
  state.tasks = state.tasks.filter(x => x.campaign_id !== c.id);
  saveState();

  renderHome();
  renderCampaigns();
  renderTaskCampaignList();
  location.hash = "#tasks";
  toast("企画を削除");
});

function renderLeaderboardForCampaign(c) {
  const totals = computeTotalsForCampaign(c.id);
  if (!totals.length) {
    leaderboardBody.innerHTML = `<tr><td colspan="3" class="muted">データなし</td></tr>`;
    return;
  }

  leaderboardBody.innerHTML = totals.map(r => {
    const reward = getRewardForPoints(c.rules, r.points);
    return `
      <tr>
        <td>${escapeHtml(r.listener_name)}</td>
        <td class="right">${r.points}</td>
        <td>${escapeHtml(reward || "—")}</td>
      </tr>
    `;
  }).join("");
}

function renderCampaignDetail() {
  const c = getCurrentCampaign();
  if (!c) { location.hash = "#tasks"; return; }

  const open = incompleteCountByCampaign(c.id);
  campaignTitleEl.textContent = c.name;
  campaignMetaEl.textContent = `開始日：${c.start_date} / 返礼ルール数：${(c.rules||[]).length}`;
  campaignStatusPill.textContent = open > 0 ? `未完了 ${open}` : "未完了なし";

  renderLeaderboardForCampaign(c);
  renderTaskList();
  setLiveMsg("");
}

/* ========= Live input ========= */
const listenerNameInput = document.getElementById("listenerName");
const customPointsInput = document.getElementById("customPoints");
const liveMsg = document.getElementById("liveMsg");

function setLiveMsg(msg){ if (liveMsg) liveMsg.textContent = msg || ""; }

document.querySelectorAll("[data-add]").forEach(btn => {
  btn.addEventListener("click", () => addLog(parseInt(btn.getAttribute("data-add"), 10)));
});

document.getElementById("addCustomBtn")?.addEventListener("click", () => {
  const v = parseInt(customPointsInput.value, 10);
  if (!v) return setLiveMsg("任意ptを入れて。");
  addLog(v);
  customPointsInput.value = "";
});

document.getElementById("subtractBtn")?.addEventListener("click", () => {
  const v = parseInt(customPointsInput.value, 10);
  if (!v) return setLiveMsg("訂正したいpt（正の数）を入れて。");
  addLog(-Math.abs(v));
  customPointsInput.value = "";
});

document.getElementById("undoBtn")?.addEventListener("click", () => undoLastLog());

function addLog(delta) {
  const c = getCurrentCampaign();
  if (!c) return;
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

  renderLeaderboardForCampaign(c);
  renderTaskCampaignList();
  renderCampaigns();
  renderHome();

  setLiveMsg(`${delta>0?"+":""}${delta} を ${name} に反映`);
  toast("反映");
}

function undoLastLog() {
  const c = getCurrentCampaign();
  if (!c) return;

  for (let i = state.logs.length - 1; i >= 0; i--) {
    if (state.logs[i].campaign_id === c.id) {
      state.logs.splice(i, 1);
      saveState();

      renderLeaderboardForCampaign(c);
      renderTaskCampaignList();
      renderCampaigns();
      renderHome();

      toast("Undo");
      setLiveMsg("直近1件を取り消し");
      return;
    }
  }
  setLiveMsg("取り消すログがありません。");
}

/* ========= Tasks in campaign ========= */
const createTaskForm = document.getElementById("createTaskForm");
const taskListEl = document.getElementById("taskList");

const taskSearchListener = document.getElementById("taskSearchListener");
const taskSearchFrom = document.getElementById("taskSearchFrom");
const taskSearchTo = document.getElementById("taskSearchTo");
const clearTaskSearch = document.getElementById("clearTaskSearch");

taskSearchListener?.addEventListener("input", renderTaskList);
taskSearchFrom?.addEventListener("change", renderTaskList);
taskSearchTo?.addEventListener("change", renderTaskList);
clearTaskSearch?.addEventListener("click", () => {
  taskSearchListener.value = "";
  taskSearchFrom.value = "";
  taskSearchTo.value = "";
  renderTaskList();
});

createTaskForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const c = getCurrentCampaign();
  if (!c) return;

  const fd = new FormData(createTaskForm);
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

  createTaskForm.reset();
  renderTaskList();
  renderTaskCampaignList();
  renderCampaigns();
  renderHome();
  toast("タスク追加");
});

function matchesDateRange(taskISO, from, to) {
  const d = byISODateOnly(taskISO);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function renderTaskList() {
  const c = getCurrentCampaign();
  if (!c) return;

  const q = (taskSearchListener.value || "").trim().toLowerCase();
  const from = (taskSearchFrom.value || "").trim();
  const to = (taskSearchTo.value || "").trim();

  const tasks = state.tasks
    .filter(t => t.campaign_id === c.id)
    .filter(t => {
      if (q && !(t.listener_name || "").toLowerCase().includes(q)) return false;
      if (!matchesDateRange(t.created_at, from, to)) return false;
      return true;
    });

  if (!tasks.length) {
    taskListEl.innerHTML = `<div class="muted">該当タスクなし</div>`;
    return;
  }

  taskListEl.innerHTML = tasks.map(t => {
    const created = byISODateOnly(t.created_at);
    const isDone = t.status === "done";
    return `
      <div class="taskItem">
        <div class="taskTop">
          <div>
            <div class="taskTitle">${escapeHtml(t.title)}</div>
            <div class="taskMeta">${escapeHtml(t.listener_name)} / ${created} / 状態：${escapeHtml(t.status)}</div>
          </div>
          <div class="taskBtns">
            ${isDone
              ? `<button class="btn ghost" type="button" data-undone="${t.id}">未完了に戻す</button>`
              : `<button class="btn primary" type="button" data-done="${t.id}">完了</button>`
            }
            <button class="btn ghost" type="button" data-del="${t.id}">削除</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  taskListEl.querySelectorAll("[data-done]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-done");
      const t = state.tasks.find(x => x.id === id);
      if (!t) return;
      t.status = "done";
      t.updated_at = new Date().toISOString();
      saveState();

      renderCampaignDetail();
      renderTaskCampaignList();
      renderCampaigns();
      renderHome();
      toast("完了");
    });
  });

  taskListEl.querySelectorAll("[data-undone]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-undone");
      const t = state.tasks.find(x => x.id === id);
      if (!t) return;
      t.status = "todo";
      t.updated_at = new Date().toISOString();
      saveState();

      renderCampaignDetail();
      renderTaskCampaignList();
      renderCampaigns();
      renderHome();
      toast("未完了に戻した");
    });
  });

  taskListEl.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("このタスクを削除しますか？")) return;
      state.tasks = state.tasks.filter(x => x.id !== id);
      saveState();

      renderCampaignDetail();
      renderTaskCampaignList();
      renderCampaigns();
      renderHome();
      toast("削除");
    });
  });
}

/* ========= Backup / Restore ========= */
document.getElementById("exportBtn")?.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reward-task-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("バックアップ");
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
parseHash();
renderHome();
