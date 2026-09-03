const routes = {
  'admin-chats': () => import('./_endpoints/admin-chats.js'),
  'admin-proxy': () => import('./_endpoints/admin-proxy.js'),
  'book': () => import('./_endpoints/book.js'),
  'broadcast': () => import('./_endpoints/broadcast.js'),
  'chat': () => import('./_endpoints/chat.js'),
  'checkin': () => import('./_endpoints/checkin.js'),
  'huligan': () => import('./_endpoints/huligan.js'),
  'lead-concert': () => import('./_endpoints/lead-concert.js'),
  'matvey': () => import('./_endpoints/matvey.js'),
  'matvey-seats': () => import('./_endpoints/matvey-seats.js'),
  'lead-school': () => import('./_endpoints/lead-school.js'),
  'lead-show': () => import('./_endpoints/lead-show.js'),
  'notify': () => import('./_endpoints/notify.js'),
  'remind': () => import('./_endpoints/remind.js'),
  'seats': () => import('./_endpoints/seats.js'),
  'ticket-booking': () => import('./_endpoints/ticket-booking.js'),
  'ticket-data': () => import('./_endpoints/ticket-data.js'),
  'ticket-link': () => import('./_endpoints/ticket-link.js'),
  'track': () => import('./_endpoints/track.js'),
  'vk-mini-app': () => import('./_endpoints/vk-mini-app.js'),
  'widget-image': () => import('./_endpoints/widget-image.js')
};

export default async function handler(req, res) {
  const { endpoint } = req.query;
  
  if (!endpoint || !routes[endpoint]) {
    return res.status(404).json({ ok: false, error: 'Endpoint not found' });
  }

  try {
    const mod = await routes[endpoint]();
    return await mod.default(req, res);
  } catch (err) {
    console.error(`Error in endpoint ${endpoint}:`, err);
    return res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
