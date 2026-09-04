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

// Каталог: карточки всех шоу. Без iframe, постеры — из бандла.
function renderCatalog({ doc, root, onSelect }) {
  const shell = doc.createElement('section');
  shell.className = 'catalog';
  const cards = Object.values(SHOWS).map((show) => `
    <button class="show-card" type="button" data-show-route="${show.id}">
      <img class="show-card__poster" src="${show.poster}" alt="Афиша шоу «${escapeHtml(show.title)}»" />
      <span class="show-card__body">
        <h2>${escapeHtml(show.title)}</h2>
        <p>${escapeHtml(show.description)}</p>
        <span class="show-card__action">Открыть шоу →</span>
      </span>
    </button>`).join('');
  shell.innerHTML = `
    <header class="catalog__header">
      <p class="eyebrow">Kostyuk Project</p>
      <h1>Авторские шоу</h1>
      <p class="catalog__intro">Выберите историю, которую хотите увидеть на сцене.</p>
    </header>
    <div class="show-grid">${cards}</div>`;
  shell.addEventListener('click', (event) => {
    const card = event.target.closest?.('[data-show-route]');
    if (card && onSelect) onSelect(card.dataset.showRoute);
  });
  root.replaceChildren(shell);
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
    renderCatalog({ doc, root, onSelect });
  }
  return {
    destroy() {
      ctrl?.destroy?.();
      root.classList.remove('app-shell--show');
      root.replaceChildren();
    },
  };
}
