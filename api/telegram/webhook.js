const { sendJson } = require("../../lib/http");
const { tg } = require("../../lib/telegram");
const { redis } = require("../../lib/redis");
const game = require("../../lib/game");

const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const BOT_USERNAME = (process.env.BOT_USERNAME || "").replace(/^@/, "");
const WEBAPP_SHORTNAME = process.env.WEBAPP_SHORTNAME || "";
const WEBAPP_DEEPLINK_BASE = process.env.WEBAPP_DEEPLINK_BASE || ""; // optional: e.g. https://t.me/mybot/myapp?startapp=

function isGroup(chat) {
  return chat?.type === "group" || chat?.type === "supergroup";
}

function parseCommand(text = "") {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const first = t.split(/\s+/)[0];
  const cmd = first.split("@")[0].toLowerCase();
  return cmd;
}

function buildWebAppDeepLink(sid) {
  const payload = encodeURIComponent(String(sid || ""));
  if (WEBAPP_DEEPLINK_BASE) {
    if (WEBAPP_DEEPLINK_BASE.includes("startapp=")) return `${WEBAPP_DEEPLINK_BASE}${payload}`;
    const joiner = WEBAPP_DEEPLINK_BASE.includes("?") ? "&" : "?";
    return `${WEBAPP_DEEPLINK_BASE}${joiner}startapp=${payload}`;
  }
  if (BOT_USERNAME && WEBAPP_SHORTNAME) {
    return `https://t.me/${BOT_USERNAME}/${WEBAPP_SHORTNAME}?startapp=${payload}`;
  }
  // Fallback (external browser; initData bo‘lmaydi)
  if (APP_URL) return `${APP_URL}/miniapp/?sid=${payload}`;
  return "";
}

async function getText(update) {
  return update?.message?.text || update?.edited_message?.text || "";
}

async function getChat(update) {
  return update?.message?.chat || update?.edited_message?.chat || null;
}

async function loadSessionByChat(chatId) {
  const sid = await redis.get(`chatActive:${chatId}`);
  if (!sid) return null;
  const s = await redis.get(`session:${sid}`);
  return s || null;
}

async function saveSession(session) {
  await redis.set(`session:${session.sid}`, session);
  await redis.set(`chatActive:${session.chatId}`, session.sid);
  await redis.sadd(`activeSessions`, session.sid);
}

async function cleanupSession(session) {
  if (!session?.sid) return;
  await redis.del(`session:${session.sid}`);
  await redis.del(`chatActive:${session.chatId}`);
  await redis.srem(`activeSessions`, session.sid);
}

async function sendOpenLink(chatId, sid, { isExisting = false } = {}) {
  const openUrl = buildWebAppDeepLink(sid);

  const text = isExisting
    ? "♻️ Bu guruhda o‘yin allaqachon ochiq. Mini App’ga shu tugma orqali kiring:"
    : "🎲 Mafia o‘yini ochildi!\n\n1) Pastdagi tugmani bosing\n2) Mini App’da ✅ Join qiling\n3) Hammangiz tayyor bo‘lgach 🚀 Start now (faqat boshlovchi)\n\nP.S. Agar tugma ishlamasa, BotFather’da Web App (Mini App) short name va URL sozlanganini tekshiring.";

  if (!openUrl) {
    await tg.sendMessage(chatId, text + "\n\n❗️Deep link topilmadi. ENV tekshiring: BOT_USERNAME va WEBAPP_SHORTNAME.", {});
    return;
  }

  await tg.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [[{ text: "🎮 Mini App (Telegram)", url: openUrl }]],
    },
    disable_web_page_preview: true,
  });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return sendJson(res, 200, { ok: true });

    const update = req.body || {};
    const text = await getText(update);
    const cmd = parseCommand(text);

    const chat = await getChat(update);
    if (!chat) return sendJson(res, 200, { ok: true });

    if (!cmd) return sendJson(res, 200, { ok: true });

    if (cmd === "/start") {
      if (!isGroup(chat)) {
        await tg.sendMessage(
          chat.id,
          "👋 Bu bot guruhdagi Mafia o‘yinini boshqaradi.\n\n✅ Guruhda botni admin qiling → guruhga /start yozing → chiqqan tugma orqali Mini App’ga kiring.",
          {}
        );
        return sendJson(res, 200, { ok: true });
      }

      let existing = await loadSessionByChat(chat.id);

      if (existing && existing.status === "ended") {
        await redis.del(`chatActive:${chat.id}`);
        existing = null;
      }

      if (existing && existing.status !== "ended") {
        await sendOpenLink(chat.id, existing.sid, { isExisting: true });
        return sendJson(res, 200, { ok: true });
      }

      const session = game.createSession({
        chatId: chat.id,
        chatTitle: chat.title || "",
      });

      await saveSession(session);

      try {
        await sendOpenLink(chat.id, session.sid, { isExisting: false });
      } catch (e) {
        await cleanupSession(session); // “stuck session” bo‘lib qolmasin
        throw e;
      }

      return sendJson(res, 200, { ok: true });
    }

    if (cmd === "/stop") {
      if (!isGroup(chat)) {
        await tg.sendMessage(chat.id, "Bu buyruq faqat guruhda ishlaydi.", {});
        return sendJson(res, 200, { ok: true });
      }

      const existing = await loadSessionByChat(chat.id);
      if (!existing) {
        await tg.sendMessage(chat.id, "Hozir o‘yin topilmadi.", {});
        return sendJson(res, 200, { ok: true });
      }

      existing.status = "ended";
      existing.phase = "ended";
      existing.phaseEndsAt = Date.now();

      await redis.set(`session:${existing.sid}`, existing);
      await redis.del(`chatActive:${chat.id}`);
      await redis.srem(`activeSessions`, existing.sid);

      await tg.sendMessage(chat.id, "🛑 O‘yin yakunlandi.", {});
      return sendJson(res, 200, { ok: true });
    }

    // Optional: /open -> tugmani qayta chiqaradi
    if (cmd === "/open") {
      if (!isGroup(chat)) return sendJson(res, 200, { ok: true });
      const existing = await loadSessionByChat(chat.id);
      if (!existing || existing.status === "ended") {
        await tg.sendMessage(chat.id, "Hozir o‘yin ochiq emas. /start yozing.", {});
        return sendJson(res, 200, { ok: true });
      }
      await sendOpenLink(chat.id, existing.sid, { isExisting: true });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error(err);
    return sendJson(res, 200, { ok: true });
  }
};