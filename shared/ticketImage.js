/**
 * Рендер билета-картинки (PNG) для вложения в письмо. Три отдельных дизайна
 * под каждое шоу (не один шаблон в разных цветах — см. обсуждение с заказчиком):
 *   - secret: театральный корешок с медальоном-печатью и плавающими знаками вопроса
 *   - huligan: афиша-флаер с наклоном и лентой скотча
 *   - matvey: именной пропуск в квест на фоне звёздного неба
 *
 * Рендерится через headless Chromium (puppeteer-core + @sparticuz/chromium —
 * лёгкая сборка, вписывающаяся в лимит размера Vercel serverless функции).
 * QR встраивается как SVG, сгенерированный локально (без внешних сервисов —
 * рендер идёт в закрытом headless-браузере без сети).
 */
import QRCode from 'qrcode';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function qrSvg(data, colorDark) {
  return QRCode.toString(String(data), { type: 'svg', margin: 0, color: { dark: colorDark || '#000000', light: '#ffffff' } });
}

const FONTS_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@400;500;600;700;800&family=Caveat:wght@700&family=Nunito:wght@500;700;800&display=swap" rel="stylesheet">`;

function shellHtml({ width, background, style, body }) {
  // Ширина фиксирована, высота — по контенту (page.screenshot fullPage подгонит
  // картинку точно под реальную высоту билета, у каждого шоу она своя).
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${FONTS_LINK}<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: ${width}px; background: ${background}; }
    ${style}
  </style></head><body>${body}</body></html>`;
}

function scatterQMarks(count, seed) {
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  let out = '';
  for (let i = 0; i < count; i++) {
    const size = 14 + rand() * 30;
    const top = rand() * 100;
    const left = rand() * 100;
    const rot = -18 + rand() * 36;
    const op = 0.035 + rand() * 0.05;
    out += `<span class="qmark" style="font-size:${size.toFixed(1)}px; top:${top.toFixed(1)}%; left:${left.toFixed(1)}%; transform:rotate(${rot.toFixed(1)}deg); opacity:${op.toFixed(3)};">?</span>`;
  }
  return out;
}

async function renderSecretHtml(data) {
  const { name, dateLabel, timeLabel, venue, seatsLabel, bookingId, ticketUrl } = data;
  const qr = await qrSvg(ticketUrl || bookingId, '#0a0a0c');
  
  const style = `
    .ticket { width: 640px; background: #0a0a0c; color: #f5f0e5; font-family: 'Inter', sans-serif; position: relative; overflow: hidden; }
    .qmark { position: absolute; font-family: 'Cinzel', serif; font-weight: 700; color: #d6ac45; line-height: 1; }
    .frame { position: absolute; inset: 18px; border: 1px solid rgba(214,172,69,.32); pointer-events: none; }
    .corner { position: absolute; width: 26px; height: 26px; border-color: #d6ac45; }
    .corner.tl { top: 12px; left: 12px; border-top: 2px solid; border-left: 2px solid; }
    .corner.tr { top: 12px; right: 12px; border-top: 2px solid; border-right: 2px solid; }
    .corner.bl { bottom: 12px; left: 12px; border-bottom: 2px solid; border-left: 2px solid; }
    .corner.br { bottom: 12px; right: 12px; border-bottom: 2px solid; border-right: 2px solid; }
    .content { position: relative; z-index: 1; padding: 56px 50px 0; text-align: center; }
    .eyebrow { font-size: 12px; letter-spacing: .38em; text-transform: uppercase; color: rgba(214,172,69,.6); margin-bottom: 18px; }
    .show { font-family: 'Cinzel', serif; font-style: italic; font-weight: 600; font-size: 16px; letter-spacing: .04em; color: rgba(245,240,229,.45); margin-bottom: 10px; }
    .title { font-family: 'Cinzel', serif; font-weight: 700; font-size: 56px; letter-spacing: .03em; color: #f0d98b; line-height: 1; }
    .rule { width: 64px; height: 1px; background: rgba(214,172,69,.5); margin: 22px auto 0; }
    .details { margin: 34px 50px 0; padding-top: 28px; border-top: 1px solid rgba(214,172,69,.18); display: grid; grid-template-columns: 1fr 1fr; gap: 22px 28px; text-align: left; }
    .details .full { grid-column: 1 / -1; }
    .label { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: rgba(214,172,69,.5); margin-bottom: 6px; font-family: 'Cinzel', serif; font-weight: 600; }
    .value { font-size: 18px; font-weight: 500; letter-spacing: .01em; }
    .footer { position: relative; z-index: 1; margin: 30px 50px 0; padding: 24px 0 44px; display: flex; align-items: center; gap: 22px; border-top: 1px solid rgba(214,172,69,.18); }
    .medal { flex: 0 0 auto; width: 92px; height: 92px; border-radius: 10px; background: #fff; padding: 8px; box-shadow: 0 0 0 1px rgba(214,172,69,.5); }
    .medal svg { width: 100%; height: 100%; }
    .code { font-family: monospace; font-size: 16px; color: #d6ac45; letter-spacing: .05em; display: block; margin-bottom: 5px; }
    .hint { font-size: 13px; color: rgba(245,240,229,.4); font-style: italic; }
  `;
  const body = `<div class="ticket">
    ${scatterQMarks(22, 7)}
    <div class="frame"></div>
    <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
    <div class="content">
      <div class="eyebrow">Иллюзионный моноспектакль</div>
      <p class="show">Дмитрий Костюк представляет</p>
      <h1 class="title">СЕКРЕТ</h1>
      <div class="rule"></div>
      <div class="details">
        <div><div class="label">Дата</div><div class="value">${esc(dateLabel)}</div></div>
        <div><div class="label">Время</div><div class="value">${esc(timeLabel)}</div></div>
        <div class="full"><div class="label">Площадка</div><div class="value">${esc(venue)}</div></div>
        <div class="full"><div class="label">Места</div><div class="value">${esc(seatsLabel)}</div></div>
        <div class="full"><div class="label">Гость</div><div class="value">${esc(name)}</div></div>
      </div>
    </div>
    <div class="footer">
      <div class="medal">${qr}</div>
      <div>
        <span class="code">${esc(bookingId)}</span>
        <span class="hint">Покажите на входе</span>
      </div>
    </div>
  </div>`;
  return shellHtml({ width: 640, background: '#0a0a0c', style, body });
}

async function renderHuliganHtml(data) {
  const { name, dateLabel, timeLabel, venue, zoneLabel, amountLabel, bookingId, ticketUrl } = data;
  const qr = await qrSvg(ticketUrl || bookingId, '#111111');
  
  const style = `
    .stage { width: 640px; background: #f5f0e5; display: flex; align-items: center; justify-content: center; padding: 40px; }
    .ticket { width: 560px; background: #111; color: #f2f0ea; font-family: 'Inter', sans-serif; position: relative; transform: rotate(-1.4deg); padding: 40px 38px 36px;
      clip-path: polygon(0% 2%, 3% 0%, 97% 1%, 100% 3%, 99% 97%, 96% 100%, 2% 99%, 1% 96%); }
    .tape { position: absolute; top: -14px; left: 40px; width: 96px; height: 32px; background: rgba(255,214,60,.85); transform: rotate(-4deg); }
    .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
    .age { font-weight: 800; font-size: 18px; background: #ffd63c; color: #111; padding: 5px 12px; transform: rotate(2deg); }
    .time { font-size: 15px; color: rgba(242,240,234,.55); font-weight: 600; margin-top: 8px; }
    .title { font-weight: 800; font-style: italic; font-size: 72px; line-height: .86; text-transform: uppercase; margin: 10px 0 4px; color: #f2f0ea; text-shadow: 4px 4px 0 #e85348; }
    .venue { font-size: 16px; color: rgba(242,240,234,.6); margin-bottom: 24px; }
    .scrawl { font-family: 'Caveat', cursive; font-weight: 700; font-size: 32px; color: #ffd63c; transform: rotate(-2deg); display: inline-block; margin-bottom: 20px; }
    .row { display: flex; justify-content: space-between; font-size: 18px; padding: 11px 0; border-bottom: 1px solid rgba(255,255,255,.1); }
    .row:last-of-type { border-bottom: none; }
    .row span:first-child { color: rgba(242,240,234,.5); text-transform: uppercase; font-size: 13px; letter-spacing: .08em; }
    .row span:last-child { font-weight: 700; }
    .bottom { display: flex; align-items: flex-end; justify-content: space-between; margin-top: 26px; padding-top: 22px; border-top: 4px solid #e85348; }
    .qr { width: 118px; height: 118px; background: #fff; padding: 7px; transform: rotate(2deg); }
    .qr svg { width: 100%; height: 100%; }
    .code { font-family: monospace; font-size: 16px; color: #ffd63c; display: block; }
    .hint { font-size: 13px; color: rgba(242,240,234,.45); text-align: right; max-width: 190px; margin-top: 4px; }
  `;
  const body = `<div class="stage"><div class="ticket">
    <div class="tape"></div>
    <div class="top"><span class="age">16+</span><span class="time">${esc(dateLabel)} · ${esc(timeLabel)}</span></div>
    <h1 class="title">Хулиgan</h1>
    <div class="venue">${esc(venue)}</div>
    <span class="scrawl">теперь ты тоже хулиgan</span>
    <div class="row"><span>Гость</span><span>${esc(name)}</span></div>
    <div class="row"><span>Место</span><span>${esc(zoneLabel)}</span></div>
    <div class="row"><span>Сумма</span><span>${esc(amountLabel)}</span></div>
    <div class="bottom">
      <div class="qr">${qr}</div>
      <div>
        <span class="code">${esc(bookingId)}</span>
        <div class="hint">QR на входе — без него не пустят</div>
      </div>
    </div>
  </div></div>`;
  return shellHtml({ width: 640, background: '#f5f0e5', style, body });
}

async function renderMatveyHtml(data) {
  const { name, seatsLabel, dateLabel, timeLabel, venue, ticketsCount, amountLabel, bookingId, ticketUrl } = data;
  const qr = await qrSvg(ticketUrl || bookingId, '#1a0d47');
  
  const style = `
    .stage { width: 640px; background: #0a0420; display: flex; align-items: center; justify-content: center; padding: 30px; }
    .ticket { width: 580px; background: radial-gradient(140% 100% at 30% 0%, #4a2a8f 0%, #2d1466 45%, #1a0d47 100%); border-radius: 30px; position: relative; overflow: hidden; font-family: 'Nunito', sans-serif; color: #fff; }
    .stars { position: absolute; inset: 0;
      background-image:
        radial-gradient(2px 2px at 12% 8%, #fff, transparent), radial-gradient(1.6px 1.6px at 82% 6%, #fff, transparent),
        radial-gradient(1.4px 1.4px at 60% 4%, rgba(255,255,255,.85), transparent), radial-gradient(1.8px 1.8px at 30% 14%, #fff, transparent),
        radial-gradient(2px 2px at 92% 18%, #fff, transparent), radial-gradient(1.4px 1.4px at 6% 24%, rgba(255,255,255,.7), transparent),
        radial-gradient(1.8px 1.8px at 46% 10%, rgba(255,255,255,.85), transparent), radial-gradient(1.6px 1.6px at 70% 28%, rgba(255,255,255,.6), transparent),
        radial-gradient(2px 2px at 18% 40%, #fff, transparent), radial-gradient(1.4px 1.4px at 88% 42%, rgba(255,255,255,.7), transparent),
        radial-gradient(1.8px 1.8px at 55% 50%, rgba(255,255,255,.55), transparent), radial-gradient(1.6px 1.6px at 8% 56%, rgba(255,255,255,.65), transparent),
        radial-gradient(2px 2px at 95% 64%, #fff, transparent), radial-gradient(1.4px 1.4px at 35% 66%, rgba(255,255,255,.5), transparent),
        radial-gradient(1.8px 1.8px at 75% 78%, rgba(255,255,255,.6), transparent), radial-gradient(1.6px 1.6px at 15% 82%, rgba(255,255,255,.5), transparent),
        radial-gradient(2px 2px at 60% 88%, #fff, transparent); }
    .ribbon { position: relative; text-align: center; padding: 26px 24px 0; }
    .ribbon span { font-weight: 800; font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: #0a0420; background: #ffd166; padding: 9px 22px; border-radius: 999px; }
    .hero { position: relative; text-align: center; padding: 26px 30px 8px; }
    .star-icon { font-size: 56px; line-height: 1; margin-bottom: 8px; }
    .title { font-weight: 800; font-size: 36px; margin: 0; }
    .title em { font-style: normal; color: #ffd166; }
    .hero-sub { font-size: 16px; color: rgba(245,237,255,.65); margin-top: 8px; }
    .details { position: relative; margin: 24px 28px 0; background: rgba(255,255,255,.06); border: 1.5px solid rgba(212,181,255,.3); border-radius: 20px; padding: 18px 24px; }
    .det-row { display: flex; justify-content: space-between; align-items: baseline; padding: 8px 0; border-bottom: 1px solid rgba(212,181,255,.14); }
    .det-row:last-child { border-bottom: none; }
    .det-label { font-size: 14px; color: rgba(245,237,255,.55); }
    .det-value { font-weight: 700; font-size: 17px; text-align: right; }
    .facts { position: relative; display: flex; justify-content: space-around; margin: 22px 28px 0; text-align: center; }
    .fact-label { font-size: 13px; color: rgba(245,237,255,.5); margin-bottom: 4px; }
    .fact-value { font-weight: 700; font-size: 18px; }
    .qr-wrap { position: relative; margin: 28px 28px 30px; background: rgba(255,255,255,.06); border: 1.5px solid rgba(212,181,255,.35); border-radius: 22px; padding: 22px; display: flex; align-items: center; gap: 20px; }
    .qr { width: 100px; height: 100px; background: #fff; border-radius: 14px; padding: 8px; box-shadow: 0 0 0 1px rgba(212,181,255,.6); flex: none; }
    .qr svg { width: 100%; height: 100%; }
    .qr-code { font-family: monospace; font-size: 16px; color: #d4b5ff; display: block; margin-bottom: 4px; }
    .qr-hint { font-size: 15px; color: rgba(245,237,255,.5); }
  `;
  const body = `<div class="stage"><div class="ticket">
    <div class="stars"></div>
    <div class="ribbon"><span>Пропуск в квест</span></div>
    <div class="hero">
      <div class="star-icon">&#10022;</div>
      <h1 class="title">Спасти <em>Матвея</em></h1>
      <div class="hero-sub">${esc(dateLabel)} · ${esc(timeLabel)} · ${esc(venue)}</div>
    </div>
    <div class="details">
      <div class="det-row"><span class="det-label">Гость</span><span class="det-value">${esc(name)}</span></div>
      <div class="det-row"><span class="det-label">Места</span><span class="det-value">${esc(seatsLabel)}</span></div>
    </div>
    <div class="facts">
      <div><div class="fact-label">Билетов</div><div class="fact-value">${esc(ticketsCount)}</div></div>
      <div><div class="fact-label">Сумма</div><div class="fact-value">${esc(amountLabel)}</div></div>
    </div>
    <div class="qr-wrap">
      <div class="qr">${qr}</div>
      <div>
        <span class="qr-code">${esc(bookingId)}</span>
        <span class="qr-hint">Покажите на входе в квест</span>
      </div>
    </div>
  </div></div>`;
  return shellHtml({ width: 640, background: '#0a0420', style, body });
}

async function launchBrowser() {
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = await import('puppeteer-core');
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
    defaultViewport: chromium.defaultViewport
  });
}

/**
 * Рендерит HTML билета в PNG-буфер. show ∈ 'secret' | 'huligan' | 'matvey'.
 * Никогда не бросает — на любой сбой возвращает null, чтобы письмо ушло без
 * картинки, а не провалилось целиком.
 */
async function renderTicketImage(show, data) {
  let browser;
  try {
    const html = show === 'huligan' ? await renderHuliganHtml(data)
      : show === 'matvey' ? await renderMatveyHtml(data)
      : await renderSecretHtml(data);

    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 800, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // fullPage: картинка подгоняется точно под высоту контента (у каждого шоу своя).
    const buffer = await page.screenshot({ type: 'png', fullPage: true });
    return buffer;
  } catch (err) {
    console.error('[ticketImage] render failed:', err.message);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export { renderTicketImage };
