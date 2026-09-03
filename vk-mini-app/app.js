import {
  buildLaunchHref,
  focusRouteHeading,
  parseLaunchRoute,
  pushLaunchRoute,
} from './lib/router.js';
import { SHOWS } from './lib/shows.js';

function showHref(locationLike, showId) {
  return buildLaunchHref(locationLike, showId);
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

function renderShow(root, show) {
  root.innerHTML = `
    <article class="show-detail">
      <button class="show-detail__back" type="button" data-show-route>← Все шоу</button>
      <img class="show-detail__poster" src="${show.poster}" alt="Афиша шоу «${show.title}»" />
      <div class="show-detail__content">
        <p class="eyebrow">Авторское шоу</p>
        <h1>${show.title}</h1>
        <p class="show-detail__description">${show.description}</p>
        <p class="show-detail__notice">Продажа билетов станет доступна после загрузки расписания.</p>
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
}) {
  function render({ focusHeading = false } = {}) {
    const route = parseLaunchRoute(locationLike);
    const show = route.show ? SHOWS[route.show] : null;
    show ? renderShow(root, show) : renderCatalog(root, locationLike);
    if (focusHeading) focusRouteHeading(root);
  }

  function handleRouteClick(event) {
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
