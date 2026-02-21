const tg = window.Telegram?.WebApp;

function qs(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}
const sid = qs("sid");

function setText(id, txt){ document.getElementById(id).textContent = txt; }
function el(id){ return document.getElementById(id); }

function roleLabel(r){
  if (!r) return "—";
  const map = { don:"DON", mafia:"MAFIA", komissar:"KOMISSAR", doctor:"DOCTOR", civil:"CIVIL" };
  return map[r] || r.toUpperCase();
}

function phaseLabel(s){
  const map = { lobby:"LOBBY", night:"NIGHT", day:"DAY", vote:"VOTE", ended:"ENDED" };
  return map[s] || String(s).toUpperCase();
}

async function api(path, body){
  const r = await fetch(path, {
    method:"POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}

let state = null;
let timerInt = null;

function renderPlayers(players){
  const root = el("players");
  root.innerHTML = "";
  players.forEach(p=>{
    const d = document.createElement("div");
    d.className = "player";
    d.innerHTML = `
      <div class="name">${escapeHtml(p.name || "—")}</div>
      <div class="meta">@${escapeHtml(p.username || "anon")} • ID: ${p.id}</div>
      <div class="badge ${p.alive ? "alive":"dead"}">${p.alive ? "ALIVE":"DEAD"}</div>
    `;
    root.appendChild(d);
  });
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function updateTimer(){
  if (!state?.session) return;
  const now = Math.floor(Date.now()/1000);
  let end = state.session.status === "lobby" ? state.session.joinEndsAt : state.session.phaseEndsAt;
  if (!end) { setText("timer","—"); return; }
  const left = Math.max(0, end - now);
  const mm = String(Math.floor(left/60)).padStart(2,"0");
  const ss = String(left%60).padStart(2,"0");
  setText("timer", `${mm}:${ss}`);
}

function renderActionArea(){
  const s = state?.session;
  const me = state?.me;
  const actionHint = el("actionHint");
  const targets = el("targets");
  targets.innerHTML = "";

  if (!s || !me) {
    actionHint.textContent = "Avval Join qiling.";
    return;
  }
  if (s.status === "lobby") {
    actionHint.textContent = "Lobby: o‘yinchilar yig‘ilmoqda.";
    return;
  }
  if (s.status === "ended") {
    actionHint.textContent = "O‘yin tugadi.";
    return;
  }
  if (!me.alive) {
    actionHint.textContent = "Siz o‘yindan chiqqansiz (dead).";
    return;
  }

  const alive = s.players.filter(p=>p.alive && p.id !== me.id);

  if (s.status === "night") {
    if (me.role === "don" || me.role === "mafia") {
      actionHint.textContent = "🌙 Night: kimni yo‘q qilamiz? (Don ovozi ustun)";
      alive.forEach(p => addTargetButton(p, "Kill", "kill"));
      return;
    }
    if (me.role === "doctor") {
      actionHint.textContent = "🌙 Night: kimni davolaysiz?";
      s.players.filter(p=>p.alive).forEach(p => addTargetButton(p, "Heal", "heal"));
      return;
    }
    if (me.role === "komissar") {
      actionHint.textContent = "🌙 Night: kimni tekshirasiz?";
      alive.forEach(p => addTargetButton(p, "Inspect", "inspect"));
      return;
    }
    actionHint.textContent = "🌙 Night: siz uxlayapsiz 🙂";
    return;
  }

  if (s.status === "day") {
    actionHint.textContent = "☀️ Day: muhokama. Tez orada ovoz berish boshlanadi.";
    return;
  }

  if (s.status === "vote") {
    actionHint.textContent = "🗳️ Vote: kimni chiqaramiz?";
    alive.forEach(p => addTargetButton(p, "Vote", "vote"));
    return;
  }

  function addTargetButton(player, label, type){
    const row = document.createElement("div");
    row.className = "target";
    row.innerHTML = `
      <div>
        <div style="font-weight:900">${escapeHtml(player.name)}</div>
        <div style="color:var(--hint); font-size:12px">@${escapeHtml(player.username || "anon")}</div>
      </div>
      <button>${label}</button>
    `;
    row.querySelector("button").onclick = async () => {
      const resp = await api(`/api/game/action`, { sid, initData: tg.initData, type, targetId: player.id });
      if (!resp.ok) tg.showAlert(`Xatolik: ${resp.reason || "unknown"}`);
      else tg.hapticFeedback?.notificationOccurred("success");
      await refresh();
    };
    targets.appendChild(row);
  }
}

function renderMeNote(){
  const me = state?.me;
  const box = el("noteBox");
  if (me?.note && me.role === "komissar") {
    box.classList.remove("hidden");
    box.textContent = `🕵️ Tekshiruv: ID ${me.note.targetId} — ${me.note.isMafia ? "MAFIA" : "TINCH"}`;
  } else {
    box.classList.add("hidden");
  }
}

function render(){
  const s = state?.session;
  const me = state?.me;

  setText("phasePill", phaseLabel(s?.status || "loading"));
  setText("chatTitle", s?.chatTitle || "Guruh");

  setText("meName", me?.name || "—");
  setText("meRole", me?.role ? roleLabel(me.role) : "🔒 (o‘yin boshlanmagan)");

  // lobby buttons
  el("btnJoin").style.display = (!me && s?.status==="lobby") ? "inline-flex" : "none";
  el("btnLeave").style.display = (me && s?.status==="lobby") ? "inline-flex" : "none";
  el("btnStartNow").style.display = (s?.status==="lobby") ? "inline-flex" : "none";

  renderPlayers(s?.players || []);
  renderMeNote();
  renderActionArea();
  updateTimer();

  if (timerInt) clearInterval(timerInt);
  timerInt = setInterval(updateTimer, 500);
}

async function refresh(){
  const resp = await api(`/api/game/state`, { sid, initData: tg.initData });
  if (!resp.ok) {
    tg.showAlert(`State xatolik: ${resp.reason || "unknown"}`);
    return;
  }
  state = resp;
  render();
}

async function join(){
  const resp = await api(`/api/game/join`, { sid, initData: tg.initData });
  if (!resp.ok) tg.showAlert(`Join xatolik: ${resp.reason || "unknown"}`);
  await refresh();
}

async function leave(){
  const resp = await api(`/api/game/leave`, { sid, initData: tg.initData });
  if (!resp.ok) tg.showAlert(`Leave xatolik: ${resp.reason || "unknown"}`);
  await refresh();
}

async function startNow(){
  const resp = await api(`/api/game/start`, { sid, initData: tg.initData });
  if (!resp.ok) tg.showAlert(`Start xatolik: ${resp.reason || "unknown"}`);
  await refresh();
}

(function init(){
  if (!tg) {
    alert("Telegram WebApp topilmadi. Mini App’ni Telegram ichida oching.");
    return;
  }
  tg.ready();
  tg.expand();

  el("btnJoin").onclick = join;
  el("btnLeave").onclick = leave;
  el("btnStartNow").onclick = startNow;

  refresh();
  setInterval(refresh, 2500); // realtimega yaqin
})();