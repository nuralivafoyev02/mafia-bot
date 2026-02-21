const crypto = require("crypto");

// nanoid (latest) is ESM-only and breaks require() on Vercel. Use a small CJS-safe id generator.
function makeId(len = 12) {
  return crypto
    .randomBytes(Math.ceil((len * 3) / 4))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
    .slice(0, len);
}

function createSession({ chatId, chatTitle }) {
  const sid = makeId(12);
  return {
    sid,
    chatId,
    chatTitle: chatTitle || "",
    createdAt: Date.now(),
    status: "lobby",
    phase: "lobby",
    phaseEndsAt: null,
    hostUserId: null,
    players: [],
    day: 0,
    logs: [],
    lastTickAt: 0,
    lastBroadcastAt: 0,
    config: {
      minPlayers: 5,
      maxPlayers: 12,
      dayMs: 90_000,
      nightMs: 60_000,
      revealRolesAtEnd: true,
    },
    votes: {
      type: null,
      by: {},
      startedAt: null,
      endsAt: null,
    },
    night: {
      actions: {},
      resolvedAt: null,
    },
  };
}

function roleLabel(role) {
  switch (role) {
    case "mafia":
      return "🕵️‍♂️ Mafia";
    case "doctor":
      return "🧑‍⚕️ Doctor";
    case "detective":
      return "🕵️ Detective";
    case "civil":
    default:
      return "🙂 Civil";
  }
}

function phaseLabel(phase) {
  switch (phase) {
    case "lobby":
      return "🟣 Lobby";
    case "day":
      return "☀️ Day";
    case "night":
      return "🌙 Night";
    case "ended":
      return "🛑 Ended";
    default:
      return phase;
  }
}

function alivePlayers(session) {
  return session.players.filter((p) => p.alive);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assignRoles(session) {
  const n = session.players.length;
  // Basic balancing:
  // 5-6: 2 mafia, 1 doctor, 1 detective
  // 7-9: 2 mafia, 1 doctor, 1 detective
  // 10-12: 3 mafia, 1 doctor, 1 detective
  let mafiaCount = 2;
  if (n >= 10) mafiaCount = 3;

  const roles = [];
  for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
  roles.push("doctor");
  roles.push("detective");
  while (roles.length < n) roles.push("civil");

  const shuffledRoles = shuffle(roles);
  session.players.forEach((p, idx) => {
    p.role = shuffledRoles[idx];
    p.roleLabel = roleLabel(p.role);
    p.alive = true;
  });
}

function canStart(session, userId) {
  if (session.status !== "lobby") return false;
  if (session.players.length < session.config.minPlayers) return false;
  if (!session.hostUserId) return false;
  return session.hostUserId === userId;
}

function startGame(session) {
  session.status = "running";
  session.day = 1;
  session.phase = "day";
  session.phaseEndsAt = Date.now() + session.config.dayMs;
  session.votes = { type: "lynch", by: {}, startedAt: Date.now(), endsAt: session.phaseEndsAt };
  session.logs.push({ t: Date.now(), msg: `Game started. Day ${session.day}.` });
}

function tallyVotes(session) {
  const by = session.votes?.by || {};
  const counts = new Map();
  for (const voterId of Object.keys(by)) {
    const targetId = by[voterId];
    if (!targetId) continue;
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [k, v] of counts.entries()) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return { targetId: best, count: bestCount, counts };
}

function killPlayer(session, userId, reason) {
  const p = session.players.find((x) => String(x.userId) === String(userId));
  if (!p || !p.alive) return false;
  p.alive = false;
  session.logs.push({ t: Date.now(), msg: `${p.name} died (${reason}).` });
  return true;
}

function checkWin(session) {
  const alive = alivePlayers(session);
  const mafia = alive.filter((p) => p.role === "mafia").length;
  const non = alive.length - mafia;

  if (mafia === 0) return { ended: true, winner: "civils" };
  if (mafia >= non) return { ended: true, winner: "mafia" };
  return { ended: false, winner: null };
}

function endGame(session, winner) {
  session.status = "ended";
  session.phase = "ended";
  session.phaseEndsAt = Date.now();
  session.logs.push({ t: Date.now(), msg: `Game ended. Winner: ${winner}.` });
  session.winner = winner;
}

function toPublicState(session, meUserId) {
  const me = session.players.find((p) => String(p.userId) === String(meUserId)) || null;

  return {
    ok: true,
    sid: session.sid,
    chatId: session.chatId,
    chatTitle: session.chatTitle,
    status: session.status,
    phase: session.phase,
    phaseLabel: phaseLabel(session.phase),
    phaseEndsAt: session.phaseEndsAt,
    day: session.day,
    winner: session.winner || null,
    canJoin: session.status === "lobby" && !me,
    canLeave: session.status === "lobby" && !!me,
    canStart: canStart(session, meUserId),
    players: session.players.map((p) => ({
      userId: p.userId,
      name: p.name,
      alive: p.alive,
      // role is hidden for others:
      role: me && String(me.userId) === String(p.userId) ? p.role : null,
      roleLabel: me && String(me.userId) === String(p.userId) ? p.roleLabel : null,
    })),
    me: me
      ? {
          userId: me.userId,
          name: me.name,
          role: me.role,
          roleLabel: me.roleLabel,
          alive: me.alive,
        }
      : null,
    logs: session.logs.slice(-30),
  };
}

function applyVote(session, voterId, targetId) {
  if (!session.votes || session.votes.type !== "lynch") return { ok: false, reason: "no_vote_phase" };
  const voter = session.players.find((p) => String(p.userId) === String(voterId));
  if (!voter || !voter.alive) return { ok: false, reason: "not_alive" };
  const target = session.players.find((p) => String(p.userId) === String(targetId));
  if (!target || !target.alive) return { ok: false, reason: "bad_target" };

  session.votes.by[String(voterId)] = String(targetId);
  return { ok: true };
}

function applyNightAction(session, actorId, action, targetId) {
  if (session.phase !== "night") return { ok: false, reason: "not_night" };
  const actor = session.players.find((p) => String(p.userId) === String(actorId));
  if (!actor || !actor.alive) return { ok: false, reason: "not_alive" };

  const target = session.players.find((p) => String(p.userId) === String(targetId));
  if (!target || !target.alive) return { ok: false, reason: "bad_target" };

  // Permissions by role
  if (action === "kill" && actor.role !== "mafia") return { ok: false, reason: "forbidden" };
  if (action === "heal" && actor.role !== "doctor") return { ok: false, reason: "forbidden" };
  if (action === "check" && actor.role !== "detective") return { ok: false, reason: "forbidden" };

  session.night.actions[String(actorId)] = { action, targetId: String(targetId) };
  return { ok: true };
}

function resolveNight(session) {
  // Determine mafia target (majority among mafia kills)
  const mafia = session.players.filter((p) => p.alive && p.role === "mafia");
  const doctor = session.players.find((p) => p.alive && p.role === "doctor");
  const detective = session.players.find((p) => p.alive && p.role === "detective");

  const acts = session.night.actions || {};
  const mafiaKills = [];
  for (const m of mafia) {
    const a = acts[String(m.userId)];
    if (a?.action === "kill") mafiaKills.push(a.targetId);
  }
  let killTargetId = null;
  if (mafiaKills.length > 0) {
    // majority vote
    const c = new Map();
    for (const t of mafiaKills) c.set(t, (c.get(t) || 0) + 1);
    let best = null;
    let bestCount = 0;
    for (const [k, v] of c.entries()) {
      if (v > bestCount) {
        best = k;
        bestCount = v;
      }
    }
    killTargetId = best;
  }

  const healTargetId = doctor ? acts[String(doctor.userId)]?.action === "heal" ? acts[String(doctor.userId)]?.targetId : null : null;
  const checkTargetId = detective ? acts[String(detective.userId)]?.action === "check" ? acts[String(detective.userId)]?.targetId : null : null;

  if (checkTargetId && detective) {
    const target = session.players.find((p) => String(p.userId) === String(checkTargetId));
    if (target) {
      session.logs.push({
        t: Date.now(),
        msg: `Detective checked ${target.name}: ${target.role === "mafia" ? "MAFIA" : "NOT MAFIA"}.`,
        privateTo: String(detective.userId),
      });
    }
  }

  if (killTargetId) {
    if (healTargetId && String(healTargetId) === String(killTargetId)) {
      const target = session.players.find((p) => String(p.userId) === String(killTargetId));
      if (target) session.logs.push({ t: Date.now(), msg: `${target.name} was attacked but healed!` });
    } else {
      killPlayer(session, killTargetId, "night_kill");
    }
  }

  session.night.actions = {};
  session.night.resolvedAt = Date.now();
}

function tick(session) {
  if (session.status !== "running") return session;

  if (!session.phaseEndsAt) return session;

  const now = Date.now();
  if (now < session.phaseEndsAt) return session;

  if (session.phase === "day") {
    // Resolve lynch vote
    const { targetId } = tallyVotes(session);
    if (targetId) killPlayer(session, targetId, "lynch");

    const win = checkWin(session);
    if (win.ended) {
      endGame(session, win.winner);
      return session;
    }

    // Move to night
    session.phase = "night";
    session.phaseEndsAt = now + session.config.nightMs;
    session.votes = { type: null, by: {}, startedAt: null, endsAt: null };
    session.logs.push({ t: now, msg: `Night ${session.day} started.` });
    return session;
  }

  if (session.phase === "night") {
    resolveNight(session);

    const win = checkWin(session);
    if (win.ended) {
      endGame(session, win.winner);
      return session;
    }

    // Move to next day
    session.day += 1;
    session.phase = "day";
    session.phaseEndsAt = now + session.config.dayMs;
    session.votes = { type: "lynch", by: {}, startedAt: now, endsAt: session.phaseEndsAt };
    session.logs.push({ t: now, msg: `Day ${session.day} started.` });
    return session;
  }

  return session;
}

module.exports = {
  createSession,
  assignRoles,
  canStart,
  startGame,
  toPublicState,
  applyVote,
  applyNightAction,
  tick,
};