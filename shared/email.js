/**
 * Отправка писем через Resend REST API (без SDK — прямой fetch).
 * Бесплатный тариф Resend: 3000 писем/мес, 100/день — с запасом хватает
 * на билеты одного шоу. Пока не подтверждён свой домен, письма уходят
 * с адреса onboarding@resend.dev (тестовый адрес самого Resend).
 */
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM = String(process.env.RESEND_FROM || 'Kostyuk Project <onboarding@resend.dev>').trim();

function isEmailConfigured() {
  return Boolean(RESEND_API_KEY);
}

/**
 * Отправляет письмо. attachments — необязательный массив
 * { filename, content: Buffer|base64string }. Возвращает { ok, error? } —
 * никогда не бросает исключение.
 */
async function sendEmail({ to, subject, html, attachments }) {
  if (!isEmailConfigured()) return { ok: false, error: 'RESEND_API_KEY not configured' };
  if (!to) return { ok: false, error: 'Missing recipient' };

  const payload = { from: RESEND_FROM, to: [String(to)], subject: String(subject || ''), html: String(html || '') };
  if (Array.isArray(attachments) && attachments.length) {
    payload.attachments = attachments.map(a => ({
      filename: String(a.filename || 'attachment'),
      content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : String(a.content || '')
    }));
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildTicketEmailHtml({ name, showLabel, dateLabel, seatsLabel, ticketUrl }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background:#0a0a0c; color:#f5f0e5; padding: 32px; border-radius: 18px;">
      <h1 style="color:#f0d98b; font-size:22px; margin-bottom:4px;">Ваш билет готов</h1>
      <p style="color:#aaa69d; margin-top:0;">${name ? `${name}, спасибо` : 'Спасибо'} за покупку!</p>
      <div style="background:#111114; border:1px solid rgba(214,172,69,.22); border-radius:14px; padding:16px; margin:20px 0;">
        <p style="margin:4px 0;"><b>Шоу:</b> ${showLabel}</p>
        <p style="margin:4px 0;"><b>Дата:</b> ${dateLabel}</p>
        <p style="margin:4px 0;"><b>Места:</b> ${seatsLabel}</p>
      </div>
      <a href="${ticketUrl}" style="display:inline-block; background:linear-gradient(135deg,#f0d98b,#d6ac45); color:#1a1500; font-weight:700; text-decoration:none; padding:14px 28px; border-radius:14px;">Открыть билет</a>
      <p style="color:#aaa69d; font-size:12px; margin-top:24px;">Если кнопка не открывается, скопируйте ссылку: ${ticketUrl}</p>
    </div>
  `;
}

export { sendEmail, buildTicketEmailHtml, isEmailConfigured };
