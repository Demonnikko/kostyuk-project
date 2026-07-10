import {  buildTicketLink, fbGet  } from '../../shared/ticketAccess.js';
import {  isAdminAuthorized  } from '../../shared/adminAuth.js';
import {  setCors  } from '../../shared/cors.js';
import {  getTrustedTelegramUserId  } from '../../shared/tg.js';
import {  runSecretAutoCleanup  } from '../../shared/autoCleanup.js';
const ALLOW_VK_USERID_FALLBACK = String(process.env.ALLOW_VK_USERID_FALLBACK || '').trim().toLowerCase() === 'true';

const BLOCKED_STATUSES = new Set(['cancelled', 'refunded', 'returned', 'deleted']);

export default async (req, res) => {
  setCors(req, res, { methods: 'GET, OPTIONS' });
  await runSecretAutoCleanup().catch(() => {});

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const bookingId = (req.query?.id || '').trim();
  if (!bookingId) return res.status(400).json({ error: 'Missing id' });

  try {
    const isAdmin = await isAdminAuthorized(req, {});

    // Одно чтение из Firebase — используем и для авторизации, и для выдачи данных
    const booking = await fbGet(`ticket_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Ticket not found' });

    if (!isAdmin) {
      const clientKey = String(req.query?.clientKey || '').trim();
      const hasValidClientKey = Boolean(
        booking.clientKey &&
        clientKey &&
        clientKey.length >= 10 &&
        booking.clientKey === clientKey
      );

      const tgUserId = Number(getTrustedTelegramUserId(req.query?.tgInitData) || 0);
      const hasTgAccess = Boolean(
        tgUserId > 0 &&
        booking.tgUserId &&
        Number(booking.tgUserId) === tgUserId
      );

      let hasVkAccess = false;
      if (ALLOW_VK_USERID_FALLBACK) {
        const vkUserId = Number(req.query?.vkUserId || 0);
        hasVkAccess = Boolean(
          vkUserId > 0 &&
          booking.vkUserId &&
          Number(booking.vkUserId) === vkUserId
        );
      }

      if (!hasValidClientKey && !hasTgAccess && !hasVkAccess) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const st = String(booking.status || '').toLowerCase();
    if (BLOCKED_STATUSES.has(st)) return res.status(410).json({ error: 'Ticket revoked' });
    if (st !== 'confirmed') return res.status(409).json({ error: 'Ticket not confirmed yet' });

    const link = await buildTicketLink(bookingId, booking);

    // Если запрошены полные данные (?full=1) — отдаём бронь + конфиг в одном ответе
    const full = req.query?.full === '1';
    const resp = {
      ok: true,
      id: bookingId,
      url: link.url,
      expiresAt: link.expiresAt
    };

    if (full) {
      const cfg = await fbGet('ticket_config');
      resp.booking = {
        name: booking.name || '',
        seats: Array.isArray(booking.seats) ? booking.seats : [],
        total: Number(booking.total || 0),
        discountedTotal: Number(booking.discountedTotal || booking.total || 0),
        status: booking.status || '',
        createdAt: booking.createdAt || null,
        confirmedAt: booking.confirmedAt || null,
        promoCode: booking.promoCode || null
      };
      resp.config = cfg || {};
    }

    return res.status(200).json(resp);
  } catch (err) {
    console.error('[ticket-link] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
