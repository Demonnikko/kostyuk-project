const { fbGet, buildTicketLink, validateTicketAccess } = require('./_ticketAccess');
const { runSecretAutoCleanup } = require('./_autoCleanup');

const { setCors } = require('./_cors');

module.exports = async (req, res) => {
  setCors(req, res, { publicRead: true, methods: 'GET, OPTIONS' });
  await runSecretAutoCleanup().catch(() => {});

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const bookingId = (req.query?.id || '').trim();
  const token = (req.query?.tk || '').trim();
  if (!bookingId) return res.status(400).json({ error: 'Missing id' });

  try {
    const booking = await fbGet(`ticket_bookings/${bookingId}`);
    const check = validateTicketAccess(bookingId, token, booking);
    if (!check.ok) {
      if (check.status === 404) return res.status(404).json({ error: 'Ticket not found' });
      if (check.status === 410) return res.status(410).json({ error: 'Ticket revoked' });
      if (check.status === 409) return res.status(409).json({ error: 'Ticket not confirmed yet' });
      return res.status(403).json({ error: 'Invalid or expired ticket link' });
    }

    const cfg = await fbGet('ticket_config');
    const canonical = await buildTicketLink(bookingId, booking);

    const safeBooking = {
      name: booking.name || '',
      seats: Array.isArray(booking.seats) ? booking.seats : [],
      total: Number(booking.total || 0),
      discountedTotal: Number(booking.discountedTotal || booking.total || 0),
      status: booking.status || '',
      createdAt: booking.createdAt || null,
      confirmedAt: booking.confirmedAt || null,
      promoCode: booking.promoCode || null
    };

    return res.status(200).json({
      ok: true,
      bookingId,
      ticketUrl: canonical.url,
      booking: safeBooking,
      config: cfg || {}
    });
  } catch (err) {
    console.error('[ticket-data] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
