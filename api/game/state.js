const { readJson, sendJson } = require("../../lib/http");
const { redis } = require("../../lib/redis");
const { validateInitData } = require("../../lib/initData");
const tg = require("../../lib/telegram");
const game = require("../../lib/game");

// no_initData bo'lsa 401 bermaymiz (logni to'ldirmaslik uchun)
function authOrSoftFail(initData, botToken) {
  const v = validateInitData(initData, botToken);
  if (v.ok) return { ok: true, v };

  // Telegram ichidan ochilmagan (yoki initData kelmagan) holat
  if (v.reason === "no_initData") {
    return { ok: false, soft: true, reason: "open_in_telegram" };
  }

  // qolganlari haqiqiy auth xato
  return { ok: false, soft: false, reason: v.reason };
}

async function cleanupEnded(session) {
  await redis.del(`chatActive:${session.chatId}`);
  await redis.srem("activeSessions", session.sid);
}

// Cron bo'lmasa ham yurishi uchun: STATE chaqirilganda phase'larni best-effort advance qilamiz.
// (bu funksiyalarni o'chirmaydi, faqat qo'shimcha barqarorlik)
async function maybeAdvance(session) {
  const now = game.nowSec();
  let changed = false;

  // LOBBY timeout: auto start yoki cancel
  if (session.status === "lobby" && now > session.joinEndsAt) {
    const playerCount = Object.keys(session.players).length;

    if (playerCount < 5) {
      session.status = "ended";
      session.phaseEndsAt = null;
      changed = true;
      await tg.sendMessage(session.chatId, "❌ O‘yin bekor qilindi: kamida 5 ta o‘yinchi kerak.");
      await cleanupEnded(session);
      return { session, changed };
    }

    game.startGame(session);
    changed = true;
    await tg.sendMessage(session.chatId, `🌙 O‘yin boshlandi! O‘yinchilar: ${playerCount}`);
    return { session, changed };
  }

  // NIGHT timeout => resolve => DAY (yoki win bo'lsa END)
  if (session.status === "night" && session.phaseEndsAt && now > session.phaseEndsAt) {
    const { session: s2, died } = game.resolveNight(session);
    changed = true;

    // nightdan keyin ham win bo'lishi mumkin — shu kamchilikni yopamiz
    const win = game.checkWin(s2);
    if (win.ended) {
      s2.status = "ended";
      s2.phaseEndsAt = null;

      const reveal = Object.values(s2.players)
        .map(p => `• ${p.name} — ${p.role.toUpperCase()}`)
        .join("\n");

      await tg.sendMessage(s2.chatId,
        `🏁 O‘yin tugadi! G‘olib: ${win.winner.toUpperCase()}\n\nRollar:\n${reveal}`
      );
      await cleanupEnded(s2);
      return { session: s2, changed };
    }

    await tg.sendMessage(s2.chatId,
      died ? `☀️ Tong otdi… ${died.name} o‘yindan chiqdi.` : `☀️ Tong otdi… Bugun hech kim o‘lmadi.`
    );
    return { session: s2, changed };
  }

  // DAY timeout => VOTE
  if (session.status === "day" && session.phaseEndsAt && now > session.phaseEndsAt) {
    game.startVoting(session);
    changed = true;
    await tg.sendMessage(session.chatId, "🗳️ Ovoz berish boshlandi (Mini App).");
    return { session, changed };
  }

  // VOTE timeout => resolve (action.js all-voted bo'lsa ham resolve qiladi, bu esa timeout fallback)
  if (session.status === "vote" && session.phaseEndsAt && now > session.phaseEndsAt) {
    const { session: s2, eliminated, win } = game.resolveVote(session);
    changed = true;

    if (eliminated) await tg.sendMessage(s2.chatId, `🗳️ Yakun: ${eliminated.name} o‘yindan chiqdi.`);
    else await tg.sendMessage(s2.chatId, `🗳️ Yakun: hech kim chiqmaydi.`);

    if (win.ended) {
      const reveal = Object.values(s2.players).map(p => `• ${p.name} — ${p.role.toUpperCase()}`).join("\n");
      await tg.sendMessage(s2.chatId, `🏁 O‘yin tugadi! G‘olib: ${win.winner.toUpperCase()}\n\nRollar:\n${reveal}`);
      await cleanupEnded(s2);
    }
    return { session: s2, changed };
  }

  return { session, changed };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false });

  const body = await readJson(req);
  const sid = body?.sid;
  const initData = body?.initData;

  // ✅ Auth soft-fail
  const auth = authOrSoftFail(initData, process.env.BOT_TOKEN);
  if (!auth.ok) {
    if (auth.soft) {
      // 200 qaytaramiz: Vercel log 401 bilan to'lib ketmaydi
      return sendJson(res, 200, { ok: false, reason: auth.reason });
    }
    return sendJson(res, 401, { ok: false, reason: auth.reason });
  }

  const v = auth.v;

  const session = sid ? await redis.get(`session:${sid}`) : null;
  if (!session) return sendJson(res, 404, { ok: false, reason: "no_session" });

  const userId = v.user?.id;
  if (!userId) return sendJson(res, 401, { ok: false, reason: "no_user" });

  // cron bo'lmasa ham phase o'tib ketmasin
  try {
    const adv = await maybeAdvance(session);
    if (adv.changed) await redis.set(`session:${sid}`, adv.session);
    // session pointer'ni yangilaymiz
    session.status = adv.session.status;
    session.joinEndsAt = adv.session.joinEndsAt;
    session.phaseEndsAt = adv.session.phaseEndsAt;
    session.round = adv.session.round;
    session.players = adv.session.players;
    session.night = adv.session.night;
    session.vote = adv.session.vote;
    session.chatId = adv.session.chatId;
    session.chatTitle = adv.session.chatTitle;
    session.sid = adv.session.sid;
  } catch (e) {
    // state endpoint yiqilib ketmasin
    console.error("maybeAdvance error:", e);
  }

  // membership check (best effort)
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