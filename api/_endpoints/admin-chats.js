// /api/admin-chats — просмотр сохранённых диалогов с Екатериной
// Защищено паролем администратора (x-admin-pass-b64) или токеном ADMIN_TOKEN (x-admin-token / ?token=)

import {  kv  } from '@vercel/kv';
import {  isAdminAuthorized  } from '../_lib/adminAuth';

export default async function handler(req, res) {
  // CORS — только админ-домены
  const allowedOrigins = [
    'https://site76-kostyuk.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  const origin = req.headers.origin || '';
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, x-admin-pass, x-admin-pass-b64');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  // 1) Проверка авторизации двумя способами:
  // Способ А: Пароль администратора (через isAdminAuthorized)
  let authorized = false;
  try {
    authorized = await isAdminAuthorized(req, req.body);
  } catch (e) {
    authorized = false;
  }

  // Способ Б: ADMIN_TOKEN (обратная совместимость)
  if (!authorized) {
    const adminToken = process.env.ADMIN_TOKEN;
    const token =
      req.headers['x-admin-token'] ||
      (req.query && req.query.token) ||
      '';
    if (adminToken && token === adminToken) {
      authorized = true;
    }
  }

  if (!authorized) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  if (!process.env.KV_REST_API_URL) {
    return res.status(500).json({ ok: false, error: 'KV not configured' });
  }

  try {
    const action = (req.query && req.query.action) || 'list';

    // /api/admin-chats?action=list&limit=50 — список последних сессий
    if (action === 'list') {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      // Последние sid по убыванию времени
      const sids = await kv.zrange('chat:index', 0, limit - 1, { rev: true });
      const sessions = [];
      for (const sid of sids) {
        const s = await kv.get(`chat:${sid}`);
        if (!s) continue;
        sessions.push({
          sid: s.sid,
          startedAt: s.startedAt,
          lastAt: s.lastAt,
          messagesCount: s.messages?.length || 0,
          hasContact: !!s.bookingSent,
          contact: s.contact || null,
          firstUserMsg:
            s.messages?.find((m) => m.role === 'user')?.text?.slice(0, 200) || '',
          lastUserMsg:
            [...(s.messages || [])].reverse().find((m) => m.role === 'user')?.text?.slice(0, 200) || '',
          quizContext: s.quizContext || {},
        });
      }
      return res.status(200).json({ ok: true, sessions });
    }

    // /api/admin-chats?action=get&sid=... — полный диалог
    if (action === 'get') {
      const sid = req.query.sid;
      if (!sid) return res.status(400).json({ ok: false, error: 'sid required' });
      const session = await kv.get(`chat:${sid}`);
      if (!session) return res.status(404).json({ ok: false, error: 'Not found' });
      return res.status(200).json({ ok: true, session });
    }

    // /api/admin-chats?action=stats — простая статистика
    if (action === 'stats') {
      const total = await kv.zcard('chat:index');
      const recent = await kv.zrange('chat:index', 0, 999, { rev: true });
      let withContact = 0;
      let totalMessages = 0;
      for (const sid of recent) {
        const s = await kv.get(`chat:${sid}`);
        if (!s) continue;
        if (s.bookingSent) withContact++;
        totalMessages += s.messages?.length || 0;
      }
      return res.status(200).json({
        ok: true,
        stats: {
          totalSessions: total,
          recentChecked: recent.length,
          sessionsWithContact: withContact,
          totalMessages,
          conversionRate: recent.length
            ? Math.round((withContact / recent.length) * 100) + '%'
            : '0%',
        },
      });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    console.error('admin-chats error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
};
