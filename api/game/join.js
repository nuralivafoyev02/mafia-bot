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

  if (!sid) return sendJson(res, 400, { ok: false, reason: "missing_sid" });

  const v = validateInitData(initData, process.env.BOT_TOKEN);
  if (!v.ok) return sendJson(res, 401, { ok: false, reason: v.reason });

  const session = await redis.get(`session:${sid}`);
  if (!session) return sendJson(res, 404, { ok: false, reason: "no_session" });

  const user = v.user;
  if (!user?.id) return sendJson(res, 401, { ok: false, reason: "no_user" });

  // membership check (best effort)
  try {
    await tg.getChatMember(session.chatId, user.id);
  } catch {
    // bot admin bo'lmasa ba'zan getChatMember ishlamasligi mumkin.
    // fallback: baribir davom etamiz.
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