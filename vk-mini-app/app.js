import {
  buildLaunchHref,
  focusRouteHeading,
  parseLaunchRoute,
  pushLaunchRoute,
} from './lib/router.js';
import { SHOWS } from './lib/shows.js';
import { createApiClient } from './lib/api.js';
import { loadShowData } from './lib/show-data.js';

function showHref(locationLike, showId) {
  return buildLaunchHref(locationLike, showId);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Собирает читаемую строку расписания из реального конфига шоу.
function scheduleLine(showConfig) {
  const s = showConfig && showConfig.show;
  if (!s) return '';
  return [s.date, s.time, s.venue].filter(Boolean).map(escapeHtml).join(' · ');
}

// Считает свободные/всего места по реальной занятости с сервера.
function seatSummary(seats) {
  const values = Object.values(seats || {});
  if (!values.length) return null;
  const total = values.length;
  const free = values.filter((x) => !x.taken).length;
  return { total, free };
}

function renderCatalog(root, locationLike) {
  const cards = Object.values(SHOWS).map((show) => `
    <a class="show-card" href="${showHref(locationLike, show.id)}" data-show-route="${show.id}">
      <img class="show-card__poster" src="${show.poster}" alt="Афиша шоу «${show.title}»" />
      <span class="show-card__body">
        <h2>${show.title}</h2>
        <p>${show.description}</p>
        <span class="show-card__action">Открыть шоу</span>
      </span>
    </a>
  `).join('');

  root.innerHTML = `
    <section class="catalog">
      <header class="catalog__header">
        <p class="eyebrow">Kostyuk Project</p>
        <h1>Авторские шоу</h1>
        <p class="catalog__intro">Выберите историю, которую хотите увидеть на сцене.</p>
      </header>
      <div class="show-grid">${cards}</div>
    </section>
  `;
}

// state: { status: 'loading' | 'ready' | 'error', data?, error? }
function renderShow(root, show, state = { status: 'loading' }) {
  let detailHtml;
  if (state.status === 'loading') {
    detailHtml = `<p class="show-detail__notice" data-role="status" role="status">Загружаем расписание и места…</p>`;
  } else if (state.status === 'error') {
    detailHtml = `
      <div class="show-detail__error" role="alert">
        <p>Не удалось загрузить данные шоу.</p>
        <button class="show-detail__retry" type="button" data-show-retry="${show.id}">Повторить</button>
      </div>`;
  } else {
    const schedule = scheduleLine(state.data.config);
    const summary = seatSummary(state.data.seats);
    const scheduleHtml = schedule
      ? `<p class="show-detail__schedule">${schedule}</p>`
      : `<p class="show-detail__notice">Дата уточняется.</p>`;
    const seatsHtml = summary
      ? `<p class="show-detail__seats">Свободно мест: <strong>${summary.free}</strong> из ${summary.total}</p>`
      : `<p class="show-detail__notice">Схема мест загрузится при оформлении.</p>`;
    detailHtml = `${scheduleHtml}${seatsHtml}`;
  }

  root.innerHTML = `
    <article class="show-detail">
      <button class="show-detail__back" type="button" data-show-route>← Все шоу</button>
      <img class="show-detail__poster" src="${show.poster}" alt="Афиша шоу «${escapeHtml(show.title)}»" />
      <div class="show-detail__content">
        <p class="eyebrow">Авторское шоу</p>
        <h1>${escapeHtml(show.title)}</h1>
        <p class="show-detail__description">${escapeHtml(show.description)}</p>
        ${detailHtml}
      </div>
    </article>
  `;
}

function renderUnavailable(root) {
  root.innerHTML = `
    <section class="state-view" data-state="unavailable" role="alert">
      <h1>Афиша временно недоступна</h1>
      <p>Попробуйте открыть приложение ещё раз немного позже.</p>
    </section>
  `;
}

export function createShellController({
  root,
  locationLike,
  historyLike,
  eventTarget,
  logger = console,
  apiClient = createApiClient(),
  loadData = loadShowData,
}) {
  // Токен загрузки: защищает от гонки, если пользователь быстро переключил шоу.
  let loadToken = 0;

  async function loadAndRenderShow(show, { focusHeading }) {
    const token = ++loadToken;
    renderShow(root, show, { status: 'loading' });
    if (focusHeading) focusRouteHeading(root);

    const result = await loadData(show.id, apiClient);
    if (token !== loadToken) return; // пользователь ушёл на другое шоу — игнорируем
    // Проверяем, что маршрут всё ещё указывает на это шоу.
    if (parseLaunchRoute(locationLike).show !== show.id) return;

    if (result.ok) {
      renderShow(root, show, { status: 'ready', data: result });
    } else {
      logger.error?.(result.error);
      renderShow(root, show, { status: 'error', error: result.error });
    }
    // Повторный рендер заменил заголовок в DOM — возвращаем на него фокус,
    // чтобы навигация оставалась доступной для скринридеров.
    if (focusHeading) focusRouteHeading(root);
  }

  function render({ focusHeading = false } = {}) {
    const route = parseLaunchRoute(locationLike);
    const show = route.show ? SHOWS[route.show] : null;
    if (show) {
      // fire-and-forget: рендерит loading сразу, затем данные/ошибку.
      loadAndRenderShow(show, { focusHeading });
    } else {
      renderCatalog(root, locationLike);
      if (focusHeading) focusRouteHeading(root);
    }
  }

  function handleRouteClick(event) {
    const retryControl = event.target.closest?.('[data-show-retry]');
    if (retryControl) {
      event.preventDefault();
      const show = SHOWS[retryControl.dataset.showRetry];
      if (show) loadAndRenderShow(show, { focusHeading: false });
      return;
    }
    const routeControl = event.target.closest?.('[data-show-route]');
    if (!routeControl) return;

    event.preventDefault();
    pushLaunchRoute(historyLike, locationLike, routeControl.dataset.showRoute || null);
    render({ focusHeading: true });
  }

  function handlePopState() {
    render({ focusHeading: true });
  }

  function start() {
    try {
      render({ focusHeading: parseLaunchRoute(locationLike).show !== null });
      root.addEventListener('click', handleRouteClick);
      eventTarget.addEventListener('popstate', handlePopState);
    } catch (error) {
      logger.error(error);
      renderUnavailable(root);
      focusRouteHeading(root);
    }
  }

  return { start };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const app = document.querySelector('#app');
  createShellController({
    root: app,
    locationLike: window.location,
    historyLike: window.history,
    eventTarget: window,
  }).start();
}
