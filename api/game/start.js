const { readJson, sendJson } = require("../../lib/http");
const { redis } = require("../../lib/redis");
const { validateInitData } = require("../../lib/initData");
const tg = require("../../lib/telegram");
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

  const userId = v.user?.id;
  if (!userId) return sendJson(res, 401, { ok: false });

  if (session.status !== "lobby") return sendJson(res, 400, { ok: false, reason: "not_lobby" });

  // host yoki chat admin
  let allowed = (userId === session.hostUserId);
  if (!allowed) {
    try {
      const m = await tg.getChatMember(session.chatId, userId);
      if (m?.status === "administrator" || m?.status === "creator") allowed = true;
    } catch {}
  }
  if (!allowed) return sendJson(res, 403, { ok: false, reason: "not_allowed" });

  const playerCount = Object.keys(session.players).length;
  if (playerCount < 5) return sendJson(res, 400, { ok: false, reason: "need_5_players" });

  game.startGame(session);
  await redis.set(`session:${sid}`, session);

  await tg.sendMessage(session.chatId,
    `🌙 O‘yin boshlandi!\n` +
    `O‘yinchilar soni: ${playerCount} ta\n` +
    `Mini App’da har kim o‘z rolini ko‘radi.`
  );

  return sendJson(res, 200, { ok: true });
};