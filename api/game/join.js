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
  if (!session) return sendJson(res, 404, { ok: false, reason: "no_session" });

  const user = v.user;
  if (!user?.id) return sendJson(res, 401, { ok: false, reason: "no_user" });

  // membership check (recommended)
  try {
    await tg.getChatMember(session.chatId, user.id);
  } catch {
    // agar bot admin bo‘lmasa, getChatMember kafolatli ishlamasligi mumkin :contentReference[oaicite:11]{index=11}
    // shu sababli, fallback: baribir join qilamiz (xohlasang bu yerda return 403 qil).
  }

  if (session.status !== "lobby") return sendJson(res, 400, { ok: false, reason: "not_lobby" });
  if (game.nowSec() > session.joinEndsAt) return sendJson(res, 400, { ok: false, reason: "lobby_closed" });

  const id = String(user.id);
  if (!session.players[id]) {
    session.players[id] = {
      id: user.id,
      name: [user.first_name, user.last_name].filter(Boolean).join(" "),
      username: user.username || "",
      joinedAt: game.nowSec(),
      alive: true,
      role: null
    };
  }

  await redis.set(`session:${sid}`, session);

  return sendJson(res, 200, {
    ok: true,
    session: {
      status: session.status,
      joinEndsAt: session.joinEndsAt,
      players: game.publicPlayerList(session)
    }
  });
};