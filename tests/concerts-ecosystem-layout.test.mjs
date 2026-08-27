import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const resolved = path.resolve(PROJECT_ROOT, `.${pathname}`);
      if (!resolved.startsWith(`${PROJECT_ROOT}${path.sep}`)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const filePath = existsSync(resolved) ? resolved : path.join(resolved, 'index.html');
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error('Not a file');

      res.writeHead(200, { 'content-type': contentType(filePath) });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome may need a moment to expose the debugging endpoint.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startChrome() {
  const profile = await mkdtemp(path.join(tmpdir(), 'kostyuk-layout-chrome-'));
  const debugPort = 9222 + Math.floor(Math.random() * 1000);
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--no-sandbox',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const pages = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
    const page = pages.find((item) => item.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error(`No page target. Chrome stderr:\n${stderr}`);
    return {
      pageWebSocketUrl: page.webSocketDebuggerUrl,
      async close() {
        chrome.kill('SIGTERM');
        await new Promise((resolve) => chrome.once('exit', resolve));
        await rm(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    chrome.kill('SIGTERM');
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }

    const callbacks = listeners.get(message.method);
    if (callbacks) callbacks.forEach((callback) => callback(message.params));
  });

  function send(method, params = {}) {
    id += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  function waitForEvent(method, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.get(method)?.delete(onEvent);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const onEvent = (params) => {
        clearTimeout(timer);
        listeners.get(method)?.delete(onEvent);
        resolve(params);
      };
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(onEvent);
    });
  }

  return {
    send,
    waitForEvent,
    close() {
      socket.close();
    },
  };
}

async function collectConcertsMetrics(page, origin, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const loaded = page.waitForEvent('Page.loadEventFired');
  await page.send('Page.navigate', { url: `${origin}/concerts/` });
  await loaded;
  await delay(200);

  const result = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const logo = document.querySelector('.brand-bar__identity img');
      const shows = document.querySelector('.shows');
      const ecosystem = document.querySelector('.concerts-ecosystem');
      const title = document.querySelector('.concerts-ecosystem__title h2');
      const links = [...document.querySelectorAll('.concerts-ecosystem__link')];
      const logoRect = logo.getBoundingClientRect();
      const showRect = shows.getBoundingClientRect();
      const ecosystemRect = ecosystem.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const firstLinkRect = links[0].getBoundingClientRect();
      return {
        logoSrc: logo.getAttribute('src'),
        logoContent: getComputedStyle(logo).content,
        logoWidth: Math.round(logoRect.width),
        logoHeight: Math.round(logoRect.height),
        afterShowsGap: Math.round(ecosystemRect.top - showRect.bottom),
        titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
        titleToLinksGap: Math.round(firstLinkRect.left - titleRect.right),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`,
  });

  return result.result.value;
}


async function collectHubBrandMetrics(page, origin, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const loaded = page.waitForEvent('Page.loadEventFired');
  await page.send('Page.navigate', { url: `${origin}/` });
  await loaded;
  await delay(250);

  const result = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const header = document.querySelector('.brand-bar--hub');
      const headerLogo = document.querySelector('.brand-bar--hub .brand-bar__identity img');
      const footer = document.querySelector('.kp-footer--hub');
      const footerLogo = document.querySelector('.kp-footer--hub .kp-footer__brand img');
      if (!header || !headerLogo || !footer || !footerLogo) {
        return {
          hasHeader: !!header,
          hasFooter: !!footer,
          headerSrc: headerLogo ? headerLogo.getAttribute('src') : '',
          footerSrc: footerLogo ? footerLogo.getAttribute('src') : '',
          headerWidth: 0,
          headerHeight: 0,
          footerWidth: 0,
          footerHeight: 0,
          headerBackground: '',
          headerRadius: '',
          headerShadow: '',
          footerBackground: '',
          footerRadius: '',
          footerShadow: '',
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      }
      const headerLogoStyle = getComputedStyle(headerLogo);
      const footerLogoStyle = getComputedStyle(footerLogo);
      const headerRect = headerLogo.getBoundingClientRect();
      const footerRect = footerLogo.getBoundingClientRect();
      return {
        hasHeader: true,
        hasFooter: true,
        headerSrc: headerLogo.getAttribute('src'),
        footerSrc: footerLogo.getAttribute('src'),
        headerWidth: Math.round(headerRect.width),
        headerHeight: Math.round(headerRect.height),
        footerWidth: Math.round(footerRect.width),
        footerHeight: Math.round(footerRect.height),
        headerBackground: headerLogoStyle.backgroundColor,
        headerRadius: headerLogoStyle.borderRadius,
        headerShadow: headerLogoStyle.boxShadow,
        footerBackground: footerLogoStyle.backgroundColor,
        footerRadius: footerLogoStyle.borderRadius,
        footerShadow: footerLogoStyle.boxShadow,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`,
  });

  return result.result.value;
}


async function collectPrivateEventsBrandMetrics(page, origin, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const loaded = page.waitForEvent('Page.loadEventFired');
  await page.send('Page.navigate', { url: `${origin}/events/` });
  await loaded;
  await delay(250);
  await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `document.querySelector('.kp-footer')?.scrollIntoView({ block: 'center' })`,
  });
  await delay(150);

  const result = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const header = document.querySelector('.brand-bar--events');
      const headerLogo = document.querySelector('.brand-bar--events .brand-bar__identity img');
      const headerLabel = document.querySelector('.brand-bar--events .brand-bar__identity small');
      const footer = document.querySelector('.kp-footer--events');
      const footerLogo = document.querySelector('.kp-footer--events .kp-footer__brand img');
      const readLogo = (logo) => {
        if (!logo) return { src: '', width: 0, height: 0, background: '', radius: '', objectFit: '' };
        const style = getComputedStyle(logo);
        const rect = logo.getBoundingClientRect();
        return {
          src: logo.getAttribute('src'),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          background: style.backgroundColor,
          radius: style.borderRadius,
          objectFit: style.objectFit,
        };
      };
      const labelStyle = headerLabel ? getComputedStyle(headerLabel) : null;
      return {
        hasHeader: !!header,
        hasFooter: !!footer,
        headerLogo: readLogo(headerLogo),
        footerLogo: readLogo(footerLogo),
        labelText: headerLabel ? headerLabel.textContent.trim() : '',
        labelFontSize: labelStyle ? Number.parseFloat(labelStyle.fontSize) : 0,
        labelWeight: labelStyle ? Number.parseInt(labelStyle.fontWeight, 10) || 0 : 0,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`,
  });

  return result.result.value;
}

async function collectPrivateAssistantModalMetrics(page, origin, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const loaded = page.waitForEvent('Page.loadEventFired');
  await page.send('Page.navigate', { url: `${origin}/events/` });
  await loaded;
  await delay(300);

  const clicked = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.textContent.includes('Рассчитать'));
      if (!button) return false;
      button.click();
      return true;
    })()`,
  });
  await delay(250);

  const result = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const overlay = document.getElementById('assistantOverlay');
      const panel = document.getElementById('assistantPanel');
      const close = [...panel.querySelectorAll('button')]
        .find((item) => String(item.getAttribute('onclick')).includes('closeAssistant'));
      const avatar = panel.querySelector('img[alt="Екатерина"]');
      const header = document.querySelector('.brand-bar');
      const overlayStyle = getComputedStyle(overlay);
      const headerStyle = header ? getComputedStyle(header) : null;
      const panelRect = panel.getBoundingClientRect();
      const closeRect = close.getBoundingClientRect();
      const headerRect = header ? header.getBoundingClientRect() : { bottom: 0 };
      const hit = document.elementFromPoint(
        closeRect.left + closeRect.width / 2,
        closeRect.top + closeRect.height / 2,
      );
      const overlayZ = Number.parseInt(overlayStyle.zIndex, 10) || 0;
      const headerZ = headerStyle ? Number.parseInt(headerStyle.zIndex, 10) || 0 : 0;
      return {
        clicked: ${clicked.result.value ? 'true' : 'false'},
        isOpen: overlayStyle.display !== 'none',
        avatarSrc: avatar ? avatar.getAttribute('src') : '',
        avatarNaturalWidth: avatar ? avatar.naturalWidth : 0,
        avatarNaturalHeight: avatar ? avatar.naturalHeight : 0,
        overlayZ,
        headerZ,
        panelTop: Math.round(panelRect.top),
        panelBottom: Math.round(panelRect.bottom),
        closeTop: Math.round(closeRect.top),
        closeBottom: Math.round(closeRect.bottom),
        closeHitIsClose: close.contains(hit),
        panelClearsHeader: overlayZ > headerZ || panelRect.top >= headerRect.bottom + 8,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
      };
    })()`,
  });

  return result.result.value;
}


async function collectPrivateEventsAuthorShowsMetrics(page, origin, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const loaded = page.waitForEvent('Page.loadEventFired', 5000).catch(() => null);
  await page.send('Page.navigate', { url: `${origin}/events/#formats` });
  await loaded;
  await delay(300);
  await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `document.querySelector('#concerts')?.scrollIntoView({ block: 'center' })`,
  });
  await delay(700);

  const result = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const formatGrid = document.querySelector('.packGrid--formats');
      const formatCards = [...document.querySelectorAll('.packGrid--formats .pack')];
      const formatButtons = [...document.querySelectorAll('.packGrid--formats .btn')];
      const carousel = document.querySelector('.events-shows-carousel.swiper-concerts');
      const wrapper = carousel?.querySelector('.swiper-wrapper');
      const slides = [...document.querySelectorAll('.events-shows-carousel .swiper-slide')];
      const showImages = [...document.querySelectorAll('.events-shows-carousel .swiper-slide img')];
      const cta = document.querySelector('.events-shows-link__button');
      const promo = document.querySelector('.kp-ecosystem-promo--events');
      const promoTitle = promo?.querySelector('h2');
      const promoGrid = promo?.querySelector('.kp-ecosystem-promo__grid');
      const fits = (el) => el && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 2;
      const formatCardRects = formatCards.map((card) => card.getBoundingClientRect());
      const formatGridRect = formatGrid ? formatGrid.getBoundingClientRect() : { left: 0, width: 0 };
      const promoRect = promo ? promo.getBoundingClientRect() : { width: 0 };
      const promoTitleStyle = promoTitle ? getComputedStyle(promoTitle) : null;
      const slideRects = slides.map((slide) => slide.getBoundingClientRect());
      const carouselRect = carousel ? carousel.getBoundingClientRect() : { width: 0, height: 0 };
      const ctaRect = cta ? cta.getBoundingClientRect() : { width: 0, height: 0 };
      const slideTopSpread = slideRects.length
        ? Math.round(Math.max(...slideRects.map((rect) => rect.top)) - Math.min(...slideRects.map((rect) => rect.top)))
        : 0;
      return {
        formatCardCount: formatCards.length,
        formatGridColumns: formatGrid ? getComputedStyle(formatGrid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        formatGridCenterOffset: formatGrid ? Math.round((formatGridRect.left + formatGridRect.width / 2) - document.documentElement.clientWidth / 2) : 0,
        formatMinCardWidth: formatCardRects.length ? Math.round(Math.min(...formatCardRects.map((rect) => rect.width))) : 0,
        formatButtonsFit: formatButtons.every(fits),
        promoTitleFontSize: promoTitleStyle ? Number.parseFloat(promoTitleStyle.fontSize) : 0,
        promoTitleAlign: promoTitleStyle ? promoTitleStyle.textAlign : '',
        promoGridColumns: promoGrid ? getComputedStyle(promoGrid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        promoWidth: Math.round(promoRect.width),
        formatButtonMetrics: formatButtons.map((button) => ({
          text: button.textContent.trim(),
          clientWidth: button.clientWidth,
          scrollWidth: button.scrollWidth,
          clientHeight: button.clientHeight,
          scrollHeight: button.scrollHeight,
          whiteSpace: getComputedStyle(button).whiteSpace,
        })),
        usesCarousel: !!carousel,
        carouselInitialized: !!carousel?.swiper || carousel?.classList.contains('swiper-initialized'),
        hasShowGrid: !!document.querySelector('.events-shows-grid'),
        showCardCount: slides.length,
        wrapperDisplay: wrapper ? getComputedStyle(wrapper).display : '',
        slideTopSpread,
        carouselWidth: Math.round(carouselRect.width),
        carouselHeight: Math.round(carouselRect.height),
        showImages: showImages.map((image) => ({
          currentSrc: image.currentSrc,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          objectFit: getComputedStyle(image).objectFit,
        })),
        ctaText: cta ? cta.textContent.trim() : '',
        ctaFits: fits(cta),
        ctaWidth: Math.round(ctaRect.width),
        ctaHeight: Math.round(ctaRect.height),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`,
  });

  return result.result.value;
}

async function collectPosterFitMetrics(page, origin, route, imageSelector, hoverSelector, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const loaded = page.waitForEvent('Page.loadEventFired', 5000).catch(() => null);
  await page.send('Page.navigate', { url: `${origin}${route}` });
  await loaded;
  await delay(300);

  let initial = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const before = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const image = document.querySelector(${JSON.stringify('${imageSelector}')});
        const hoverTarget = document.querySelector(${JSON.stringify('${hoverSelector}')});
        if (!image || !hoverTarget || !image.naturalWidth || !image.naturalHeight) return null;
        const imageRect = image.getBoundingClientRect();
        const hoverRect = hoverTarget.getBoundingClientRect();
        const style = getComputedStyle(image);
        return {
          currentSrc: image.currentSrc,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          objectFit: style.objectFit,
          transform: style.transform,
          frameRatio: hoverRect.width / hoverRect.height,
          hoverX: hoverRect.left + hoverRect.width / 2,
          hoverY: hoverRect.top + hoverRect.height / 2,
          imageWidth: imageRect.width,
          imageHeight: imageRect.height,
          frameWidth: hoverRect.width,
          frameHeight: hoverRect.height,
        };
      })()`.replace('${imageSelector}', imageSelector).replace('${hoverSelector}', hoverSelector),
    });

    if (before.result.value) {
      initial = before.result.value;
      break;
    }
    await delay(100);
  }

  if (!initial) throw new Error(`Timed out waiting for poster selector ${imageSelector} on ${route}`);
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: initial.hoverX,
    y: initial.hoverY,
  });
  await delay(120);

  const after = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const image = document.querySelector(${JSON.stringify('${imageSelector}')});
      return { transform: getComputedStyle(image).transform };
    })()`.replace('${imageSelector}', imageSelector),
  });

  return { ...initial, transformAfterHover: after.result.value.transform };
}

async function collectHuliganDetailLayout(page, origin, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const loaded = page.waitForEvent('Page.loadEventFired');
  await page.send('Page.navigate', { url: `${origin}/concerts/huligan/` });
  await loaded;
  await delay(300);

  const result = await page.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const poster = document.querySelector('#huliganPoster');
      const copy = document.querySelector('.show-hero-copy');
      const titleSpan = document.querySelector('.show-hero-copy h1 span');
      const subtitle = document.querySelector('.show-hero-copy .subtitle');
      const ecosystem = document.querySelector('.show-ecosystem-quick');
      const ecosystemTitle = document.querySelector('.show-ecosystem-quick__title h2');
      const ecosystemLinks = document.querySelector('.show-ecosystem-quick__links');
      const posterRect = poster.getBoundingClientRect();
      const copyRect = copy.getBoundingClientRect();
      const ecosystemRect = ecosystem.getBoundingClientRect();
      const ecosystemTitleRect = ecosystemTitle.getBoundingClientRect();
      const ecosystemLinksRect = ecosystemLinks.getBoundingClientRect();
      const titleColor = getComputedStyle(titleSpan).color;
      const subtitleColor = getComputedStyle(subtitle).color;
      const accent = getComputedStyle(document.body).getPropertyValue('--show-accent').trim();
      return {
        posterCopyGap: Math.round(copyRect.left - posterRect.right),
        posterBottom: Math.round(posterRect.bottom),
        copyBottom: Math.round(copyRect.bottom),
        accent,
        titleColor,
        subtitleColor,
        ecosystemTopGap: Math.round(ecosystemRect.top - Math.max(posterRect.bottom, copyRect.bottom)),
        ecosystemTitleFontSize: Number.parseFloat(getComputedStyle(ecosystemTitle).fontSize),
        ecosystemTitleToLinksGap: Math.round(ecosystemLinksRect.left - ecosystemTitleRect.right),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`,
  });

  return result.result.value;
}


async function collectHuliganSalesCardsLayout(page, origin, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  const loaded = page.waitForEvent('Page.loadEventFired', 5000).catch(() => null);
  await page.send('Page.navigate', { url: `${origin}/concerts/huligan/?layoutWidth=${width}#huliganFitTitle` });
  await loaded;
  await delay(350);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const section = document.querySelector('.show-sales-section');
        const grid = section?.querySelector('.show-sales-grid');
        const cards = grid ? [...grid.querySelectorAll('.show-sales-card')] : [];
        const cta = section?.querySelector('.show-sales-card__cta');
        const title = section?.querySelector('#huliganFitTitle');
        if (!section || !grid || !cta || !title || cards.length !== 3) return null;
        const sectionRect = section.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const pageCenter = document.documentElement.clientWidth / 2;
        const cardMetrics = cards.map((card) => {
          const h3 = card.querySelector('h3');
          const p = card.querySelector('p');
          const cardRect = card.getBoundingClientRect();
          const h3Rect = h3.getBoundingClientRect();
          const h3Style = getComputedStyle(h3);
          const cardStyle = getComputedStyle(card);
          const pStyle = getComputedStyle(p);
          const lineHeight = Number.parseFloat(h3Style.lineHeight);
          return {
            cardWidth: Math.round(cardRect.width),
            cardHeight: Math.round(cardRect.height),
            contentWidth: Math.round(h3Rect.width),
            titleLines: Math.round(h3Rect.height / lineHeight),
            cardWordBreak: cardStyle.wordBreak,
            cardOverflowWrap: cardStyle.overflowWrap,
            paragraphLineHeight: Number.parseFloat(pStyle.lineHeight),
          };
        });
        const ctaRect = cta.getBoundingClientRect();
        const ctaTextRect = cta.previousElementSibling.getBoundingClientRect();
        return {
          sectionWidth: Math.round(sectionRect.width),
          sectionCenterOffset: Math.round(sectionRect.left + sectionRect.width / 2 - pageCenter),
          gridWidth: Math.round(gridRect.width),
          gridCenterOffset: Math.round(gridRect.left + gridRect.width / 2 - pageCenter),
          gridColumnCount: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
          cardMetrics,
          ctaWidth: Math.round(ctaRect.width),
          ctaHeight: Math.round(ctaRect.height),
          ctaGap: Math.round(ctaRect.top - ctaTextRect.bottom),
          ctaWhiteSpace: getComputedStyle(cta).whiteSpace,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      })()`,
    });

    if (result.result.value) return result.result.value;
    await delay(100);
  }

  throw new Error('Timed out waiting for HULIGAN sales cards to render');
}
async function collectMatveyLevelMetrics(page, origin, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');

  await page.send('Page.navigate', { url: origin + '/concerts/matvey/#about' });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const levelsSection = [...document.querySelectorAll('.section')]
          .find((section) => section.querySelector('.levels'));
        if (!levelsSection) return null;

        const levelNodes = [...levelsSection.querySelectorAll('.level')];
        return {
          heading: levelsSection.querySelector('.section__title').textContent.trim(),
          metaItems: [...document.querySelectorAll('.meta__item')].map((item) => item.textContent.trim()),
          titles: levelNodes.map((item) => item.querySelector('.level__title').textContent.trim()),
          numbers: levelNodes.map((item) => item.querySelector('.level__num').textContent.trim()),
          descriptionCount: levelsSection.querySelectorAll('.level__desc').length,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      })()`
    });

    if (result.result.value) return result.result.value;
    await delay(100);
  }

  throw new Error('Timed out waiting for Matvey quest levels to render');
}


test('private events assistant modal keeps its header and close action visible', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const desktop = await collectPrivateAssistantModalMetrics(page, server.origin, 1440, 900);
    assert.equal(desktop.clicked, true, 'private events CTA should open the assistant');
    assert.equal(desktop.isOpen, true, 'assistant modal should be open');
    assert.match(desktop.avatarSrc, /images\/katerina-2026\.jpg\?v=1$/);
    assert.ok(desktop.avatarNaturalWidth > 0, 'desktop assistant avatar should load');
    assert.ok(desktop.panelTop >= 16, `desktop assistant panel starts too high: ${desktop.panelTop}px`);
    assert.ok(desktop.panelBottom <= desktop.viewportHeight - 16, `desktop assistant panel bottom is outside viewport: ${desktop.panelBottom}px`);
    assert.ok(desktop.panelClearsHeader, 'desktop assistant header is hidden behind the fixed brand bar');
    assert.ok(desktop.closeHitIsClose, 'desktop assistant close button is not the top clickable element');
    assert.ok(desktop.scrollWidth <= desktop.clientWidth, 'desktop assistant modal must not create horizontal overflow');

    const mobile = await collectPrivateAssistantModalMetrics(page, server.origin, 375, 812);
    assert.equal(mobile.clicked, true, 'mobile private events CTA should open the assistant');
    assert.equal(mobile.isOpen, true, 'mobile assistant modal should be open');
    assert.match(mobile.avatarSrc, /images\/katerina-2026\.jpg\?v=1$/);
    assert.ok(mobile.avatarNaturalWidth > 0, 'mobile assistant avatar should load');
    assert.ok(mobile.panelTop >= 12, `mobile assistant panel starts too high: ${mobile.panelTop}px`);
    assert.ok(mobile.panelBottom <= mobile.viewportHeight - 12, `mobile assistant panel bottom is outside viewport: ${mobile.panelBottom}px`);
    assert.ok(mobile.panelClearsHeader, 'mobile assistant header is hidden behind the fixed brand bar');
    assert.ok(mobile.closeHitIsClose, 'mobile assistant close button is not the top clickable element');
    assert.ok(mobile.scrollWidth <= mobile.clientWidth, 'mobile assistant modal must not create horizontal overflow');
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});


test('private events brand uses the frameless transparent KP mark', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const desktop = await collectPrivateEventsBrandMetrics(page, server.origin, 1440, 1000);
    assert.equal(desktop.hasHeader, true, 'private events header should be present');
    assert.equal(desktop.hasFooter, true, 'private events footer should be present');
    assert.match(desktop.headerLogo.src, /images\/brand\/kostyuk-project-monogram-gold-transparent-v1\.png$/);
    assert.match(desktop.footerLogo.src, /images\/brand\/kostyuk-project-monogram-gold-transparent-v1\.png$/);
    assert.ok(desktop.headerLogo.width >= 70, `desktop private events logo is too small: ${desktop.headerLogo.width}px`);
    assert.ok(desktop.footerLogo.width >= 70, `desktop private events footer logo is too small: ${desktop.footerLogo.width}px`);
    assert.equal(desktop.headerLogo.radius, '0px');
    assert.equal(desktop.footerLogo.radius, '0px');
    assert.equal(desktop.headerLogo.background, 'rgba(0, 0, 0, 0)');
    assert.equal(desktop.footerLogo.background, 'rgba(0, 0, 0, 0)');
    assert.equal(desktop.headerLogo.objectFit, 'contain');
    assert.equal(desktop.footerLogo.objectFit, 'contain');
    assert.equal(desktop.labelText, 'ЧАСТНЫЕ СОБЫТИЯ');
    assert.ok(desktop.labelFontSize >= 11, `private events label is too small: ${desktop.labelFontSize}px`);
    assert.ok(desktop.labelWeight >= 700, `private events label should be visually stronger: ${desktop.labelWeight}`);
    assert.ok(desktop.scrollWidth <= desktop.clientWidth, 'desktop private events brand must not create horizontal overflow');

    const mobile = await collectPrivateEventsBrandMetrics(page, server.origin, 375, 812);
    assert.match(mobile.headerLogo.src, /images\/brand\/kostyuk-project-monogram-gold-transparent-v1\.png$/);
    assert.match(mobile.footerLogo.src, /images\/brand\/kostyuk-project-monogram-gold-transparent-v1\.png$/);
    assert.ok(mobile.headerLogo.width >= 54, `mobile private events logo is too small: ${mobile.headerLogo.width}px`);
    assert.ok(mobile.footerLogo.width >= 54, `mobile private events footer logo is too small: ${mobile.footerLogo.width}px`);
    assert.equal(mobile.headerLogo.radius, '0px');
    assert.equal(mobile.footerLogo.radius, '0px');
    assert.equal(mobile.headerLogo.background, 'rgba(0, 0, 0, 0)');
    assert.equal(mobile.footerLogo.background, 'rgba(0, 0, 0, 0)');
    assert.ok(mobile.labelFontSize >= 9, `mobile private events label is too small: ${mobile.labelFontSize}px`);
    assert.ok(mobile.scrollWidth <= mobile.clientWidth, 'mobile private events brand must not create horizontal overflow');
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});

test('private events formats and author shows match the readable author-show showcase', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const desktop = await collectPrivateEventsAuthorShowsMetrics(page, server.origin, 1440, 1000);
    assert.equal(desktop.formatCardCount, 3);
    assert.equal(desktop.formatGridColumns, 3);
    assert.ok(Math.abs(desktop.formatGridCenterOffset) <= 6, `desktop format cards are off-center by ${desktop.formatGridCenterOffset}px`);
    assert.ok(desktop.formatMinCardWidth >= 280, `desktop format cards are too narrow: ${desktop.formatMinCardWidth}px`);
    assert.equal(desktop.formatButtonsFit, true, `desktop format buttons must not clip or wrap awkwardly: ${JSON.stringify(desktop.formatButtonMetrics)}`);
    assert.ok(desktop.promoTitleFontSize <= 24, `desktop ecosystem title is too large: ${desktop.promoTitleFontSize}px`);
    assert.equal(desktop.promoTitleAlign, 'left');
    assert.equal(desktop.promoGridColumns, 2);
    assert.equal(desktop.usesCarousel, true, 'private events should render the author-shows carousel');
    assert.equal(desktop.hasShowGrid, false, 'private events should not render the vertical author-shows grid');
    assert.equal(desktop.showCardCount, 3);
    assert.ok(desktop.carouselInitialized, 'desktop author-shows carousel should initialize');
    assert.ok(desktop.wrapperDisplay === 'flex' || desktop.wrapperDisplay === '-webkit-flex', `unexpected carousel wrapper display: ${desktop.wrapperDisplay}`);
    assert.ok(desktop.slideTopSpread < 80, `desktop carousel slides are stacked vertically: ${desktop.slideTopSpread}px`);
    assert.ok(desktop.carouselHeight <= 620, `desktop carousel is too tall: ${desktop.carouselHeight}px`);
    assert.deepEqual(
      desktop.showImages.map((image) => image.objectFit),
      ['contain', 'contain', 'contain'],
    );
    assert.match(desktop.showImages[0].currentSrc, /\/concerts\/images\/secret\.webp\?v=7$/);
    assert.match(desktop.showImages[1].currentSrc, /\/concerts\/images\/huligan\.webp\?v=9$/);
    assert.match(desktop.showImages[2].currentSrc, /\/concerts\/images\/matvey\.webp\?v=8$/);
    desktop.showImages.forEach((image, index) => {
      assert.ok(image.naturalHeight > image.naturalWidth, `show poster ${index + 1} should be vertical and loaded`);
    });
    assert.equal(desktop.ctaText, 'Перейти к афише');
    assert.ok(desktop.ctaFits, 'desktop author-shows CTA text should fit cleanly');
    assert.ok(desktop.ctaWidth >= 220, `desktop author-shows CTA is too narrow: ${desktop.ctaWidth}px`);
    assert.ok(desktop.ctaHeight <= 56, `desktop author-shows CTA wraps vertically: ${desktop.ctaHeight}px`);
    assert.ok(desktop.scrollWidth <= desktop.clientWidth, 'desktop private events layout must not create horizontal overflow');

    const mobile = await collectPrivateEventsAuthorShowsMetrics(page, server.origin, 375, 812);
    assert.equal(mobile.formatCardCount, 3);
    assert.equal(mobile.formatGridColumns, 1);
    assert.ok(Math.abs(mobile.formatGridCenterOffset) <= 6, `mobile format cards are off-center by ${mobile.formatGridCenterOffset}px`);
    assert.ok(mobile.formatMinCardWidth >= 320, `mobile format cards are too narrow: ${mobile.formatMinCardWidth}px`);
    assert.equal(mobile.formatButtonsFit, true, `mobile format buttons must not clip or wrap awkwardly: ${JSON.stringify(mobile.formatButtonMetrics)}`);
    assert.ok(mobile.promoTitleFontSize <= 18, `mobile ecosystem title is too large: ${mobile.promoTitleFontSize}px`);
    assert.equal(mobile.promoGridColumns, 1);
    assert.equal(mobile.usesCarousel, true, 'mobile private events should render the author-shows carousel');
    assert.equal(mobile.hasShowGrid, false, 'mobile private events should not render the vertical author-shows grid');
    assert.equal(mobile.showCardCount, 3);
    assert.ok(mobile.carouselInitialized, 'mobile author-shows carousel should initialize');
    assert.ok(mobile.slideTopSpread < 80, `mobile carousel slides are stacked vertically: ${mobile.slideTopSpread}px`);
    assert.ok(mobile.carouselHeight <= 560, `mobile carousel is too tall: ${mobile.carouselHeight}px`);
    assert.equal(mobile.ctaText, 'Перейти к афише');
    assert.ok(mobile.ctaFits, 'mobile author-shows CTA text should fit cleanly');
    assert.ok(mobile.scrollWidth <= mobile.clientWidth, 'mobile private events layout must not create horizontal overflow');
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});

test('hub header and footer use the frameless transparent project mark', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const desktop = await collectHubBrandMetrics(page, server.origin, 1440, 1000);
    assert.equal(desktop.hasHeader, true, 'hub should render the shared brand bar');
    assert.equal(desktop.hasFooter, true, 'hub should render the shared footer');
    assert.match(desktop.headerSrc, /images\/brand\/kostyuk-project-monogram-gold-transparent-v1\.png$/);
    assert.match(desktop.footerSrc, /images\/brand\/kostyuk-project-monogram-gold-transparent-v1\.png$/);
    assert.ok(desktop.headerWidth >= 66, `desktop hub header mark is only ${desktop.headerWidth}px wide`);
    assert.ok(desktop.footerWidth >= 58, `desktop hub footer mark is only ${desktop.footerWidth}px wide`);
    assert.equal(desktop.headerBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(desktop.headerRadius, '0px');
    assert.equal(desktop.headerShadow, 'none');
    assert.equal(desktop.footerBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(desktop.footerRadius, '0px');
    assert.equal(desktop.footerShadow, 'none');
    assert.ok(desktop.scrollWidth <= desktop.clientWidth, 'desktop hub layout must not create horizontal overflow');

    const mobile = await collectHubBrandMetrics(page, server.origin, 375, 812);
    assert.ok(mobile.headerWidth >= 54, `mobile hub header mark is only ${mobile.headerWidth}px wide`);
    assert.ok(mobile.footerWidth >= 54, `mobile hub footer mark is only ${mobile.footerWidth}px wide`);
    assert.ok(mobile.scrollWidth <= mobile.clientWidth, 'mobile hub layout must not create horizontal overflow');
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});

test('concerts page uses the official mark and keeps the ecosystem panel visually separated', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const desktop = await collectConcertsMetrics(page, server.origin, 1440, 1000);
    assert.match(desktop.logoSrc, /images\/brand\/kostyuk-author-shows-logo-v1\.png$/);
    assert.ok(
      desktop.logoContent === 'normal' || desktop.logoContent === 'none' || desktop.logoContent.includes('kostyuk-author-shows-logo-v1.png'),
      `unexpected logo CSS content: ${desktop.logoContent}`,
    );
    assert.ok(desktop.logoWidth >= 46, `desktop author-show logo is only ${desktop.logoWidth}px wide`);
    assert.ok(desktop.logoHeight >= 42, `desktop author-show logo is only ${desktop.logoHeight}px tall`);
    assert.ok(desktop.afterShowsGap >= 36, `desktop gap after show cards is ${desktop.afterShowsGap}px`);
    assert.ok(desktop.titleFontSize <= 20, `desktop title font is ${desktop.titleFontSize}px`);
    assert.ok(desktop.titleToLinksGap >= 22, `desktop title/link gap is ${desktop.titleToLinksGap}px`);
    assert.ok(desktop.scrollWidth <= desktop.clientWidth, 'desktop layout must not create horizontal overflow');

    const mobile = await collectConcertsMetrics(page, server.origin, 375, 812);
    assert.ok(mobile.logoWidth >= 38, `mobile author-show logo is only ${mobile.logoWidth}px wide`);
    assert.ok(mobile.logoHeight >= 34, `mobile author-show logo is only ${mobile.logoHeight}px tall`);
    assert.ok(mobile.afterShowsGap >= 24, `mobile gap after show cards is ${mobile.afterShowsGap}px`);
    assert.ok(mobile.titleFontSize <= 18, `mobile title font is ${mobile.titleFontSize}px`);
    assert.ok(mobile.scrollWidth <= mobile.clientWidth, 'mobile layout must not create horizontal overflow');
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});


test('huligan poster is fully visible on the showcase and detail page, including hover', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const posterRatio = 1055 / 1491;
    const showcase = await collectPosterFitMetrics(
      page,
      server.origin,
      '/concerts/',
      '.show--huligan .show__poster',
      '.show--huligan',
      1440,
      1000,
    );
    assert.match(showcase.currentSrc, /\/concerts\/images\/huligan\.webp\?v=9$/);
    assert.equal(showcase.naturalWidth, 720);
    assert.equal(showcase.naturalHeight, 1080);
    assert.ok(['contain', 'cover'].includes(showcase.objectFit), `unexpected showcase object-fit: ${showcase.objectFit}`);
    assert.ok(Math.abs((showcase.imageWidth / showcase.imageHeight) - (720 / 1080)) < 0.02, `showcase poster ratio is ${showcase.imageWidth / showcase.imageHeight}`);
    assert.equal(showcase.transformAfterHover, 'none');

    const detail = await collectPosterFitMetrics(
      page,
      server.origin,
      '/concerts/huligan/',
      '#huliganPoster .poster',
      '#huliganPoster',
      1440,
      1000,
    );
    assert.match(detail.currentSrc, /\/concerts\/images\/huligan\.png\?v=\d+$/);
    assert.equal(detail.naturalWidth, 1055);
    assert.equal(detail.naturalHeight, 1491);
    assert.equal(detail.objectFit, 'contain');
    assert.ok(Math.abs(detail.frameRatio - posterRatio) < 0.02, `detail poster frame ratio is ${detail.frameRatio}`);
    assert.equal(detail.transformAfterHover, 'none');

    const mobileShowcase = await collectPosterFitMetrics(
      page,
      server.origin,
      '/concerts/',
      '.show--huligan .show__poster',
      '.show--huligan',
      390,
      844,
    );
    assert.match(mobileShowcase.currentSrc, /\/concerts\/images\/huligan\.webp\?v=9$/);
    assert.equal(mobileShowcase.naturalWidth, 720);
    assert.equal(mobileShowcase.naturalHeight, 1080);
    assert.ok(['contain', 'cover'].includes(mobileShowcase.objectFit), `unexpected mobile showcase object-fit: ${mobileShowcase.objectFit}`);
    assert.ok(Math.abs((mobileShowcase.imageWidth / mobileShowcase.imageHeight) - (720 / 1080)) < 0.02, `mobile showcase poster ratio is ${mobileShowcase.imageWidth / mobileShowcase.imageHeight}`);
    assert.equal(mobileShowcase.transformAfterHover, 'none');

    const mobileDetail = await collectPosterFitMetrics(
      page,
      server.origin,
      '/concerts/huligan/',
      '#huliganPoster .poster',
      '#huliganPoster',
      390,
      844,
    );
    assert.match(mobileDetail.currentSrc, /\/concerts\/images\/huligan\.png\?v=\d+$/);
    assert.equal(mobileDetail.naturalWidth, 1055);
    assert.equal(mobileDetail.naturalHeight, 1491);
    assert.equal(mobileDetail.objectFit, 'contain');
    assert.ok(Math.abs(mobileDetail.frameRatio - posterRatio) < 0.02, `mobile detail poster frame ratio is ${mobileDetail.frameRatio}`);
    assert.equal(mobileDetail.transformAfterHover, 'none');
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});


test('huligan detail page keeps poster, copy, accent and ecosystem block aligned', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const desktop = await collectHuliganDetailLayout(page, server.origin, 1440, 1000);
    assert.ok(desktop.posterCopyGap >= 48, `poster overlaps or sits too close to copy: ${desktop.posterCopyGap}px`);
    assert.ok(desktop.ecosystemTopGap >= 28, `ecosystem block is too close to hero: ${desktop.ecosystemTopGap}px`);
    assert.equal(desktop.accent.toLowerCase(), '#ff6e00');
    assert.equal(desktop.titleColor, 'rgb(255, 110, 0)');
    assert.equal(desktop.subtitleColor, 'rgb(255, 110, 0)');
    assert.ok(desktop.ecosystemTitleFontSize <= 22, `ecosystem title is ${desktop.ecosystemTitleFontSize}px`);
    assert.ok(desktop.ecosystemTitleToLinksGap >= 20, `ecosystem title/link gap is ${desktop.ecosystemTitleToLinksGap}px`);
    assert.ok(desktop.scrollWidth <= desktop.clientWidth, 'detail layout must not create horizontal overflow');
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});


test('huligan sales cards stay readable instead of breaking words into columns', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const desktop = await collectHuliganSalesCardsLayout(page, server.origin, 1280, 900);
    assert.ok(desktop.sectionWidth >= 960, `sales section is too narrow: ${desktop.sectionWidth}px`);
    assert.ok(Math.abs(desktop.gridCenterOffset) <= 4, `sales grid is shifted from center: ${desktop.gridCenterOffset}px`);
    assert.ok(desktop.titleFontSize <= 38, `sales title is too large: ${desktop.titleFontSize}px`);
    assert.equal(desktop.gridColumnCount, 3);
    desktop.cardMetrics.forEach((card, index) => {
      assert.ok(card.cardWidth >= 280, `sales card ${index + 1} is too narrow: ${card.cardWidth}px`);
      assert.ok(card.cardHeight <= 215, `sales card ${index + 1} is too tall: ${card.cardHeight}px`);
      assert.ok(card.contentWidth >= 220, `sales card ${index + 1} content is too narrow: ${card.contentWidth}px`);
      assert.ok(card.titleLines <= 3, `sales card ${index + 1} title takes ${card.titleLines} lines`);
      assert.equal(card.cardWordBreak, 'normal', `sales card ${index + 1} must not force word breaks`);
      assert.equal(card.cardOverflowWrap, 'normal', `sales card ${index + 1} must not force overflow wrapping`);
    });
    assert.ok(desktop.ctaWidth >= 160, `sales CTA is too narrow: ${desktop.ctaWidth}px`);
    assert.ok(desktop.ctaHeight <= 50, `sales CTA wraps vertically: ${desktop.ctaHeight}px`);
    assert.ok(desktop.ctaGap >= 18, `sales CTA is too close to text: ${desktop.ctaGap}px`);
    assert.equal(desktop.ctaWhiteSpace, 'nowrap');
    assert.ok(desktop.scrollWidth <= desktop.clientWidth, 'sales cards must not create horizontal overflow');

    const wide = await collectHuliganSalesCardsLayout(page, server.origin, 1920, 1200);
    assert.ok(Math.abs(wide.gridCenterOffset) <= 4, `wide sales grid is shifted from center: ${wide.gridCenterOffset}px`);
    assert.ok(wide.ctaGap >= 18, `wide sales CTA is too close to text: ${wide.ctaGap}px`);
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});

test('matvey detail renders the updated eight title-only quest levels', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    const expectedTitles = [
      'Запуск шкалы',
      'Тишина',
      'Карта на скорость (скрытая угроза)',
      'Разум и сердце',
      'Чувство',
      'Предсказание',
      'Снежный шторм',
      'Триумф мастера',
    ];

    const desktop = await collectMatveyLevelMetrics(page, server.origin, 1440, 1000);
    assert.equal(desktop.heading, '8 уровней квеста');
    assert.ok(desktop.metaItems.includes('8 уровней'));
    assert.deepEqual(desktop.titles, expectedTitles);
    assert.deepEqual(desktop.numbers, ['01', '02', '03', '04', '05', '06', '07', '08']);
    assert.equal(desktop.descriptionCount, 0);
    assert.ok(desktop.scrollWidth <= desktop.clientWidth, 'desktop Matvey levels must not create horizontal overflow');

    const mobile = await collectMatveyLevelMetrics(page, server.origin, 375, 812);
    assert.equal(mobile.heading, '8 уровней квеста');
    assert.ok(mobile.metaItems.includes('8 уровней'));
    assert.deepEqual(mobile.titles, expectedTitles);
    assert.deepEqual(mobile.numbers, ['01', '02', '03', '04', '05', '06', '07', '08']);
    assert.equal(mobile.descriptionCount, 0);
    assert.ok(mobile.scrollWidth <= mobile.clientWidth, 'mobile Matvey levels must not create horizontal overflow');
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});


async function collectShowBackNavigation(page, origin, slug, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.navigate', { url: origin + '/concerts/' + slug + '/' });

  const deadline = Date.now() + 20_000;
  let metrics = null;
  while (Date.now() < deadline) {
    const result = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const link = document.querySelector('.show-back-to-afisha');
        if (!link) return null;
        const rect = link.getBoundingClientRect();
        const style = getComputedStyle(link);
        const clickX = rect.left + rect.width / 2;
        const clickY = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(clickX, clickY);
        return {
          text: link.textContent.trim(),
          href: link.getAttribute('href'),
          visible: rect.width >= 64 && rect.height >= 34 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0,
          clickable: hit === link || link.contains(hit),
          position: style.position,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          clickX,
          clickY,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      })()`,
    });
    if (result.result.value?.visible && result.result.value.clickable) {
      metrics = result.result.value;
      break;
    }
    await delay(100);
  }

  if (!metrics) throw new Error(`Missing back link on /concerts/${slug}/`);

  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: metrics.clickX, y: metrics.clickY, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: metrics.clickX, y: metrics.clickY, button: 'left', clickCount: 1 });

  const navDeadline = Date.now() + 10_000;
  while (Date.now() < navDeadline) {
    const result = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: 'location.pathname',
    });
    if (result.result.value === '/concerts/') return { ...metrics, pathnameAfterClick: result.result.value };
    await delay(100);
  }

  throw new Error(`Back link on /concerts/${slug}/ did not navigate to /concerts/`);
}

test('show detail pages provide visible back navigation to the concerts showcase', async () => {
  assert.equal(existsSync(CHROME), true, 'Google Chrome is required for this layout test');

  const server = await startStaticServer();
  const chrome = await startChrome();
  const page = await connectCdp(chrome.pageWebSocketUrl);

  try {
    for (const slug of ['secret', 'huligan', 'matvey']) {
      for (const [width, height] of [[1440, 1000], [375, 812]]) {
        const metrics = await collectShowBackNavigation(page, server.origin, slug, width, height);
        assert.equal(metrics.href, '/concerts/');
        assert.equal(metrics.text, 'К афише');
        assert.equal(metrics.visible, true, `back link is not visible on ${slug} at ${width}px`);
        assert.equal(metrics.clickable, true, `back link is covered on ${slug} at ${width}px`);
        assert.equal(metrics.position, 'fixed');
        assert.ok(metrics.top >= 10, `back link is too high on ${slug} at ${width}px`);
        assert.ok(metrics.left >= 10, `back link is too far left on ${slug} at ${width}px`);
        assert.ok(metrics.scrollWidth <= metrics.clientWidth, `back link creates horizontal overflow on ${slug} at ${width}px`);
        assert.equal(metrics.pathnameAfterClick, '/concerts/');
      }
    }
  } finally {
    page.close();
    await chrome.close();
    await server.close();
  }
});
