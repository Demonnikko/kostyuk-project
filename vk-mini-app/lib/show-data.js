// Read-only data layer for the three author shows.
// Reads REAL data from the existing production endpoints — no invented schemas,
// no second source of truth. Each show maps to its current contracts:
//   secret  : GET /api/seats?type=config&show=secret , GET /api/seats?show=secret
//   huligan : GET /api/seats?type=config&section=huligan , GET /api/seats?show=huligan
//   matvey  : GET /api/matvey-seats?type=config , GET /api/matvey-seats
// Occupancy statuses come straight from the server ('taken' / 'reserved' / 'available').

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
  try {
    const [rawConfig, rawSeats] = await Promise.all([
      client.getJson(endpoints.config),
      client.getJson(endpoints.seats),
    ]);
    return {
      ok: true,
      showId,
      config: extractShowConfig(showId, rawConfig),
      seats: normalizeSeats(rawSeats),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      showId,
      config: null,
      seats: {},
      error: { code: error?.code || 'request_failed', status: error?.status || 0, message: error?.message || 'Не удалось загрузить данные шоу' },
    };
  }
}

// Builds a seat catalog for the picker: the hall layout from DB (single source,
// exported from the site) with live occupancy overlaid from the seats endpoint.
// Returns { ok, showId, viewBox, zones, seats:[{...layout, taken}], error }.
export async function loadHallForBooking(showId, client) {
  const endpoints = SHOW_ENDPOINTS[showId];
  if (!endpoints) {
    return { ok: false, showId, error: { code: 'unknown_show' } };
  }
  try {
    const [layoutResp, rawSeats] = await Promise.all([
      client.getJson(`?action=layout&show=${encodeURIComponent(showId)}`),
      client.getJson(endpoints.seats),
    ]);
    const layout = layoutResp && layoutResp.layout;
    if (!layout || !Array.isArray(layout.seats)) {
      return { ok: false, showId, error: { code: 'layout_missing' } };
    }
    const occupancy = normalizeSeats(rawSeats);
    const seats = layout.seats.map((s) => ({
      ...s,
      taken: Boolean(occupancy[s.key] && occupancy[s.key].taken),
    }));
    return { ok: true, showId, viewBox: layout.viewBox, zones: layout.zones || {}, seats, error: null };
  } catch (error) {
    return {
      ok: false,
      showId,
      error: { code: error?.code || 'request_failed', status: error?.status || 0, message: error?.message || 'Не удалось загрузить схему зала' },
    };
  }
}
