/**
 * Общие функции для работы с VK API.
 * Используется notify.js, huligan.js, broadcast.js, remind.js.
 */
const crypto = require('crypto');
const VK_TOKEN = process.env.VK_TOKEN || '';
const ADMIN_ID = parseInt(process.env.ADMIN_VK_ID) || 196783025;

async function vkSend(userId, text, keyboard) {
  if (!VK_TOKEN) return { ok: false, vkError: { error_msg: 'VK_TOKEN is not configured' } };
  const params = new URLSearchParams({
    peer_id: userId,
    message: text,
    random_id: crypto.randomInt(1, 2_000_000_000),
    access_token: VK_TOKEN,
    v: '5.199'
  });
  if (keyboard) params.set('keyboard', JSON.stringify(keyboard));
  try {
    const r = await fetch('https://api.vk.com/method/messages.send', {
      method: 'POST',
      body: params
    });
    const data = await r.json();
    if (data.error) {
      console.error('[vk] send error:', JSON.stringify(data.error));
      return { ok: false, vkError: data.error };
    }
    return { ok: true };
  } catch (e) {
    console.error('[vk] send exception:', e.message);
    return { ok: false, vkError: { error_msg: e.message } };
  }
}

module.exports = { vkSend, VK_TOKEN, ADMIN_ID };
