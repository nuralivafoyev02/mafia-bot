const { readJson, sendJson } = require("../../lib/http");
const { redis } = require("../../lib/redis");
const tg = require("../../lib/telegram");
const game = require("../../lib/game");

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const APP_URL = process.env.APP_URL;

async function loadSessionByChat(chatId) {
  const sid = await redis.get(`chatActive:${chatId}`);
  if (!sid) return null;
  const s = await redis.get(`session:${sid}`);
  return s || null;
}

async function saveSession(session) {
  await redis.set(`session:${session.sid}`, session);
  await redis.sadd("activeSessions", session.sid);
  await redis.set(`chatActive:${session.chatId}`, session.sid);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false });

  // Telegram webhook secret header
  const hdr = req.headers["x-telegram-bot-api-secret-token"];
  if (WEBHOOK_SECRET && hdr !== WEBHOOK_SECRET) return sendJson(res, 401, { ok: false, reason: "bad_secret" });

  const update = await readJson(req);
  if (!update) return sendJson(res, 200, { ok: true });

  try {
    // /start (group) => create lobby
    if (update.message && update.message.text) {
      const msg = update.message;
      const chat = msg.chat;
      const from = msg.from;

      const text = msg.text.trim();
      const isGroup = (chat.type === "group" || chat.type === "supergroup");

      if (isGroup && (text === "/start" || text.startsWith("/start@"))) {
        // prevent multiple sessions
        const existing = await loadSessionByChat(chat.id);
        if (existing && existing.status !== "ended") {
          await tg.sendMessage(chat.id, "♻️ Bu guruhda allaqachon o‘yin ochiq. Mini App’ga kirib davom eting.");
          return sendJson(res, 200, { ok: true });
        }

        const session = game.createSession({
          chatId: chat.id,
          chatTitle: chat.title,
          hostUser: from
        });
        await saveSession(session);

        const proto = req.headers["x-forwarded-proto"] || "https";
        const host = req.headers["x-forwarded-host"] || req.headers["host"];
        const baseUrl = (APP_URL && APP_URL.startsWith("http")) ? APP_URL : `${proto}://${host}`;

        // /miniapp/ + sid
        const url = `${baseUrl}/miniapp/?sid=${session.sid}`;

        await tg.sendMessage(chat.id,
          `🎲 Mafia o‘yini ochildi!\n\n` +
          `⏳ Qo‘shilish uchun ${game.LOBBY_SECONDS}s vaqt.\n` +
          `✅ Mini App’ga kirib "Join" qiling.\n` +
          `⚠️ Eslatma: bot hamma memberlarni avtomatik ro‘yxat qilolmaydi — o‘ynaydiganlar o‘zi Join qiladi.`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: "🎮 Mini App", web_app: { url } }]]
            }
          }
        );

        return sendJson(res, 200, { ok: true });
      }

      if (isGroup && (text === "/stop" || text.startsWith("/stop@"))) {
        const existing = await loadSessionByChat(chat.id);
        if (existing) {
          existing.status = "ended";
          existing.phaseEndsAt = null;
          await redis.set(`session:${existing.sid}`, existing);
          await redis.del(`chatActive:${chat.id}`);
          await redis.srem("activeSessions", existing.sid);
          await tg.sendMessage(chat.id, "🛑 O‘yin yakunlandi.");
        }
        return sendJson(res, 200, { ok: true });
      }
    }

    return sendJson(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return sendJson(res, 200, { ok: true });
  }
};