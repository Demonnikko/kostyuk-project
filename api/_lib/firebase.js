/**
 * Общие функции для работы с Firebase Realtime Database.
 * Используется всеми API-эндпоинтами vk-tickets.
 */
const FB_URL = process.env.FIREBASE_DB_URL || 'https://kostyuk-vk-bot-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';

async function fbGet(path) {
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fbPut(path, data) {
  const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Firebase PUT failed: ${r.status}`);
}

async function fbPatch(path, data) {
  await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

async function fbDelete(path) {
  await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`, { method: 'DELETE' });
}

module.exports = { fbGet, fbPut, fbPatch, fbDelete, FB_URL, FIREBASE_SECRET };
