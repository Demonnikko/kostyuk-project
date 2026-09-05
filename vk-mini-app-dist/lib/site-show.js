// Автономный экран шоу для VK Mini App (версия для VK Hosting).
//
// Прежняя версия показывала страницу сайта /concerts/<show>/ внутри iframe.
// Под белыми списками сайт заблокирован, поэтому iframe оставался пустым.
// Здесь экран рисуется сам: афиша + название + описание + прямой выбор мест
// и оформление (createCheckout). Данные (схема зала, брони, оплата) идут через
// API-клиент на полный адрес сервера. Отзывы/видео пока опущены — они не нужны
// для покупки и относятся к отдельному долгу «контент шоу в базу».

import { SHOWS } from './shows.js?v=3';
import { createApiClient } from './api.js?v=3';
import { createCheckout } from './checkout.js?v=3';

// Каталог = реальная афиша сайта (site/afisha.html) в iframe из бандла.
// Идентична сайту. Клик по шоу приходит из iframe через postMessage
// ('kp-open-show'), который мы превращаем в onSelect.
function renderCatalog({ doc, root, onSelect }) {
  const shell = doc.createElement('section');
  shell.className = 'catalog-fullpage';
  const frame = doc.createElement('iframe');
  frame.className = 'catalog-fullpage__frame';
  frame.title = 'Афиша авторских шоу';
  frame.src = './site/afisha.html';
  shell.append(frame);
  root.replaceChildren(shell);

  function onMessage(e) {
    const data = e && e.data;
    if (data && data.type === 'kp-open-show' && data.show && onSelect) {
      onSelect(data.show);
    }
  }
  doc.defaultView.addEventListener('message', onMessage);
  // Сохраняем для снятия слушателя при уходе с каталога.
  frame._kpMessageHandler = onMessage;
  return {
    destroy() {
      doc.defaultView.removeEventListener('message', frame._kpMessageHandler);
      frame.remove();
    },
  };
}

function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Экран одного шоу: афиша + описание + сразу выбор мест и оформление.
function renderShow({ doc, root, show, bridge, vkUserId, onBack, onError }) {
  const shell = doc.createElement('section');
  shell.className = 'show-screen';
  shell.innerHTML = `
    <button class="show-screen__back" type="button" data-back>← Все шоу</button>
    <img class="show-screen__poster" src="${show.poster}" alt="Афиша шоу «${escapeHtml(show.title)}»" />
    <div class="show-screen__head">
      <p class="eyebrow">Авторское шоу</p>
      <h1 class="show-screen__title">${escapeHtml(show.title)}</h1>
      <p class="show-screen__desc">${escapeHtml(show.description)}</p>
    </div>
    <div class="show-screen__checkout" id="showCheckout"></div>`;
  shell.querySelector('[data-back]')?.addEventListener('click', () => onBack && onBack());
  root.replaceChildren(shell);

  // Монтируем автономный поток покупки прямо на экране шоу.
  const client = createApiClient();
  const checkout = createCheckout({
    root: shell.querySelector('#showCheckout'),
    showId: show.id,
    client,
    vkUserId,
    bridge,
    onError: (e) => onError && onError(e),
  });
  checkout.start();
  return checkout;
}

// Шоу, у которых есть полная страница «как на сайте» внутри бандла.
// Она лежит локально на vk-apps.ru (белый список пускает), поэтому её можно
// открыть в iframe без обращения к заблокированному kostyukproject.ru.
const FULL_PAGE = Object.freeze({
  huligan: './site/huligan.html',
  secret: './site/secret.html',
  matvey: './site/matvey.html',
});

// Открывает полную страницу шоу из бандла в iframe (идентично сайту).
function renderFullPage({ doc, root, show, src, onBack }) {
  const shell = doc.createElement('section');
  shell.className = 'show-fullpage';
  const back = doc.createElement('button');
  back.type = 'button';
  back.className = 'show-fullpage__back';
  back.textContent = '← Все шоу';
  back.addEventListener('click', () => onBack && onBack());
  const frame = doc.createElement('iframe');
  frame.className = 'show-fullpage__frame';
  frame.title = `Шоу «${show.title}»`;
  frame.allow = 'fullscreen; autoplay; encrypted-media; picture-in-picture';
  frame.src = src;
  shell.append(back, frame);
  root.replaceChildren(shell);
  return { destroy() { frame.remove(); } };
}

export function mountSiteShow({ root, show = null, onBack, onSelect, bridge = null, vkUserId = null, onError = null }) {
  const doc = root.ownerDocument;
  root.classList.add('app-shell--show');
  let ctrl = null;
  if (show) {
    const fullSrc = FULL_PAGE[show.id];
    ctrl = fullSrc
      ? renderFullPage({ doc, root, show, src: fullSrc, onBack })
      : renderShow({ doc, root, show, bridge, vkUserId, onBack, onError });
  } else {
    ctrl = renderCatalog({ doc, root, onSelect });
  }
  return {
    destroy() {
      ctrl?.destroy?.();
      root.classList.remove('app-shell--show');
      root.replaceChildren();
    },
  };
}
