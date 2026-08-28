/* KOSTYUK PROJECT — единая шапка, переключатель направлений и Telegram-кнопка.
   Подключается на всех страницах, разметку строит сам. */
(function () {
  var ROOT = (document.currentScript && document.currentScript.dataset.root) || '/';
  var SECTION = (document.currentScript && document.currentScript.dataset.section) || '';

  var DIRECTIONS = [
    { key: 'shows',  href: 'concerts/index.html', title: 'Авторские шоу',  sub: 'Афиша · билеты · гастроли',   cta: 'Смотреть афишу' },
    { key: 'events', href: 'events/index.html',   title: 'Частные события', sub: 'Свадьбы · корпоративы · праздники', cta: 'Пригласить Дмитрия' },
    { key: 'school', href: 'school/index.html',   title: 'Школа фокусов',  sub: 'Обучение детей 7–13 лет',     cta: 'Подробнее' }
  ];

  var LABELS = { shows: 'АВТОРСКИЕ ШОУ', events: 'ЧАСТНЫЕ СОБЫТИЯ', school: 'ШКОЛА ФОКУСОВ', hub: '' };
  var DEFAULT_LOGO = 'images/brand/kostyuk-project-monogram-gold-transparent-v1.png';
  var SECTION_LOGOS = {
    hub: 'images/brand/kostyuk-project-monogram-gold-transparent-v1.png',
    events: 'images/brand/kostyuk-project-monogram-gold-transparent-v1.png',
    shows: 'images/brand/kostyuk-author-shows-logo-v1.png',
    school: 'images/brand/kostyuk-project-monogram-gold-transparent-v1.png'
  };

  function toggleProjectSwitcher(open) {
    var s = document.getElementById('projectSwitcher');
    if (!s) return;
    s.classList.toggle('is-open', !!open);
    s.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  window.toggleProjectSwitcher = toggleProjectSwitcher;

  function buildHeader() {
    if (document.querySelector('.brand-bar')) return;
    var label = LABELS[SECTION] || '';
    var home = SECTION === 'hub' ? '#top' : ROOT;
    var logoPath = SECTION_LOGOS[SECTION] || DEFAULT_LOGO;
    var logoAlt = 'Kostyuk Project';
    var h = document.createElement('header');
    h.className = 'brand-bar' + (SECTION ? ' brand-bar--' + SECTION : '');
    h.setAttribute('aria-label', 'Kostyuk Project');
    h.innerHTML =
      '<a class="brand-bar__identity" href="' + home + '" aria-label="Kostyuk Project — на главную">' +
        '<img src="' + ROOT + logoPath + '" alt="' + logoAlt + '" width="48" height="48">' +
        '<span><strong>KOSTYUK PROJECT</strong>' + (label ? '<small>' + label + '</small>' : '') + '</span>' +
      '</a>' +
      '<div class="brand-bar__actions">' +
        '<a href="tel:+79092763386" class="brand-bar__phone" aria-label="Позвонить Дмитрию Костюку">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>' +
          '<span class="header-phone-text">+7 (909) 276-33-86</span>' +
        '</a>' +
        // Кнопка «Все проекты» не нужна на хабе — там и так есть выбор всех направлений
        (SECTION === 'hub' ? '' : '<button class="brand-bar__cta" type="button" aria-haspopup="dialog">Все проекты</button>') +
      '</div>';
    var ctaBtn = h.querySelector('.brand-bar__cta');
    if (ctaBtn) ctaBtn.addEventListener('click', function () { toggleProjectSwitcher(true); });
    document.body.insertBefore(h, document.body.firstChild);
  }

  function buildSwitcher() {
    if (document.getElementById('projectSwitcher')) return;
    var wrap = document.createElement('div');
    wrap.className = 'project-switcher';
    wrap.id = 'projectSwitcher';
    wrap.setAttribute('aria-hidden', 'true');
    var items = DIRECTIONS.map(function (d, i) {
      var current = d.key === SECTION;
      return '<a class="switcher-item--' + d.key + (current ? ' is-current' : '') + '" href="' + (current ? '#top' : ROOT + d.href) + '">' +
        '<span class="switcher-index">0' + (i + 1) + '</span>' +
        (current ? '<div class="switcher-badge">Вы здесь</div>' : '') +
        '<strong>' + d.title + '</strong><span>' + d.sub + '</span>' +
        '<b>' + (current ? 'Активно <i>✓</i>' : d.cta + ' <i>↗</i>') + '</b></a>';
    }).join('');
    wrap.innerHTML =
      '<button class="project-switcher__backdrop" type="button" aria-label="Закрыть меню"></button>' +
      '<section class="project-switcher__panel" role="dialog" aria-modal="true" aria-labelledby="projectSwitcherTitle">' +
        '<div class="project-switcher__head">' +
          '<div><span>KOSTYUK PROJECT</span><h2 id="projectSwitcherTitle">Выберите направление</h2></div>' +
          '<button type="button" aria-label="Закрыть">×</button>' +
        '</div>' +
        '<div class="project-switcher__list">' + items + '</div>' +
      '</section>';
    wrap.querySelector('.project-switcher__backdrop').addEventListener('click', function () { toggleProjectSwitcher(false); });
    wrap.querySelector('.project-switcher__head button').addEventListener('click', function () { toggleProjectSwitcher(false); });
    document.body.appendChild(wrap);
  }

  function buildTelegram() {
    if (document.querySelector('.tg-float')) return;
    var a = document.createElement('a');
    a.className = 'tg-float';
    a.href = 'https://t.me/Dmitrokko';
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', 'Связаться в Telegram');
    a.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">' +
      '<path d="M21.9 2.1c-.2-.2-.5-.2-.8-.1L1.8 9.7c-.3.1-.5.4-.5.7 0 .3.2.6.5.7l5.3 1.9 2.2 6.7c.1.3.3.5.6.5.1 0 .2 0 .3-.1l3.2-2.6 4.6 3.4c.2.1.4.1.6 0 .2-.1.3-.3.3-.5L22.5 2.7c0-.3-.4-.5-.6-.6zM8.5 12.1l9.4-6.3-7.7 7.6c-.1.1-.2.2-.2.4l-.5 2.7-1-3.9c0-.3 0-.5.1-.6z"/></svg>';
    document.body.appendChild(a);
  }

  function buildFooter() {
    if (document.querySelector('.kp-footer')) return;
    var old = document.querySelector('body > footer');
    if (old) old.remove();
    var logoPath = SECTION_LOGOS[SECTION] || DEFAULT_LOGO;
    var links = DIRECTIONS.map(function (d) {
      var current = d.key === SECTION;
      return '<a href="' + (current ? '#top' : ROOT + d.href) + '"' + (current ? ' class="is-current"' : '') + '>' + d.title + '</a>';
    }).join('');
    var f = document.createElement('footer');
    f.className = 'kp-footer' + (SECTION ? ' kp-footer--' + SECTION : '');
    f.innerHTML =
      '<div class="kp-footer__inner">' +
        '<a class="kp-footer__brand" href="' + ROOT + '">' +
          '<img src="' + ROOT + logoPath + '" alt="Kostyuk Project" width="44" height="44">' +
          '<span><strong>KOSTYUK PROJECT</strong><small>Дмитрий Костюк · иллюзионист</small></span>' +
        '</a>' +
        '<nav class="kp-footer__nav" aria-label="Направления Kostyuk Project">' + links + '</nav>' +
        '<div class="kp-footer__contacts">' +
          '<a href="tel:+79092763386">+7 (909) 276-33-86</a>' +
          '<a href="https://t.me/Dmitrokko" target="_blank" rel="noopener">Telegram</a>' +
        '</div>' +
      '</div>' +
      '<p class="kp-footer__geo">Выступления проходят по всей Центральной России: Ярославль, Иваново, Кострома, Владимир, Вологда и соседние области.</p>' +
      '<p class="kp-footer__copy">© ' + new Date().getFullYear() + ' · Дмитрий Костюк · Иллюзионист</p>';
    document.body.appendChild(f);
  }

  function init() {
    buildHeader();
    buildSwitcher();
    buildTelegram();
    buildFooter();
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') toggleProjectSwitcher(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
