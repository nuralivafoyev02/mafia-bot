const tg = window.Telegram?.WebApp;

// ------- helpers -------
function setText(id, txt){ document.getElementById(id).textContent = txt; }
function el(id){ return document.getElementById(id); }

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function roleLabel(r){
  if (!r) return "—";
  const map = { don:"DON", mafia:"MAFIA", komissar:"KOMISSAR", doctor:"DOCTOR", civil:"CIVIL" };
  return map[r] || r.toUpperCase();
}

function phaseLabel(s){
  const map = { lobby:"LOBBY", night:"NIGHT", day:"DAY", vote:"VOTE", ended:"ENDED" };
  return map[s] || String(s).toUpperCase();
}

// ------- SID: URL -> hash -> sessionStorage fallback (MUHIM FIX) -------
function getSidStable(){
  const u = new URL(location.href);

  // 1) query: ?sid=...
  let sid = u.searchParams.get("sid");

  // 2) hash: #sid=...
  if (!sid && location.hash) {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    sid = h.get("sid") || null;
  }

  // 3) storage fallback
  if (sid) {
    sessionStorage.setItem("sid", sid);
    return sid;
  }
  return sessionStorage.getItem("sid");
}

function getInitData(){
  return tg?.initData || "";
}

function showBlockScreen(title, desc){
  // popup spam o‘rniga UI
  document.body.innerHTML = `
    <div style="font-family:system-ui; padding:22px; line-height:1.4">
      <h1 style="margin:0 0 10px; font-size:28px">${escapeHtml(title)}</h1>
      <div style="opacity:.85; font-size:16px">${escapeHtml(desc)}</div>
      <div style="margin-top:14px; opacity:.85">✅ Guruhga qayting → botga <b>/start</b> yozing → chiqqan tugma orqali qayta kiring.</div>
    </div>
  `;
}

// ------- API -------
async function api(path, body){
  const r = await fetch(path, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body || {})
  });
  return r.json();
}

function fmtTimer(sec){
  if (!Number.isFinite(sec)) return "—";
  if (sec < 0) sec = 0;
  const m = Math.floor(sec/60);
  const s = sec % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function renderPlayers(players){
  const root = el("players");
  root.innerHTML = "";
  (players || []).forEach(p => {
    const d = document.createElement("div");
    d.className = "player";
    d.innerHTML = `
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">${p.alive ? "🟢 alive" : "🔴 dead"}</div>
    `;
    root.appendChild(d);
  });
}

function renderTargets(session, me){
  const root = el("targets");
  root.innerHTML = "";

  if (!session || !me) return;

  const alive = (session.players || []).filter(p => p.alive);
  alive.forEach(p => {
    const b = document.createElement("button");
    b.className = "btn target";
    b.textContent = p.name;
    b.onclick = async () => {
      const sid = getSidStable();
      if (!sid) return;

      let type = null;
      if (session.status === "night") {
        if (me.role === "doctor") type = "heal";
        else if (me.role === "komissar") type = "inspect";
        else if (me.role === "don" || me.role === "mafia") type = "kill";
      } else if (session.status === "vote") {
        type = "vote";
      }

      if (!type) return;
      const j = await api("/api/game/action", { sid, initData: getInitData(), type, targetId: p.id });
      if (!j.ok) {
        tg?.showPopup?.({ message: `Xatolik: ${j.reason || "action_failed"}` });
      }
    };
    root.appendChild(b);
  });
}

function setNote(note){
  const box = el("noteBox");
  if (note) {
    box.classList.remove("hidden");
    box.textContent = note;
  } else {
    box.classList.add("hidden");
    box.textContent = "";
  }
}

function updateUI(state){
  const s = state?.session;
  const me = state?.me;

  setText("chatTitle", s?.chatTitle || "…");
  setText("phasePill", phaseLabel(s?.status || "loading"));
  setText("meName", me?.name || "—");
  setText("meRole", roleLabel(me?.role));

  renderPlayers(s?.players || []);
  setNote(me?.note || null);

  // timer
  const now = Math.floor(Date.now()/1000);
  let ends = null;
  if (s?.status === "lobby") ends = s.joinEndsAt;
  else ends = s?.phaseEndsAt;
  const left = ends ? Math.max(0, ends - now) : null;
  setText("timer", left === null ? "—" : fmtTimer(left));

  // buttons
  const lobby = (s?.status === "lobby");
  el("lobbyActions").style.display = lobby ? "flex" : "none";
  el("actionCard").style.display = (s?.status === "night" || s?.status === "vote") ? "block" : "none";

  // action hint
  let hint = "—";
  if (s?.status === "night") {
    if (me?.role === "doctor") hint = "🩺 Shifokor: kimni davolaysiz?";
    else if (me?.role === "komissar") hint = "🕵️ Komissar: kimni tekshirasiz?";
    else if (me?.role === "don" || me?.role === "mafia") hint = "🔫 Mafia: kimni o‘ldirasiz?";
    else hint = "🌙 Tunda tinch aholi uxlaydi…";
  } else if (s?.status === "vote") {
    hint = "🗳️ Ovoz bering";
  }
  setText("actionHint", hint);
  renderTargets(s, me);
}

async function poll(){
  const sid = getSidStable();
  if (!sid) {
    showBlockScreen("Sessiya topilmadi (sid yo‘q)", "Mini App’ni bot yuborgan tugma orqali oching.");
    return;
  }

  const j = await api("/api/game/state", { sid, initData: getInitData() });

  if (!j.ok) {
    if (j.reason === "open_in_telegram") {
      showBlockScreen("Telegram ichidan oching", "Mini App’ni faqat Telegram ichidan ochish kerak.");
      return;
    }
    if (j.reason === "no_session") {
      showBlockScreen("Sessiya topilmadi (no_session)", "Guruhga qayting va /start orqali yangi sessiya oching.");
      return;
    }
    if (j.reason === "missing_sid") {
      showBlockScreen("Sessiya topilmadi (sid yo‘q)", "Mini App’ni bot yuborgan tugma orqali oching.");
      return;
    }
    tg?.showPopup?.({ message: `State xatolik: ${j.reason || "unknown"}` });
    return;
  }

  updateUI(j);
}

async function onJoin(){
  const sid = getSidStable();
  if (!sid) return;
  const j = await api("/api/game/join", { sid, initData: getInitData() });
  if (!j.ok) tg?.showPopup?.({ message: `Join xatolik: ${j.reason || "join_failed"}` });
  await poll();
}

async function onLeave(){
  const sid = getSidStable();
  if (!sid) return;
  const j = await api("/api/game/leave", { sid, initData: getInitData() });
  if (!j.ok) tg?.showPopup?.({ message: `Leave xatolik: ${j.reason || "leave_failed"}` });
  await poll();
}

async function onStartNow(){
  const sid = getSidStable();
  if (!sid) return;
  const j = await api("/api/game/start", { sid, initData: getInitData() });
  if (!j.ok) tg?.showPopup?.({ message: `Start xatolik: ${j.reason || "start_failed"}` });
  await poll();
}

function boot(){
  try { tg?.ready?.(); tg?.expand?.(); } catch {}

  el("btnJoin").onclick = onJoin;
  el("btnLeave").onclick = onLeave;
  el("btnStartNow").onclick = onStartNow;

  poll();
  setInterval(poll, 2000);
}

boot();