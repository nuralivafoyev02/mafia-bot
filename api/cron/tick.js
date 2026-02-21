const { sendJson } = require("../../lib/http");
const { redis } = require("../../lib/redis");
const tg = require("../../lib/telegram");
const game = require("../../lib/game");

module.exports = async (req, res) => {
  // ixtiyoriy himoya
  if (process.env.CRON_SECRET) {
    const provided = req.headers["authorization"];
    if (provided !== `Bearer ${process.env.CRON_SECRET}`) return sendJson(res, 401, { ok: false });
  }

  const now = game.nowSec();
  const sids = await redis.smembers("activeSessions");

  for (const sid of (sids || [])) {
    const session = await redis.get(`session:${sid}`);
    if (!session) continue;
    if (session.status === "ended") continue;

    // LOBBY => auto start yoki cancel
    if (session.status === "lobby" && now > session.joinEndsAt) {
      const playerCount = Object.keys(session.players).length;

      if (playerCount < 5) {
        session.status = "ended";
        await redis.set(`session:${sid}`, session);
        await redis.del(`chatActive:${session.chatId}`);
        await redis.srem("activeSessions", sid);
        await tg.sendMessage(session.chatId, "❌ O‘yin bekor qilindi: kamida 5 ta o‘yinchi kerak.");
        continue;
      }

      game.startGame(session);
      await redis.set(`session:${sid}`, session);
      await tg.sendMessage(session.chatId, `🌙 O‘yin boshlandi! O‘yinchilar: ${playerCount}`);
      continue;
    }

    // NIGHT => resolve => DAY
    if (session.status === "night" && session.phaseEndsAt && now > session.phaseEndsAt) {
      const { session: s2, died } = game.resolveNight(session);
      await redis.set(`session:${sid}`, s2);

      await tg.sendMessage(s2.chatId,
        died ? `☀️ Tong otdi… ${died.name} o‘yindan chiqdi.` : `☀️ Tong otdi… Bugun hech kim o‘lmadi.`
      );
      continue;
    }

    // DAY => VOTE
    if (session.status === "day" && session.phaseEndsAt && now > session.phaseEndsAt) {
      game.startVoting(session);
      await redis.set(`session:${sid}`, session);
      await tg.sendMessage(session.chatId, "🗳️ Ovoz berish boshlandi (Mini App).");
      continue;
    }

    // VOTE => resolve
    if (session.status === "vote" && session.phaseEndsAt && now > session.phaseEndsAt) {
      const { session: s2, eliminated, win } = game.resolveVote(session);
      await redis.set(`session:${sid}`, s2);

      if (eliminated) await tg.sendMessage(s2.chatId, `🗳️ Yakun: ${eliminated.name} o‘yindan chiqdi.`);
      else await tg.sendMessage(s2.chatId, `🗳️ Yakun: hech kim chiqmaydi.`);

      if (win.ended) {
        const reveal = Object.values(s2.players).map(p => `• ${p.name} — ${p.role.toUpperCase()}`).join("\n");
        await tg.sendMessage(s2.chatId, `🏁 O‘yin tugadi! G‘olib: ${win.winner.toUpperCase()}\n\nRollar:\n${reveal}`);
        await redis.del(`chatActive:${s2.chatId}`);
        await redis.srem("activeSessions", s2.sid);
      }
    }
  }

  return sendJson(res, 200, { ok: true, checked: (sids || []).length });
};