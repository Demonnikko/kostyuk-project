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
