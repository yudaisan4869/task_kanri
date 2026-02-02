/* ====== Storage ====== */
const STORAGE_KEY = "gift_manager_v2";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { campaigns: [], logs: [], externalTotals: [], tasks: [] };
    const s = JSON.parse(raw);
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
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
let state = loadState();

function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }
function escapeHtml(s){
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function formatCampaignDate(c){
  if (c.date_mode === "single") return c.start_date;
  const end = c.end_date || c.start_date;
  return `${c.start_date}–${end}`;
}
function incompleteCount(campaignId){
  return state.tasks.filter(t => t.campaign_id === campaignId && t.status !== "done").length;
}
function iconFor(campaignId){ return incompleteCount(campaignId) > 0 ? "🔴" : "✅"; }

/* ====== Toast ====== */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg){
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.add("hidden"), 1800);
}

/* ====== View switching ====== */
const viewList = document.getElementById("view-list");
const viewCampaign = document.getElementById("view-campaign");
let currentCampaignId = null;

function showList(){
  viewList.classList.remove("hidden");
  viewCampaign.classList.add("hidden");
  renderCampaignList();
}
function showCampaign(id){
  currentCampaignId = id;
  viewList.classList.add("hidden");
  viewCampaign.classList.remove("hidden");
  renderCampaignDetail();
}
function getCurrentCampaign(){
  return state.campaigns.find(c => c.id === currentCampaignId) || null;
}

/* ====== List UI ====== */
const campaignListEl = document.getElementById("campaignList");
const searchCampaignEl = document.getElementById("searchCampaign");

function renderCampaignList(){
  const q = (searchCampaignEl?.value || "").trim().toLowerCase();
  const list = state.campaigns.filter(c => c.name.toLowerCase().includes(q));

  if (!campaignListEl) return;
  if (list.length === 0){
    campaignListEl.innerHTML = `<div class="muted">企画がありません。</div>`;
    return;
  }
  campaignListEl.innerHTML = list.map(c => {
    const icon = iconFor(c.id);
    const dateLabel = formatCampaignDate(c);
    const badge = c.source_mode === "internal" ? "internal" : "external";
    return `
      <div class="item">
        <div>
          <div class="title">
            <a href="#campaign=${c.id}" style="color:inherit; text-decoration:none;">
              ${escapeHtml(c.name)}
            </a>
            <span class="badge">${badge}</span>
          </div>
          <div class="muted">${escapeHtml(dateLabel)}</div>
        </div>
        <div class="statusIcon">${icon}</div>
      </div>
    `;
  }).join("");
}
searchCampaignEl?.addEventListener("input", renderCampaignList);

/* ====== Create campaign ====== */
const createCampaignForm = document.getElementById("createCampaignForm");
const dateModeEl = document.getElementById("date_mode");
const endDateWrap = document.getElementById("endDateWrap");

dateModeEl?.addEventListener("change", () => {
  endDateWrap.style.display = (dateModeEl.value === "range") ? "block" : "none";
});

createCampaignForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(createCampaignForm);
  const name = (fd.get("name") || "").toString().trim();
  const date_mode = fd.get("date_mode");
  const start_date = (fd.get("start_date") || "").toString().trim();
  const end_date_raw = (fd.get("end_date") || "").toString().trim();
  const source_mode = fd.get("source_mode");

  if (!name || !start_date) return;

  const c = {
    id: uid(),
    name,
    date_mode,
    start_date,
    end_date: date_mode === "single" ? null : (end_date_raw || null),
    source_mode,
    created_at: new Date().toISOString(),
  };
  state.campaigns.unshift(c);
  saveState();
  createCampaignForm.reset();
  endDateWrap.style.display = "none";
  renderCampaignList();
  toast("企画を作成しました");
});

/* ====== Campaign detail ====== */
const campaignTitle = document.getElementById("campaignTitle");
const campaignMeta = document.getElementById("campaignMeta");
const statusIconEl = document.getElementById("statusIcon");
const backBtn = document.getElementById("backBtn");
const deleteCampaignBtn = document.getElementById("deleteCampaignBtn");

const leaderboardBody = document.getElementById("leaderboardBody");

const liveCard = document.getElementById("liveCard");
const externalCard = document.getElementById("externalCard");

const listenerNameInput = document.getElementById("listenerName");
const customPointsInput = document.getElementById("customPoints");
const liveMsg = document.getElementById("liveMsg");

const csvText = document.getElementById("csvText");
const importCsvBtn = document.getElementById("importCsvBtn");
const clearExternalBtn = document.getElementById("clearExternalBtn");

const createTaskForm = document.getElementById("createTaskForm");
const kanbanEl = document.getElementById("kanban");

backBtn?.addEventListener("click", () => { location.hash = ""; showList(); });

deleteCampaignBtn?.addEventListener("click", () => {
  const c = getCurrentCampaign();
  if (!c) return;
  if (!confirm(`「${c.name}」を削除します。関連ログ/タスクも消えます。OK？`)) return;

  state.campaigns = state.campaigns.filter(x => x.id !== c.id);
  state.logs = state.logs.filter(x => x.campaign_id !== c.id);
  state.externalTotals = state.externalTotals.filter(x => x.campaign_id !== c.id);
  state.tasks = state.tasks.filter(x => x.campaign_id !== c.id);
  saveState();
  location.hash = "";
  showList();
  toast("削除しました");
});

function computeTotals(c){
  if (!c) return [];
  if (c.source_mode === "external"){
    const rows = state.externalTotals
      .filter(r => r.campaign_id === c.id)
      .map(r => ({ listener_name: r.listener_name, points: r.total_points }));
    rows.sort((a,b)=> b.points - a.points || a.listener_name.localeCompare(b.listener_name));
    return rows;
  }
  const map = new Map();
  for (const log of state.logs.filter(l => l.campaign_id === c.id)){
    map.set(log.listener_name, (map.get(log.listener_name)||0) + log.delta_points);
  }
  const rows = Array.from(map.entries()).map(([listener_name, points]) => ({ listener_name, points }));
  rows.sort((a,b)=> b.points - a.points || a.listener_name.localeCompare(b.listener_name));
  return rows;
}

function renderLeaderboard(totals){
  if (!leaderboardBody) return;
  if (!totals || totals.length === 0){
    leaderboardBody.innerHTML = `<tr><td colspan="2" class="muted">データなし</td></tr>`;
    return;
  }
  leaderboardBody.innerHTML = totals.map(r =>
    `<tr><td>${escapeHtml(r.listener_name)}</td><td class="right">${r.points}</td></tr>`
  ).join("");
}

const STATUS_LABEL = {
  todo: "未着手",
  waiting: "必要情報待ち",
  doing: "制作/準備中",
  ship: "納品/発送待ち",
  done: "完了",
};

function renderKanban(campaignId){
  const cols = ["todo","waiting","doing","ship","done"];
  const tasks = state.tasks.filter(t => t.campaign_id === campaignId);
  const grouped = Object.fromEntries(cols.map(c => [c, []]));
  for (const t of tasks) grouped[t.status].push(t);

  kanbanEl.innerHTML = cols.map(st => {
    const list = grouped[st];
    const cards = list.length ? list.map(t => `
      <div class="task">
        <div class="taskTitle">${escapeHtml(t.title)}</div>
        <div class="taskSub">${escapeHtml(t.listener_name)}</div>
        <div class="taskBtns">
          ${cols.filter(x=>x!==st).map(to => `
            <button class="btn secondary" type="button" data-move="${t.id}:${to}" style="padding:8px 10px;">
              →${STATUS_LABEL[to]}
            </button>
          `).join("")}
          <button class="btn danger" type="button" data-del="${t.id}" style="padding:8px 10px;">削除</button>
        </div>
      </div>
    `).join("") : `<div class="muted">なし</div>`;

    return `
      <div class="col">
        <div class="colHead">
          <div style="font-weight:700;">${STATUS_LABEL[st]}</div>
          <div class="badge">${list.length}</div>
        </div>
        ${cards}
      </div>
    `;
  }).join("");

  kanbanEl.querySelectorAll("[data-move]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [taskId, to] = btn.getAttribute("data-move").split(":");
      const t = state.tasks.find(x => x.id === taskId);
      if (!t) return;
      t.status = to;
      t.updated_at = new Date().toISOString();
      saveState();
      renderCampaignDetail();
      renderCampaignList();
      toast("タスクを移動");
    });
  });
  kanbanEl.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const taskId = btn.getAttribute("data-del");
      if (!confirm("このタスクを削除しますか？")) return;
      state.tasks = state.tasks.filter(x => x.id !== taskId);
      saveState();
      renderCampaignDetail();
      renderCampaignList();
      toast("タスクを削除");
    });
  });
}

function setLiveMsg(msg){ if (liveMsg) liveMsg.textContent = msg || ""; }

function renderCampaignDetail(){
  const c = getCurrentCampaign();
  if (!c) return showList();

  campaignTitle.textContent = c.name;
  campaignMeta.textContent = `${formatCampaignDate(c)} / source: ${c.source_mode}`;
  statusIconEl.textContent = iconFor(c.id);

  // show/hide cards
  const internal = c.source_mode === "internal";
  liveCard.classList.toggle("hidden", !internal);
  externalCard.classList.toggle("hidden", internal);

  renderLeaderboard(computeTotals(c));
  renderKanban(c.id);
  setLiveMsg("");
}

/* ====== Live input ====== */
document.querySelectorAll("[data-add]").forEach(btn => {
  btn.addEventListener("click", () => addLog(parseInt(btn.getAttribute("data-add"),10)));
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

function addLog(delta){
  const c = getCurrentCampaign();
  if (!c) return;
  if (c.source_mode !== "internal") return setLiveMsg("この企画は外部集計モードです。");
  const name = (listenerNameInput.value || "").
