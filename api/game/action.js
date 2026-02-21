const { readJson, sendJson } = require("../../lib/http");
const { redis } = require("../../lib/redis");
const { validateInitData } = require("../../lib/initData");
const tg = require("../../lib/telegram");
const game = require("../../lib/game");

function allAliveVoted(session) {
  const alive = Object.values(session.players).filter(p => p.alive).map(p => String(p.id));
  return alive.every(id => session.vote.votes[id]);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false });

  const body = await readJson(req);
  const sid = body?.sid;
  const initData = body?.initData;
  const type = body?.type;       // "kill" | "heal" | "inspect" | "vote"
  const targetId = body?.targetId;

  const v = validateInitData(initData, process.env.BOT_TOKEN);
  if (!v.ok) return sendJson(res, 401, { ok: false, reason: v.reason });

  const session = sid ? await redis.get(`session:${sid}`) : null;
  if (!session) return sendJson(res, 404, { ok: false });

  const userId = v.user?.id;
  const me = session.players[String(userId)];
  if (!me) return sendJson(res, 400, { ok: false, reason: "not_joined" });
  if (!me.alive) return sendJson(res, 400, { ok: false, reason: "dead" });

  const tId = Number(targetId);

  if (session.status === "night") {
    const role = me.role;

    if (type === "kill") {
      if (!(role === "don" || role === "mafia")) return sendJson(res, 403, { ok: false, reason: "not_mafia" });
      session.night.killVotes[String(userId)] = tId;
    }

    if (type === "heal") {
      if (role !== "doctor") return sendJson(res, 403, { ok: false, reason: "not_doctor" });
      session.night.healTarget = tId;
    }

    if (type === "inspect") {
      if (role !== "komissar") return sendJson(res, 403, { ok: false, reason: "not_komissar" });
      session.night.inspectTarget = tId;
    }

    await redis.set(`session:${sid}`, session);
    return sendJson(res, 200, { ok: true });
  }

  if (session.status === "vote") {
    if (type !== "vote") return sendJson(res, 400, { ok: false, reason: "bad_type" });
    session.vote.votes[String(userId)] = tId;
    await redis.set(`session:${sid}`, session);

    // hamma ovoz bersa — darhol resolve (cron bo‘lmasa ham yuradi)
    if (allAliveVoted(session)) {
      const { session: s2, eliminated, win } = game.resolveVote(session);
      await redis.set(`session:${sid}`, s2);

      if (eliminated) {
        await tg.sendMessage(s2.chatId, `🗳️ Ovoz berish yakuni: ${eliminated.name} o‘yindan chiqdi.`);
      } else {
        await tg.sendMessage(s2.chatId, `🗳️ Ovoz berish yakuni: hech kim chiqmaydi.`);
      }

      if (win.ended) {
        // reveal roles
        const reveal = Object.values(s2.players)
          .map(p => `• ${p.name} — ${p.role.toUpperCase()}`)
          .join("\n");
        await tg.sendMessage(s2.chatId, `🏁 O‘yin tugadi! G‘olib: ${win.winner.toUpperCase()}\n\nRollar:\n${reveal}`);
        await redis.del(`chatActive:${s2.chatId}`);
        await redis.srem("activeSessions", s2.sid);
      }
    }

    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 400, { ok: false, reason: "wrong_phase" });
};