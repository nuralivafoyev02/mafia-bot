/* global Telegram */

const tg = window.Telegram?.WebApp;

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

let sid = null;

function getSid() {
  // 1) URL ?sid=
  const fromUrl = qs("sid");
  if (fromUrl) {
    sessionStorage.setItem("mafia_sid", fromUrl);
    return fromUrl;
  }

  // 2) Telegram WebApp start_param (t.me/<bot>/<app>?startapp=SID)
  const fromStartParam = tg?.initDataUnsafe?.start_param;
  if (fromStartParam) {
    sessionStorage.setItem("mafia_sid", fromStartParam);
    return fromStartParam;
  }

  // 3) Refresh support
  const cached = sessionStorage.getItem("mafia_sid");
  return cached || null;
}

function showMissingSid() {
  document.body.innerHTML = `
    <div style="padding:28px; font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial; line-height:1.4">
      <h1 style="font-size:34px; margin:0 0 10px">Sessiya topilmadi (sid yo‘q)</h1>
      <p style="font-size:18px; color:#555; margin:0 0 18px">
        Mini App’ni bot yuborgan tugma (yoki t.me link) orqali oching.
      </p>
      <div style="font-size:18px">
        ✅ Guruhga qayting → botga <b>/start</b> yozing → chiqqan <b>🎮 Mini App</b> tugmasi orqali kiring.
      </div>
    </div>`;
}

function el(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const node = el(id);
  if (!node) return;
  node.textContent = text ?? "";
}

function setHtml(id, html) {
  const node = el(id);
  if (!node) return;
  node.innerHTML = html ?? "";
}

function fmtMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

async function api(path, body) {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => null);
    if (!data) return { ok: false, reason: "bad_json" };
    return data;
  } catch (e) {
    return { ok: false, reason: "network_error" };
  }
}

let state = null;

function render() {
  if (!state) return;

  setText("chatTitle", state.chatTitle || "—");
  setText("phasePill", state.phaseLabel || state.phase || "—");

  setText("meName", state.me?.name || "—");
  setText("meRole", state.me?.roleLabel || state.me?.role || "—");

  const endsAt = state.phaseEndsAt;
  if (endsAt) setText("timer", fmtMs(endsAt - Date.now()));
  else setText("timer", "—");

  el("btnJoin").disabled = !state.canJoin;
  el("btnLeave").disabled = !state.canLeave;
  el("btnStartNow").disabled = !state.canStart;

  const players = state.players || [];
  setHtml(
    "players",
    players
      .map((p) => {
        const alive = p.alive ? "✅" : "💀";
        const role = p.roleLabel ? ` <span class="role">(${p.roleLabel})</span>` : "";
        return `<div class="player">${alive} <b>${p.name}</b>${role}</div>`;
      })
      .join("")
  );

  // Targets
  const targets = el("targets");
  if (targets) {
    targets.innerHTML = "";
    const alive = players.filter((p) => p.alive);
    alive.forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "targetBtn";
      btn.textContent = p.name;
      btn.onclick = async () => {
        const resp = await api(`/api/game/action`, {
          sid,
          initData: tg.initData,
          targetUserId: p.userId,
        });

        if (!resp.ok) {
          const reason = resp.error || resp.reason || "unknown";
          if (reason === "no_session") {
            if (window.__mafia_refresh_timer) clearInterval(window.__mafia_refresh_timer);
            showMissingSid();
            return;
          }
          tg.showAlert(`Xatolik: ${reason}`);
        } else {
          state = resp;
          render();
        }
      };
      targets.appendChild(btn);
    });
  }

  // Hints
  setText("actionHint", state.phase === "night" ? "🌙 Kechasi rolingiz bo‘yicha harakat qiling." : "☀️ Kunduzi ovoz bering.");
}

async function refresh() {
  const resp = await api(`/api/game/state`, { sid, initData: tg.initData });

  if (!resp.ok) {
    const reason = resp.error || resp.reason || "unknown";

    if (reason === "no_session") {
      if (window.__mafia_refresh_timer) clearInterval(window.__mafia_refresh_timer);
      showMissingSid();
      return;
    }

    if (reason === "bad_init_data") {
      tg.showAlert("Telegram initData xato. Mini App’ni bot yuborgan tugma orqali Telegram ichida oching.");
      return;
    }

    tg.showAlert(`State xatolik: ${reason}`);
    return;
  }

  state = resp;
  render();
}

async function join() {
  const resp = await api(`/api/game/join`, { sid, initData: tg.initData });
  if (!resp.ok) {
    const reason = resp.error || resp.reason || "unknown";
    if (reason === "no_session") {
      if (window.__mafia_refresh_timer) clearInterval(window.__mafia_refresh_timer);
      showMissingSid();
      return;
    }
    tg.showAlert(`Join xatolik: ${reason}`);
    return;
  }
  state = resp;
  render();
}

async function leave() {
  const resp = await api(`/api/game/leave`, { sid, initData: tg.initData });
  if (!resp.ok) {
    const reason = resp.error || resp.reason || "unknown";
    if (reason === "no_session") {
      if (window.__mafia_refresh_timer) clearInterval(window.__mafia_refresh_timer);
      showMissingSid();
      return;
    }
    tg.showAlert(`Leave xatolik: ${reason}`);
    return;
  }
  state = resp;
  render();
}

async function startNow() {
  const resp = await api(`/api/game/start`, { sid, initData: tg.initData });
  if (!resp.ok) {
    const reason = resp.error || resp.reason || "unknown";
    if (reason === "no_session") {
      if (window.__mafia_refresh_timer) clearInterval(window.__mafia_refresh_timer);
      showMissingSid();
      return;
    }
    tg.showAlert(`Start xatolik: ${reason}`);
    return;
  }
  state = resp;
  render();
}

(function init() {
  if (!tg) {
    alert("Telegram WebApp topilmadi. Mini App’ni Telegram ichida oching.");
    return;
  }

  sid = getSid();
  if (!sid) {
    showMissingSid();
    return;
  }

  if (!tg.initData) {
    alert("Telegram initData yo‘q. Mini App’ni bot yuborgan tugma orqali Telegram ichida oching.");
    return;
  }

  tg.ready();
  tg.expand();

  el("btnJoin").onclick = join;
  el("btnLeave").onclick = leave;
  el("btnStartNow").onclick = startNow;

  refresh();
  window.__mafia_refresh_timer && clearInterval(window.__mafia_refresh_timer);
  window.__mafia_refresh_timer = setInterval(refresh, 2500);
})();