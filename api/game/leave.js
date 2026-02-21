const { readJson, sendJson } = require("../../lib/http");
const { redis } = require("../../lib/redis");
const { validateInitData } = require("../../lib/initData");
const tg = require("../../lib/telegram");
const game = require("../../lib/game");

async function cleanupEnded(session) {
  await redis.del(`chatActive:${session.chatId}`);
  await redis.srem("activeSessions", session.sid);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false });

  const body = await readJson(req);
  const sid = body?.sid;
  const initData = body?.initData;

  if (!sid) return sendJson(res, 400, { ok: false, reason: "missing_sid" });

  const v = validateInitData(initData, process.env.BOT_TOKEN);
  if (!v.ok) return sendJson(res, 401, { ok: false, reason: v.reason });

  const session = await redis.get(`session:${sid}`);
  if (!session) return sendJson(res, 404, { ok: false, reason: "no_session" });

  if (session.status !== "lobby") return sendJson(res, 400, { ok: false, reason: "not_lobby" });

  const userId = v.user?.id;
  if (!userId) return sendJson(res, 401, { ok: false, reason: "no_user" });

  // ✅ host chiqib ketsa: sessiyani yakunlaymiz (eng xavfsiz variant)
  if (userId === session.hostUserId) {
    session.status = "ended";
    session.phaseEndsAt = null;
    await redis.set(`session:${sid}`, session);
    await cleanupEnded(session);
    try { await tg.sendMessage(session.chatId, "🛑 O‘yin yakunlandi (host chiqib ketdi)."); } catch {}
    return sendJson(res, 200, { ok: true, ended: true });
  }

  delete session.players[String(userId)];
  await redis.set(`session:${sid}`, session);

  return sendJson(res, 200, { ok: true, players: game.publicPlayerList(session) });
};