// Read-only data layer for the three author shows.
//
// БЕЛЫЕ СПИСКИ: под белыми списками домен kostyukproject.ru недоступен, поэтому
// схему зала (layout) и конфиг (цены/дата) грузим из СТАТИЧНЫХ файлов бандла
// (data/*.json на vk-apps.ru — белый список пускает). Они выгружены с боевого
// сервера — тот же источник, что рисует сайт. Живую занятость мест (кто занял)
// пытаемся получить с сервера best-effort: если запрос не дошёл (белые списки),
// показываем места свободными — реальная занятость проверится на сервере при
// оформлении брони (через api.vk.ru). Так схема зала видна ВСЕГДА, а не ошибка.

// Грузит статичный JSON из бандла (относительно index.html). Never throws.
async function loadLocalJson(path, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(path, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Ключи локальных файлов, выгруженных с боевого сервера.
const LOCAL_DATA = Object.freeze({
  secret:  { layout: './data/layout-secret.json',  config: './data/config-secret.json' },
  huligan: { layout: './data/layout-huligan.json', config: './data/config-huligan.json' },
  matvey:  { layout: './data/layout-matvey.json',  config: './data/config-matvey.json' },
});

export const SHOW_ENDPOINTS = Object.freeze({
  secret: {
    config: '/api/seats?type=config&show=secret',
    seats: '/api/seats?show=secret',
  },
  huligan: {
    config: '/api/seats?type=config&section=huligan',
    seats: '/api/seats?show=huligan',
  },
  matvey: {
    config: '/api/matvey-seats?type=config',
    seats: '/api/matvey-seats',
  },
});

// Normalizes the seats map { key: { status } } into a lookup the UI can use
// without re-deriving occupancy. Unknown/absent status means the seat is free.
export function normalizeSeats(rawSeats) {
  const out = {};
  if (!rawSeats || typeof rawSeats !== 'object') return out;
  for (const [key, value] of Object.entries(rawSeats)) {
    const status = String(value?.status || '').toLowerCase();
    out[key] = {
      key,
      status: status || 'available',
      taken: status === 'taken' || status === 'reserved',
    };
  }
  return out;
}

// Pulls the show's human-facing schedule/venue out of whatever config shape the
// endpoint returned. secret config is the ticket_config object; huligan config
// wraps it under huliganShow; matvey config shape is read as-is.
export function extractShowConfig(showId, rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return { raw: rawConfig || null, show: null, prices: null };
  if (showId === 'huligan') {
    return { raw: rawConfig, show: rawConfig.huliganShow || null, prices: rawConfig.prices || null };
  }
  // secret: ticket_config with a nested `show`; matvey: config with a `show`.
  return { raw: rawConfig, show: rawConfig.show || null, prices: rawConfig.prices || null };
}

// Loads read-only state for one show using the injected API client.
// Returns { ok, showId, config, seats, error }. Never throws.
export async function loadShowData(showId, client) {
  const endpoints = SHOW_ENDPOINTS[showId];
  if (!endpoints) {
    return { ok: false, showId, config: null, seats: {}, error: { code: 'unknown_show' } };
  }
  // Конфиг (цены/дата/площадка) — из статичного файла бандла (белые списки).
  const local = LOCAL_DATA[showId];
  const rawConfig = local ? await loadLocalJson(local.config) : null;
  // Занятость — best-effort с сервера.
  let seats = {};
  try {
    const rawSeats = await client.getJson(endpoints.seats);
    seats = normalizeSeats(rawSeats);
  } catch {
    seats = {};
  }
  return {
    ok: true,
    showId,
    config: extractShowConfig(showId, rawConfig),
    seats,
    error: null,
  };
}

// Builds a seat catalog for the picker: the hall layout from DB (single source,
// exported from the site) with live occupancy overlaid from the seats endpoint.
// Returns { ok, showId, viewBox, zones, seats:[{...layout, taken}], error }.
export async function loadHallForBooking(showId, client) {
  const endpoints = SHOW_ENDPOINTS[showId];
  const local = LOCAL_DATA[showId];
  if (!endpoints || !local) {
    return { ok: false, showId, error: { code: 'unknown_show' } };
  }
  // Схема зала — из статичного файла бандла (работает под белыми списками).
  const layoutFile = await loadLocalJson(local.layout);
  const layout = layoutFile && layoutFile.layout;
  if (!layout || !Array.isArray(layout.seats)) {
    return { ok: false, showId, error: { code: 'layout_missing' } };
  }
  // Занятость — best-effort с сервера. Под белыми списками запрос не дойдёт —
  // тогда все места считаем свободными (реальная проверка при оформлении брони).
  let occupancy = {};
  try {
    const rawSeats = await client.getJson(endpoints.seats);
    occupancy = normalizeSeats(rawSeats);
  } catch {
    occupancy = {};
  }
  const seats = layout.seats.map((s) => ({
    ...s,
    taken: Boolean(occupancy[s.key] && occupancy[s.key].taken),
  }));
  return { ok: true, showId, viewBox: layout.viewBox, zones: layout.zones || {}, seats, error: null };
}
