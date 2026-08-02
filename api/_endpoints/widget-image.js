const FB_URL = process.env.FIREBASE_DB_URL || '';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET ? `?auth=${process.env.FIREBASE_SECRET}` : '';

import {  setCors  } from '../../shared/cors.js';

export default async (req, res) => {
  setCors(req, res, { publicRead: true, methods: 'GET, OPTIONS' });

  const { id } = req.query;
  if (!id) return res.status(400).end('Missing id');

  try {
    const r = await fetch(`${FB_URL}/widget_images/${id}.json${FIREBASE_SECRET}`);
    const data = await r.json();

    if (!data || !data.base64) return res.status(404).end('Not found');

    const base64 = data.base64;
    // Strip data URL prefix if present
    const comma = base64.indexOf(',');
    const b64str = comma !== -1 ? base64.slice(comma + 1) : base64;
    const buf = Buffer.from(b64str, 'base64');

    // Detect content type from data URL prefix
    let contentType = 'image/jpeg';
    if (base64.startsWith('data:image/png')) contentType = 'image/png';
    else if (base64.startsWith('data:image/webp')) contentType = 'image/webp';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).end(buf);
  } catch (e) {
    console.error('[widget-image] error:', e.message);
    res.status(500).end('Error');
  }
};
