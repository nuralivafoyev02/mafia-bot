const BOT_TOKEN = process.env.BOT_TOKEN;

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram API error: ${j.description}`);
  return j.result;
}

module.exports = {
  tg,
  sendMessage: (chat_id, text, extra) => tg("sendMessage", { chat_id, text, ...extra }),
  editMessageText: (chat_id, message_id, text, extra) => tg("editMessageText", { chat_id, message_id, text, ...extra }),
  answerCallbackQuery: (callback_query_id, text) => tg("answerCallbackQuery", { callback_query_id, text }),
  getChatMember: (chat_id, user_id) => tg("getChatMember", { chat_id, user_id })
};