import { parseLaunchRoute } from './lib/router.js';
import { SHOWS } from './lib/shows.js';

const app = document.querySelector('#app');

function showHref(showId) {
  const url = new URL(window.location.href);
  url.searchParams.set('show', showId);
  return `${url.pathname}${url.search}`;
}

function renderCatalog() {
  const cards = Object.values(SHOWS).map((show) => `
    <a class="show-card" href="${showHref(show.id)}">
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
      <button class="show-detail__back" type="button" data-back>← Все шоу</button>
      <img class="show-detail__poster" src="${show.poster}" alt="Афиша шоу «${show.title}»" />
      <div class="show-detail__content">
        <p class="eyebrow">Авторское шоу</p>
        <h1>${show.title}</h1>
        <p class="show-detail__description">${show.description}</p>
        <p class="show-detail__notice">Продажа билетов станет доступна после загрузки расписания.</p>
      </div>
    </article>
  `;

  app.querySelector('[data-back]').addEventListener('click', () => {
    window.history.pushState({}, '', window.location.pathname);
    renderCatalog();
  });
}

function renderUnavailable() {
  app.innerHTML = `
    <section class="state-view" data-state="unavailable">
      <h1>Афиша временно недоступна</h1>
      <p>Попробуйте открыть приложение ещё раз немного позже.</p>
    </section>
  `;
}

function render() {
  const route = parseLaunchRoute(window.location);
  const show = route.show ? SHOWS[route.show] : null;
  show ? renderShow(show) : renderCatalog();
}

try {
  render();
  window.addEventListener('popstate', render);
} catch (error) {
  console.error(error);
  renderUnavailable();
}
