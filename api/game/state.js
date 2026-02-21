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

  const userId = v.user?.id;
  if (!userId) return sendJson(res, 401, { ok: false, reason: "no_user" });

  // membership check (best effort). getChatMember admin bo‘lsa ishonchli. :contentReference[oaicite:10]{index=10}
  try { await tg.getChatMember(session.chatId, userId); } catch {}

  const me = session.players[String(userId)] || null;
  const myRole = me?.role || null;

  // Komissar uchun private note
  const note = session.night?.inspectNotes?.[String(userId)] || null;

  return sendJson(res, 200, {
    ok: true,
    session: {
      sid: session.sid,
      chatTitle: session.chatTitle,
      status: session.status,
      joinEndsAt: session.joinEndsAt,
      phaseEndsAt: session.phaseEndsAt,
      round: session.round,
      players: game.publicPlayerList(session)
    },
    me: me ? { id: me.id, name: me.name, alive: me.alive, role: myRole, note } : null
  });
};