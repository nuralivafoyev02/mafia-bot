const crypto = require("crypto");

const LOBBY_SECONDS = 60;
const NIGHT_SECONDS = 45;
const DAY_SECONDS = 60;
const VOTE_SECONDS = 45;

function nowSec() { return Math.floor(Date.now() / 1000); }

// nanoid o‘rniga: URL-safe, qisqa ID
function newSid(len = 12) {
  return crypto.randomBytes(16).toString("base64url").slice(0, len);
}

// Rollar generatori: 5 => Don + Komissar + Doktor + 2 Civil
function buildRoles(n) {
  if (n < 5) return [];
  const roles = ["don", "komissar", "doctor"];

  // Qo‘shimcha mafia soni (Don’dan tashqari)
  // 6-7 => +1 mafia, 8-9 => +2 mafia, 10-11 => +3 mafia, ...
  const extraMafia = Math.max(0, Math.floor((n - 6) / 2) + 1); // n=6 =>1, n=7=>1, n=8=>2...
  for (let i = 0; i < extraMafia; i++) roles.push("mafia");

  while (roles.length < n) roles.push("civil");
  return roles;
}

function shuffle(arr) {
  // Fisher-Yates
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createSession({ chatId, chatTitle, hostUser }) {
  const sid = newSid(12);
  return {
    sid,
    chatId,
    chatTitle: chatTitle || "",
    createdAt: nowSec(),
    hostUserId: hostUser.id,
    status: "lobby",               // lobby | night | day | vote | ended
    round: 0,
    joinEndsAt: nowSec() + LOBBY_SECONDS,
    phaseEndsAt: null,
    players: {
      [String(hostUser.id)]: {
        id: hostUser.id,
        name: [hostUser.first_name, hostUser.last_name].filter(Boolean).join(" "),
        username: hostUser.username || "",
        joinedAt: nowSec(),
        alive: true,
        role: null
      }
    },
    night: { killVotes: {}, healTarget: null, inspectTarget: null, inspectNotes: {} },
    vote: { votes: {} },
    log: []
  };
}

function publicPlayerList(session) {
  return Object.values(session.players).map(p => ({
    id: p.id, name: p.name, username: p.username, alive: p.alive
  }));
}

function countAlive(session) {
  return Object.values(session.players).filter(p => p.alive).length;
}

function aliveIds(session) {
  return Object.values(session.players).filter(p => p.alive).map(p => p.id);
}

function roleOf(session, userId) {
  const p = session.players[String(userId)];
  return p?.role || null;
}

function startGame(session) {
  const ids = Object.keys(session.players).map(Number);
  const roles = buildRoles(ids.length);
  const shuffledRoles = shuffle(roles);

  // assign
  ids.forEach((id, idx) => { session.players[String(id)].role = shuffledRoles[idx]; });

  session.status = "night";
  session.round = 1;
  session.phaseEndsAt = nowSec() + NIGHT_SECONDS;
  session.night = { killVotes: {}, healTarget: null, inspectTarget: null, inspectNotes: {} };
  session.vote = { votes: {} };
  session.log.push({ ts: nowSec(), t: "start", text: `Game started with ${ids.length} players` });
  return session;
}

function mafiaIds(session) {
  return Object.values(session.players)
    .filter(p => p.alive && (p.role === "don" || p.role === "mafia"))
    .map(p => p.id);
}

function civCount(session) {
  const alive = Object.values(session.players).filter(p => p.alive);
  const mafia = alive.filter(p => p.role === "don" || p.role === "mafia").length;
  return alive.length - mafia;
}

function checkWin(session) {
  const mafiaAlive = mafiaIds(session).length;
  const civAlive = civCount(session);
  if (mafiaAlive === 0) return { ended: true, winner: "civilians" };
  if (mafiaAlive >= civAlive) return { ended: true, winner: "mafia" };
  return { ended: false };
}

function resolveNight(session) {
  // 1) Kill target: Don override, aks holda mafiya vote majority
  const mafia = mafiaIds(session);
  const votes = session.night.killVotes || {};

  // Don bor bo‘lsa uning ovozini ustun qilamiz
  const don = Object.values(session.players).find(p => p.alive && p.role === "don");
  let killTarget = null;

  if (don && votes[String(don.id)]) {
    killTarget = Number(votes[String(don.id)]);
  } else {
    const tally = new Map();
    for (const mid of mafia) {
      const v = votes[String(mid)];
      if (!v) continue;
      const t = Number(v);
      tally.set(t, (tally.get(t) || 0) + 1);
    }
    let best = null, bestC = 0;
    for (const [t, c] of tally.entries()) {
      if (c > bestC) { best = t; bestC = c; }
    }
    killTarget = best;
  }

  // 2) Doctor heal
  const heal = session.night.healTarget ? Number(session.night.healTarget) : null;

  // 3) Komissar inspect
  const kom = Object.values(session.players).find(p => p.alive && p.role === "komissar");
  if (kom && session.night.inspectTarget) {
    const targetId = Number(session.night.inspectTarget);
    const target = session.players[String(targetId)];
    if (target) {
      const isMafia = (target.role === "don" || target.role === "mafia");
      session.night.inspectNotes[String(kom.id)] = { targetId, isMafia, ts: nowSec() };
    }
  }

  let died = null;
  if (killTarget && killTarget !== heal) {
    const victim = session.players[String(killTarget)];
    if (victim && victim.alive) {
      victim.alive = false;
      died = victim;
    }
  }

  session.status = "day";
  session.phaseEndsAt = nowSec() + DAY_SECONDS;
  session.vote = { votes: {} };
  session.log.push({ ts: nowSec(), t: "night_end", text: died ? `Died: ${died.name}` : "No one died" });
  return { session, died };
}

function startVoting(session) {
  session.status = "vote";
  session.phaseEndsAt = nowSec() + VOTE_SECONDS;
  session.vote = { votes: {} };
  session.log.push({ ts: nowSec(), t: "vote_start", text: "Voting started" });
  return session;
}

function resolveVote(session) {
  const votes = session.vote.votes || {};
  const alive = aliveIds(session);
  const tally = new Map();
  for (const voterId of alive) {
    const t = votes[String(voterId)];
    if (!t) continue;
    const targetId = Number(t);
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }

  let best = null, bestC = 0;
  for (const [t, c] of tally.entries()) {
    if (c > bestC) { best = t; bestC = c; }
  }

  let eliminated = null;
  if (best) {
    const target = session.players[String(best)];
    if (target && target.alive) {
      target.alive = false;
      eliminated = target;
    }
  }

  const win = checkWin(session);
  if (win.ended) {
    session.status = "ended";
    session.phaseEndsAt = null;
    session.log.push({ ts: nowSec(), t: "end", text: `Winner: ${win.winner}` });
    return { session, eliminated, win };
  }

  // next night
  session.status = "night";
  session.round += 1;
  session.phaseEndsAt = nowSec() + NIGHT_SECONDS;
  session.night = { killVotes: {}, healTarget: null, inspectTarget: null, inspectNotes: session.night.inspectNotes || {} };
  session.log.push({ ts: nowSec(), t: "vote_end", text: eliminated ? `Eliminated: ${eliminated.name}` : "No elimination" });
  return { session, eliminated, win };
}

module.exports = {
  LOBBY_SECONDS, NIGHT_SECONDS, DAY_SECONDS, VOTE_SECONDS,
  nowSec,
  createSession,
  startGame,
  resolveNight,
  startVoting,
  resolveVote,
  publicPlayerList,
  checkWin,
  roleOf,
  mafiaIds,
  countAlive
};