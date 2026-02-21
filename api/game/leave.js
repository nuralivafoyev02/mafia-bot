const { readJson, sendJson } = require("../../lib/http");
const { redis } = require("../../lib/redis");
const { validateInitData } = require("../../lib/initData");
const game = require("../../lib/game");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false });

  const body = await readJson(req);
  const sid = body?.sid;
  const initData = body?.initData;

  const v = validateInitData(initData, process.env.BOT_TOKEN);
  if (!v.ok) return sendJson(res, 401, { ok: false, reason: v.reason });

  const session = sid ? await redis.get(`session:${sid}`) : null;
  if (!session) return sendJson(res, 404, { ok: false });

  if (session.status !== "lobby") return sendJson(res, 400, { ok: false, reason: "not_lobby" });

  const userId = v.user?.id;
  if (!userId) return sendJson(res, 401, { ok: false });

  delete session.players[String(userId)];
  await redis.set(`session:${sid}`, session);

  return sendJson(res, 200, { ok: true, players: game.publicPlayerList(session) });
};