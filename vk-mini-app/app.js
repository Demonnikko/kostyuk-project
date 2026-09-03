import {
  buildLaunchHref,
  focusRouteHeading,
  parseLaunchRoute,
  pushLaunchRoute,
} from './lib/router.js';
import { SHOWS } from './lib/shows.js';

const app = document.querySelector('#app');

function showHref(showId) {
  return buildLaunchHref(window.location, showId);
}

function renderCatalog() {
  const cards = Object.values(SHOWS).map((show) => `
    <a class="show-card" href="${showHref(show.id)}" data-show-route="${show.id}">
      <img class="show-card__poster" src="${show.poster}" alt="Афиша шоу «${show.title}»" />
      <span class="show-card__body">
        <h2>${show.title}</h2>
        <p>${show.description}</p>
        <span class="show-card__action">Открыть шоу</span>
      </span>
    </a>
  `).join('');

  app.innerHTML = `
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

function renderShow(show) {
  app.innerHTML = `
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

function renderUnavailable() {
  app.innerHTML = `
    <section class="state-view" data-state="unavailable" role="alert">
      <h1>Афиша временно недоступна</h1>
      <p>Попробуйте открыть приложение ещё раз немного позже.</p>
    </section>
  `;
}

function render({ focusHeading = false } = {}) {
  const route = parseLaunchRoute(window.location);
  const show = route.show ? SHOWS[route.show] : null;
  show ? renderShow(show) : renderCatalog();
  if (focusHeading) focusRouteHeading(app);
}

function handleRouteClick(event) {
  const routeControl = event.target.closest('[data-show-route]');
  if (!routeControl) return;

  event.preventDefault();
  pushLaunchRoute(window.history, window.location, routeControl.dataset.showRoute || null);
  render({ focusHeading: true });
}

try {
  render();
  app.addEventListener('click', handleRouteClick);
  window.addEventListener('popstate', () => render({ focusHeading: true }));
} catch (error) {
  console.error(error);
  renderUnavailable();
  focusRouteHeading(app);
}
