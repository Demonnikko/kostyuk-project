// Приводит введённый промокод к каноническому виду, в котором он хранится
// в базе: транслит кириллицы -> латиница, верхний регистр, только A-Z0-9.
// Тот же алгоритм, что в админке при создании кода (adSuggestCode), поэтому
// пользователь может ввести «АФИША», «афиша», «Afisha» — найдётся AFISHA.
const PROMO_TRANSLIT = {
  а:'A',б:'B',в:'V',г:'G',д:'D',е:'E',ё:'E',ж:'ZH',з:'Z',и:'I',й:'Y',к:'K',
  л:'L',м:'M',н:'N',о:'O',п:'P',р:'R',с:'S',т:'T',у:'U',ф:'F',х:'H',ц:'C',
  ч:'CH',ш:'SH',щ:'SH',ъ:'',ы:'Y',ь:'',э:'E',ю:'U',я:'YA',
};

export function normalizePromoCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  let out = '';
  for (const ch of raw) {
    out += (PROMO_TRANSLIT[ch] !== undefined ? PROMO_TRANSLIT[ch] : ch);
  }
  return out.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizePromoSeatKeys(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  return [...new Set(items.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
}

export function checkPromoSeatRules(promo, seats) {
  const selected = normalizePromoSeatKeys((seats || []).map((seat) => seat?.key));
  const allowed = normalizePromoSeatKeys(promo?.allowedSeatKeys);
  const excluded = normalizePromoSeatKeys(promo?.excludedSeatKeys);

  if (!allowed.length && !excluded.length) return { ok: true };
  if (!selected.length) return { ok: false, reason: 'seat_selection_required' };
  if (selected.some((key) => excluded.includes(key))) return { ok: false, reason: 'seat_excluded' };
  if (allowed.length && selected.some((key) => !allowed.includes(key))) {
    return { ok: false, reason: 'seat_not_allowed' };
  }
  return { ok: true };
}

export function promoSeatsFromQuery(value) {
  return normalizePromoSeatKeys(value).map((key) => ({ key }));
}
