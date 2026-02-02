const KEY = "gift_manager_static";
let state = JSON.parse(localStorage.getItem(KEY) || "{}");
state.campaigns ||= [];
state.logs ||= [];
state.tasks ||= [];

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function uid() {
  return Math.random().toString(36).slice(2);
}

const listView = document.getElementById("view-list");
const campaignView = document.getElementById("view-campaign");
const campaignList = document.getElementById("campaignList");

function showList() {
  listView.classList.remove("hidden");
  campaignView.classList.add("hidden");
  renderList();
}

function showCampaign(id) {
  currentId = id;
  listView.classList.add("hidden");
  campaignView.classList.remove("hidden");
  renderCampaign();
}

let currentId = null;

function renderList() {
  campaignList.innerHTML = "";
  state.campaigns.forEach(c => {
    const d = document.createElement("div");
    d.textContent = `${c.name} (${c.start_date})`;
    d.onclick = () => showCampaign(c.id);
    campaignList.appendChild(d);
  });
}

document.getElementById("createCampaignForm").onsubmit = e => {
  e.preventDefault();
  const f = new FormData(e.target);
  state.campaigns.push({
    id: uid(),
    name: f.get("name"),
    start_date: f.get("start_date"),
    source: f.get("source_mode")
  });
  save();
  e.target.reset();
  renderList();
};

function renderCampaign() {
  const c = state.campaigns.find(c => c.id === currentId);
  document.getElementById("campaignTitle").textContent = c.name;
  document.getElementById("campaignMeta").textContent = c.start_date;

  const board = document.getElementById("leaderboard");
  const map = {};
  state.logs.filter(l => l.campaign === currentId)
    .forEach(l => map[l.name] = (map[l.name] || 0) + l.pt);
  board.innerHTML = Object.entries(map)
    .map(([n,p]) => `<tr><td>${n}</td><td>${p}</td></tr>`).join("");

  const tasks = document.getElementById("tasks");
  tasks.innerHTML = state.tasks
    .filter(t => t.campaign === currentId)
    .map(t => `<div>${t.listener}: ${t.title}</div>`).join("");
}

document.querySelectorAll("[data-add]").forEach(b => {
  b.onclick = () => {
    const name = document.getElementById("listenerName").value;
    if (!name) return;
    state.logs.push({ campaign: currentId, name, pt: +b.dataset.add });
    save();
    renderCampaign();
  };
});

document.getElementById("undoBtn").onclick = () => {
  for (let i = state.logs.length - 1; i >= 0; i--) {
    if (state.logs[i].campaign === currentId) {
      state.logs.splice(i, 1);
      break;
    }
  }
  save();
  renderCampaign();
};

document.getElementById("taskForm").onsubmit = e => {
  e.preventDefault();
  const f = new FormData(e.target);
  state.tasks.push({
    campaign: currentId,
    listener: f.get("listener"),
    title: f.get("title")
  });
  save();
  e.target.reset();
  renderCampaign();
};

document.getElementById("backBtn").onclick = showList;

showList();
