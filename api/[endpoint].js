import adminChats from './_endpoints/admin-chats.js';
import adminProxy from './_endpoints/admin-proxy.js';
import book from './_endpoints/book.js';
import broadcast from './_endpoints/broadcast.js';
import chat from './_endpoints/chat.js';
import checkin from './_endpoints/checkin.js';
import huligan from './_endpoints/huligan.js';
import leadConcert from './_endpoints/lead-concert.js';
import matveySeats from './_endpoints/matvey-seats.js';
import leadSchool from './_endpoints/lead-school.js';
import leadShow from './_endpoints/lead-show.js';
import notify from './_endpoints/notify.js';
import remind from './_endpoints/remind.js';
import seats from './_endpoints/seats.js';
import ticketBooking from './_endpoints/ticket-booking.js';
import ticketData from './_endpoints/ticket-data.js';
import ticketLink from './_endpoints/ticket-link.js';
import widgetImage from './_endpoints/widget-image.js';

const routes = {
  'admin-chats': adminChats,
  'admin-proxy': adminProxy,
  'book': book,
  'broadcast': broadcast,
  'chat': chat,
  'checkin': checkin,
  'huligan': huligan,
  'lead-concert': leadConcert,
  'matvey-seats': matveySeats,
  'lead-school': leadSchool,
  'lead-show': leadShow,
  'notify': notify,
  'remind': remind,
  'seats': seats,
  'ticket-booking': ticketBooking,
  'ticket-data': ticketData,
  'ticket-link': ticketLink,
  'widget-image': widgetImage
};

export default async function handler(req, res) {
  const { endpoint } = req.query;
  
  if (!endpoint || !routes[endpoint]) {
    return res.status(404).json({ ok: false, error: 'Endpoint not found' });
  }

  try {
    return await routes[endpoint](req, res);
  } catch (err) {
    console.error(`Error in endpoint ${endpoint}:`, err);
    return res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
}
