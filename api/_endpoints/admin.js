import { fbGet } from '../../shared/firebase.js';
import { setCors } from '../../shared/cors.js';
import { isAdminAuthorized } from '../../shared/adminAuth.js';

export default async (req, res) => {
  setCors(req, res, { publicRead: false, methods: 'POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { }
  }

  const isAuth = await isAdminAuthorized(req, body);
  if (!isAuth) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { action, metrikaQuery } = body || {};

  if (action === 'metrika_proxy') {
    const token = await fbGet('bot_private_config/yandex_metrika_token');
    if (!token) return res.status(400).json({ error: 'Metrika token not configured' });

    if (!metrikaQuery) return res.status(400).json({ error: 'Missing metrikaQuery string' });

    // Build target URL
    const baseUrl = 'https://api-metrika.yandex.net/stat/v1/data';
    const targetUrl = `${baseUrl}?${metrikaQuery}`;

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'Authorization': `OAuth ${token}`,
          'Content-Type': 'application/x-yametrika+json'
        }
      });
      
      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json({ error: `Yandex API Error`, details: data });
      }
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
};
