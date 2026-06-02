const FB_URL = process.env.FIREBASE_DB_URL || 'https://kostyuk-vk-bot-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';
import {  isAdminAuthorized  } from '../_lib/adminAuth';
import {  getTrustedTelegramUserId  } from '../_lib/tg';
import {  runSecretAutoCleanup  } from '../_lib/autoCleanup';
const ALLOW_VK_USERID_FALLBACK = String(process.env.ALLOW_VK_USERID_FALLBACK || '').trim().toLowerCase() === 'true';

async function fbGet(path) {
  try {
    const r = await fetch(`${FB_URL}/${path}.json${FIREBASE_SECRET}`);
    return await r.json();
  } catch {
    return null;
  }
}

import {  setCors  } from '../_lib/cors';

export default async (req, res) => {
  setCors(req, res, { methods: 'GET, OPTIONS' });
  await runSecretAutoCleanup().catch(() => {});

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const bookingId = String(req.query?.id || '').trim();
  if (!bookingId) return res.status(400).json({ error: 'Missing id' });
  if (!/^[A-Z0-9_-]{3,60}$/i.test(bookingId)) return res.status(400).json({ error: 'Invalid id format' });

  try {
    const booking = await fbGet(`ticket_bookings/${bookingId}`);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isAdmin = await isAdminAuthorized(req, {});
    if (!isAdmin) {
      const clientKey = String(req.query?.clientKey || '').trim();
      const hasClientKey = Boolean(
        booking.clientKey &&
        clientKey &&
        clientKey.length >= 10 &&
        clientKey === booking.clientKey
      );

      const trustedTgUserId = Number(getTrustedTelegramUserId(req.query?.tgInitData) || 0);
      const hasTgAccess = Boolean(
        trustedTgUserId > 0 &&
        booking.tgUserId &&
        Number(booking.tgUserId) === trustedTgUserId
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

      if (!hasClientKey && !hasTgAccess && !hasVkAccess) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const safeBooking = {
      name: booking.name || '',
      seats: Array.isArray(booking.seats) ? booking.seats : [],
      total: Number(booking.total || 0),
      discountedTotal: Number(booking.discountedTotal || booking.total || 0),
      status: booking.status || '',
      createdAt: booking.createdAt || null,
      confirmedAt: booking.confirmedAt || null,
      promoCode: booking.promoCode || null,
      paidAt: booking.paidAt || null,
      cancelReason: booking.cancelReason || '',
      refundReason: booking.refundReason || '',
      refundRequestedAt: booking.refundRequestedAt || null,
      ticketLinkVersion: Number(booking.ticketLinkVersion || 1),
      reviewed: Boolean(booking.reviewed)
    };

    return res.status(200).json({ ok: true, bookingId, booking: safeBooking });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
