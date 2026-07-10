// Events Page JS Logic
    function toggleFaq(btn) {
      var item = btn.parentElement;
      var content = item.querySelector('.faq-content');
      var icon = item.querySelector('.faq-icon');
      var isOpen = item.classList.contains('active');

      document.querySelectorAll('.faq-item.active').forEach(function(el) {
        if (el !== item) {
          el.classList.remove('active');
          el.querySelector('.faq-content').style.maxHeight = '0';
          el.querySelector('.faq-icon').style.transform = 'rotate(0deg)';
          el.style.borderColor = 'var(--border)';
        }
      });

      if (isOpen) {
        item.classList.remove('active');
        content.style.maxHeight = '0';
        icon.style.transform = 'rotate(0deg)';
        item.style.borderColor = 'var(--border)';
      } else {
        item.classList.add('active');
        content.style.maxHeight = content.scrollHeight + 'px';
        icon.style.transform = 'rotate(45deg)';
        item.style.borderColor = 'var(--gold2)';
      }
    }

// Stargate Portal JS Navigation
    function kpGoToSchool(e) {
      if (e) e.preventDefault();
      var url = '../school/index.html';
      var portal = document.getElementById('kostyukPortal');
      if (portal) {
        portal.classList.add('active');
        setTimeout(function(){ window.location.href = url; }, 1750);
      } else {
        window.location.href = url;
      }
      return false;
    }
    function kpShowSoon() {
      var t = document.getElementById('kpToast');
      if (!t) return;
      t.classList.add('show');
      clearTimeout(window.__kpToastTimer);
      window.__kpToastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2200);
    }

// Quiz & AI Assistant Logic
    /* ===== PLATFORM BRIDGE INIT ===== */
    window.APP_PLATFORM = {
      isVK: false,
      vkInited: false,
      isTelegram: false
    };

    (function initPlatformBridge() {
      try {
        if (window.vkBridge && typeof window.vkBridge.send === 'function') {
          APP_PLATFORM.isVK = true;
          if (typeof window.vkBridge.subscribe === 'function') {
            window.vkBridge.subscribe(function () { });
          }
          window.vkBridge.send('VKWebAppInit')
            .then(function () {
              APP_PLATFORM.vkInited = true;
            })
            .catch(function (error) {
              console.error('VKWebAppInit failed:', error);
            });
        }
      } catch (e) {
        console.error('VK bridge bootstrap error:', e);
      }
    })();

    function expandTelegramWebApp() {
      try {
        if (!window.Telegram || !window.Telegram.WebApp) return;
        APP_PLATFORM.isTelegram = true;
        var tg = window.Telegram.WebApp;
        if (typeof tg.ready === 'function') tg.ready();
        if (typeof tg.expand === 'function') tg.expand();
        if (typeof tg.requestFullscreen === 'function' && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast('8.0')) {
          try { tg.requestFullscreen(); } catch (e) { }
        }
      } catch (e) { }
    }
    expandTelegramWebApp();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) expandTelegramWebApp();
    });
    function haptic() { }

    /* ===== PRELOADER & EFFECTS ===== */
    window.addEventListener('load', function () {
      setTimeout(function () {
        document.getElementById('preloader').classList.add('hidden');
        initTitleGlitch(document.querySelector('.title'));
      }, 800);

      // 3D Tilt Effect on Packs
      var tiltElements = document.querySelectorAll('.pack, .concert-info-box');
      tiltElements.forEach(function (el) {
        el.addEventListener('mousemove', function (e) {
          var rect = el.getBoundingClientRect();
          var x = e.clientX - rect.left;
          var y = e.clientY - rect.top;
          var centerX = rect.width / 2;
          var centerY = rect.height / 2;
          var rotateX = ((y - centerY) / centerY) * -10;
          var rotateY = ((x - centerX) / centerX) * 10;
          el.style.transform = 'perspective(1000px) scale3d(1.02, 1.02, 1.02) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg)';
          el.style.transition = 'none';
        });
        el.addEventListener('mouseleave', function () {
          el.style.transform = '';
          el.style.transition = 'transform 0.5s ease';
        });
      });
    });

    /* ===== HERO TITLE GLITCH ===== */
    function initTitleGlitch(element) {
      if (!element) return;
      var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReduced) return;

      var text = element.getAttribute('data-txt') || element.textContent.replace(/\s+/g, ' ').trim();
      if (text) element.setAttribute('data-txt', text);

      function pulse() {
        element.classList.add('is-glitching');
        setTimeout(function () {
          element.classList.remove('is-glitching');
        }, 340);

        var next = 2500 + Math.random() * 4200;
        setTimeout(pulse, next);
      }

      setTimeout(pulse, 1200);
    }

    /* ===== SCROLL PROGRESS BAR ===== */
    var progressBar = document.getElementById('scrollProgress');
    window.addEventListener('scroll', function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0) progressBar.style.width = (window.scrollY / max * 100) + '%';
    }, { passive: true });

    function isElementNearViewport(el, offset) {
      if (!el) return false;
      var rect = el.getBoundingClientRect();
      var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      var safeOffset = typeof offset === 'number' ? offset : 40;
      return rect.top <= viewportHeight - safeOffset && rect.bottom >= 0;
    }

    /* ===== SCROLL REVEAL ===== */
    var revealNodes = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    function revealEligibleNodes() {
      revealNodes.forEach(function (el) {
        if (el.classList.contains('visible')) return;
        if (isElementNearViewport(el, 30)) el.classList.add('visible');
      });
    }

    if ('IntersectionObserver' in window) {
      var revealObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target) }
        });
      }, { threshold: .12, rootMargin: '0px 0px -30px 0px' });
      revealNodes.forEach(function (el) { revealObs.observe(el) });
      revealEligibleNodes();
      window.addEventListener('scroll', revealEligibleNodes, { passive: true });
      window.addEventListener('resize', revealEligibleNodes);
      window.addEventListener('load', revealEligibleNodes);
      setTimeout(revealEligibleNodes, 700);
    } else {
      revealNodes.forEach(function (el) { el.classList.add('visible') });
    }

    /* ===== PARTICLES ===== */
    (function () {
      var c = document.getElementById('particles'), ctx = c.getContext('2d'), w, h, ps = [];
      function resize() { w = c.width = innerWidth; h = c.height = innerHeight }
      resize(); addEventListener('resize', resize);
      function P() { this.reset() }
      P.prototype.reset = function () { this.x = Math.random() * w; this.y = Math.random() * h; this.s = Math.random() * 2 + .5; this.a = Math.random() * .4 + .1; this.vy = -(Math.random() * .3 + .1); this.vx = (Math.random() - .5) * .2; this.life = Math.random() * 200 + 100; this.t = 0 };
      P.prototype.update = function () { this.x += this.vx; this.y += this.vy; this.t++; if (this.t > this.life || this.y < 0) this.reset() };
      P.prototype.draw = function () { var fade = 1 - this.t / this.life; ctx.globalAlpha = this.a * fade; ctx.fillStyle = '#E7C776'; ctx.beginPath(); ctx.arc(this.x, this.y, this.s, 0, Math.PI * 2); ctx.fill() };
      for (var i = 0; i < 35; i++)ps.push(new P());
      function loop() { ctx.clearRect(0, 0, w, h); ps.forEach(function (p) { p.update(); p.draw() }); requestAnimationFrame(loop) }
      loop();
    })();

    /* ===== GALLERY LIGHTBOX ===== */
    (function () {
      var lb = document.getElementById('lightbox'), img = document.getElementById('lbImg');
      var imgs = [].slice.call(document.querySelectorAll('#gallerySection .swiper-slide img')), ci = 0;
      if (!lb || !img) return;

      function openByIndex(i) {
        if (!imgs.length) return;
        ci = (i + imgs.length) % imgs.length;
        img.src = imgs[ci].src;
        lb.classList.add('active');
        document.body.style.overflow = 'hidden';
        haptic('light');
      }

      function closeLb() {
        lb.classList.remove('active');
        document.body.style.overflow = '';
      }

      imgs.forEach(function (im, i) {
        im.addEventListener('click', function (e) {
          e.stopPropagation();
          openByIndex(i);
        });
      });
      document.getElementById('lbClose').addEventListener('click', closeLb);
      document.getElementById('lbPrev').addEventListener('click', function () { openByIndex(ci - 1); });
      document.getElementById('lbNext').addEventListener('click', function () { openByIndex(ci + 1); });
      lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
      var tx;
      lb.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX }, { passive: true });
      lb.addEventListener('touchend', function (e) { var d = e.changedTouches[0].clientX - tx; if (Math.abs(d) > 50) { d < 0 ? openByIndex(ci + 1) : openByIndex(ci - 1) } }, { passive: true });
    })();

    /* ===== HERO IMG FALLBACK ===== */
    var hi = document.getElementById('heroImg');
    if (hi) hi.addEventListener('error', function () { hi.style.display = 'none' });
    var hv = document.getElementById('heroVideo');
    if (hv && hi) {
      var showHeroFallback = function () { hi.style.opacity = '1'; };
      var hideHeroFallback = function () { hi.style.opacity = '0'; };
      hv.addEventListener('loadeddata', hideHeroFallback);
      hv.addEventListener('canplay', hideHeroFallback);
      hv.addEventListener('error', showHeroFallback);
      hv.play && hv.play().catch(showHeroFallback);
    }

    // Inject CSS for new icons
    var css = document.createElement('style');
    css.innerHTML = `
      /* Match Brand Logo Style: Transparent "White Plate" look for EVERY ICON on site */
      .icon-svg, .icon-nav, .icon-mt, .fab-icon { 
        width: 48px; height: 48px; object-fit: contain; 
        filter: invert(1) grayscale(1) brightness(2) contrast(1.2);
        opacity: 0.9;
        mix-blend-mode: screen; 
      }
      .icon-nav { width: 24px; height: 24px; filter: invert(0.5) grayscale(1); opacity: 0.6; }
      .icon-mt { width: 32px; height: 32px; margin:0 auto 5px; } /* Reset stroke */
      .fab-icon { width: 32px; height: 32px; }
    `;
    document.head.appendChild(css);

// Swiper & Gallery & Booking Forms Logic
    var VK_PERSONAL_ID = 196783025;
    var VK_COMMUNITY_ID = 209268664;
    var TG_CONTACT_URL = 'https://t.me/Dmitrokko';
    var VK_PERSONAL_CHAT_URL = 'https://vk.com/im?sel=' + VK_PERSONAL_ID;
    var VK_CONTACT_URL = VK_PERSONAL_CHAT_URL;
    var MAGIC_PRIZES = [
      {
        id: 0,
        type: 'discount',
        percent: 5,
        userLabel: 'Скидка 5% на первое шоу',
        adminLabel: 'Скидка 5% на первое шоу'
      },
      {
        id: 1,
        type: 'bonus',
        userLabel: 'Секретный бонус к заказу',
        adminLabel: 'Секретный бонус к заказу'
      },
      {
        id: 2,
        type: 'surprise',
        userLabel: 'Сюрприз на мероприятии',
        adminLabel: 'Сюрприз на мероприятии'
      }
    ];

    function getTelegramViewer() {
      try {
        var tgUser = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe
          ? window.Telegram.WebApp.initDataUnsafe.user
          : null;
        if (!tgUser) return null;
        return {
          id: tgUser.id || '',
          username: tgUser.username || '',
          name: [tgUser.first_name || '', tgUser.last_name || ''].join(' ').trim()
        };
      } catch (e) {
        return null;
      }
    }

    var site76MetricsState = {
      counterId: '',
      app: 'site76',
      ready: false
    };
    var SITE76_FALLBACK_COUNTER_ID = '107696179';

    function initYandexMetrika(counterId, appName) {
      var normalizedId = String(counterId || '').trim();
      if (!normalizedId) return;
      if (site76MetricsState.ready && site76MetricsState.counterId === normalizedId) return;

      site76MetricsState.counterId = normalizedId;
      site76MetricsState.app = appName || 'site76';

      function boot() {
        if (typeof window.ym !== 'function' || site76MetricsState.ready) return;
        window.ym(Number(site76MetricsState.counterId), 'init', {
          clickmap: true,
          trackLinks: true,
          accurateTrackBounce: true,
          webvisor: true,
          trackHash: true
        });
        site76MetricsState.ready = true;
        trackYandexGoal('miniapp_open', { app: site76MetricsState.app });
      }

      if (typeof window.ym === 'function') {
        boot();
        return;
      }

      if (!document.querySelector('script[data-ym-loader="site76"]')) {
        var tag = document.createElement('script');
        tag.async = true;
        tag.src = 'https://mc.yandex.ru/metrika/tag.js';
        tag.dataset.ymLoader = 'site76';
        document.head.appendChild(tag);
      }

      var attempts = 0;
      var timer = setInterval(function () {
        attempts += 1;
        if (typeof window.ym === 'function') {
          clearInterval(timer);
          boot();
        } else if (attempts > 60) {
          clearInterval(timer);
        }
      }, 250);
    }

    function trackYandexGoal(goalName, params) {
      if (!site76MetricsState.ready || !site76MetricsState.counterId || typeof window.ym !== 'function') return;
      try {
        window.ym(Number(site76MetricsState.counterId), 'reachGoal', goalName, params || {});
      } catch (e) { }
    }

    setTimeout(function () {
      if (!site76MetricsState.ready) initYandexMetrika(SITE76_FALLBACK_COUNTER_ID, 'site76');
    }, 2500);

    var site76MagicPrizeMemory = null;

    function saveMagicPrize(prize) {
      site76MagicPrizeMemory = prize || null;
      try {
        if (!prize) {
          localStorage.removeItem('site76_magic_prize');
          sessionStorage.removeItem('site76_magic_prize');
          return;
        }
        var serialized = JSON.stringify(prize);
        localStorage.setItem('site76_magic_prize', serialized);
        sessionStorage.setItem('site76_magic_prize', serialized);
      } catch (e) {
        try {
          if (!prize) sessionStorage.removeItem('site76_magic_prize');
          else sessionStorage.setItem('site76_magic_prize', JSON.stringify(prize));
        } catch (err) { }
      }
    }

    function getMagicPrize() {
      try {
        var raw = null;
        try {
          raw = localStorage.getItem('site76_magic_prize');
        } catch (e) { }
        if (!raw) {
          try {
            raw = sessionStorage.getItem('site76_magic_prize');
          } catch (e) { }
        }
        if (!raw && site76MagicPrizeMemory) raw = JSON.stringify(site76MagicPrizeMemory);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        var prizeId = typeof parsed.id === 'number' ? parsed.id : parseInt(parsed.id, 10);
        if (isNaN(prizeId)) return null;
        var basePrize = MAGIC_PRIZES.find(function (item) { return item.id === prizeId; });
        if (!basePrize) return null;
        return {
          id: basePrize.id,
          type: basePrize.type,
          percent: basePrize.percent || 0,
          userLabel: basePrize.userLabel,
          adminLabel: basePrize.adminLabel,
          capturedAt: parsed.capturedAt || '',
          source: 'magic-game'
        };
      } catch (e) {
        return null;
      }
    }

    function buildVkPersonalChatUrl(message) {
      var url = VK_PERSONAL_CHAT_URL;
      if (message) url += '&message=' + encodeURIComponent(message);
      return url;
    }

    function buildQuizContactMessage(summary) {
      if (!summary) return '';
      var lines = [
        'Здравствуйте, Дмитрий.',
        'Я прошел(а) квиз на сайте и хочу обсудить бронирование.',
        'Заявка: ' + summary.leadId,
        'Дата: ' + summary.date,
        'Город: ' + summary.location,
        'Формат: ' + summary.service + ' — ' + summary.duration
      ];
      if (summary.guestsLabel) lines.push('Гости: ' + summary.guestsLabel);
      if (summary.hostLabel) lines.push('Ведущий: ' + summary.hostLabel);
      if (summary.magicPrizeLabel) lines.push('Бонус из игры: ' + summary.magicPrizeLabel);
      if (summary.priceText) lines.push('Расчет: ' + summary.priceText);
      return lines.join('\n');
    }

    function buildQuizLeadPayload(summary, meta) {
      meta = meta || {};
      var viewer = getTelegramViewer();
      return {
        kind: meta.kind || 'quiz_completed',
        leadId: summary.leadId,
        channel: meta.channel || '',
        note: meta.note || '',
        source: 'site76_quiz',
        viewer: viewer,
        magic: summary.magicPrize || null,
        order: {
          area: qState.oblast || '',
          city: qState.city || '',
          date: summary.date,
          guests: summary.guestsLabel || '',
          audience: qState.audience || '',
          service: summary.service,
          duration: summary.duration,
          host: summary.hostLabel || '',
          wishes: qState.welcomeWishes || '',
          price: summary.priceText || 'Нужно рассчитать вручную',
          discount: summary.magicPrizeLabel || '',
          deposit: summary.depositText || '',
          holidayMultiplier: summary.holidayText || ''
        }
      };
    }

    async function sendQuizLead(summary, meta) {
      meta = meta || {};
      if (!summary || !summary.leadId) return;
      trackYandexGoal('quiz_lead_sent', { channel: meta.channel || 'unknown', app: 'site76' });

      qState.sentLeadEvents = qState.sentLeadEvents || {};
      var eventKey = [summary.leadId, meta.kind || 'quiz_completed', meta.channel || 'none'].join(':');
      if (qState.sentLeadEvents[eventKey]) return;
      qState.sentLeadEvents[eventKey] = 'pending';

      try {
        var response = await fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(buildQuizLeadPayload(summary, meta)),
          keepalive: true
        });

        if (!response.ok) throw new Error('Lead API returned ' + response.status);
        var data = await response.json().catch(function () { return { ok: false }; });
        if (!data || !data.ok) throw new Error('Lead API returned invalid payload');
        qState.sentLeadEvents[eventKey] = 'done';
      } catch (error) {
        console.error('Quiz lead send failed:', error);
        delete qState.sentLeadEvents[eventKey];
      }
    }

    function handleQuizBookingChannel(channel) {
      var summary = qState.lastQuizResult;
      trackYandexGoal(channel === 'telegram' ? 'quiz_contact_vk_personal' : 'quiz_contact_vk', { app: 'site76' });
      if (summary) {
        sendQuizLead(summary, {
          kind: 'quiz_contact_click',
          channel: channel,
          note: channel === 'vk'
            ? 'Клиент нажал кнопку бронирования через VK.'
            : 'Клиент нажал кнопку связи через личный VK.'
        });
      }

      closeQuiz();
      if (channel === 'vk') {
        routeToMiniApp(buildVkPersonalChatUrl(summary ? summary.contactMessage : ''));
        return;
      }
      routeToMiniApp(buildVkPersonalChatUrl(summary ? summary.contactMessage : ''));
    }

    // ===== CONCERTS CAROUSEL INIT =====
    var concertsSwiper = new Swiper('.swiper-concerts', {
      effect: 'coverflow', // Drum/3D effect
      grabCursor: true,
      centeredSlides: true,
      slidesPerView: 'auto',
      loop: false,
      initialSlide: 0,
      autoplay: {
        delay: 3000,
        disableOnInteraction: false,
      },
      coverflowEffect: {
        rotate: 40,
        stretch: 0,
        depth: 250,
        modifier: 1,
        slideShadows: true,
      },
      navigation: {
        nextEl: '.swiper-button-next',
        prevEl: '.swiper-button-prev',
      },
      on: {
        slideChange: function () {
          var idx = this.activeIndex;
          var infos = document.querySelectorAll('.concert-info-box');
          infos.forEach(function (el, i) {
            if (i === idx) {
              el.classList.add('active');
            } else {
              el.classList.remove('active');
            }
          });
          if (window.haptic) haptic('light');
        }
      }
    });

    // ===== REVIEWS CAROUSEL INIT =====
    var reviewsNode = document.querySelector('.swiper-reviews');
    if (reviewsNode) {
      new Swiper('.swiper-reviews', {
        loop: true,
        slidesPerView: 1,
        spaceBetween: 10,
        speed: 520,
        autoHeight: true,
        allowTouchMove: true,
        navigation: {
          nextEl: '.reviews-nav__next',
          prevEl: '.reviews-nav__prev'
        }
      });
    }

    // ===== ROUTING =====
    function routeToMiniApp(url) {
      var targetUrl = String(url || '').trim();
      if (!targetUrl) return;

      try {
        if (window.Telegram && window.Telegram.WebApp) {
          if ((/^https:\/\/t\.me\//i.test(targetUrl) || /^tg:\/\//i.test(targetUrl)) && typeof window.Telegram.WebApp.openTelegramLink === 'function') {
            window.Telegram.WebApp.openTelegramLink(targetUrl);
            return;
          }
          if (/^https?:\/\//i.test(targetUrl) && typeof window.Telegram.WebApp.openLink === 'function') {
            window.Telegram.WebApp.openLink(targetUrl);
            return;
          }
        }
      } catch (e) { }

      if (window.vkBridge && typeof vkBridge.send === 'function') {
        vkBridge.send('VKWebAppOpenURL', { url: targetUrl })
          .catch(function () {
            vkBridge.send('VKWebAppOpenUrl', { url: targetUrl })
              .catch(function () { window.open(targetUrl, '_blank', 'noopener'); });
          });
        return;
      }

      window.open(targetUrl, '_blank', 'noopener');
    }

    // ===== INLINE QUIZ & DYNAMIC CALCULATOR =====
    var dynCfg = null;
    var CALC_SERVICES = {
      'Детское шоу': { '30 минут': 8000, '40 минут': 10000, 'Индивидуальное': 15000 },
      'Стандартная шоу-программа': { '20 минут': 14000, '30 минут': 20000, '40 минут': 26000 },
      'Индивидуальное шоу': { '20 минут': 20000, '30 минут': 28000, '40 минут': 36000 },
      'Взрослое шоу': { '20 минут': 14000, '30 минут': 20000, '40 минут': 26000 },
      'Микромагия': { '30 минут': 10000, '1 час': 16000, '2 часа': 24000, '3 часа': 30000 },
      'Свадьба': { '20 минут': 20000, '30 минут': 27000 },
      'Корпоратив': { '20 минут': 21000, '30 минут': 28000 },
      'Юбилей': { '20 минут': 18000, '30 минут': 28000 },
      'Выпускной': { '20 минут': 17000, '30 минут': 24000 }
    };
    var CALC_TRAVEL = {
      'Ярославская': { 'Ярославль': 1000, 'Гаврилов-Ям': 2000, 'Тутаев': 2000, 'Ростов': 3000, 'Данилов': 3000, 'Рыбинск': 3000, 'Любим': 4000, 'Мышкин': 4000, 'Углич': 4000, 'Переславль': 4000, 'Пошехонье': 5000 },
      'Ивановская': { 'Иваново': 2000, 'Кохма': 2000, 'Тейково': 3000, 'Фурманов': 3000, 'Шуя': 3000, 'Приволжск': 3000, 'Вичуга': 4000, 'Родники': 4000, 'Кинешма': 4000, 'Южа': 5000 },
      'Костромская': { 'Кострома': 3000, 'Волгореченск': 3000, 'Нерехта': 3000, 'Галич': 4000, 'Буй': 5000, 'Мантурово': 5000, 'Шарья': 7000 },
      'Владимирская': { 'Александров': 4000, 'Владимир': 5000, 'Ковров': 5000, 'Гусь-Хрустальный': 6000, 'Муром': 7000 },
      'Вологодская': { 'Вологда': 5000, 'Сокол': 5500, 'Череповец': 7000 },
      'Московская': { 'Москва': 6000, 'Химки': 7000, 'Мытищи': 7000, 'Люберцы': 7000, 'Красногорск': 7000, 'Королёв': 7000, 'Одинцово': 7000, 'Балашиха': 7000, 'Реутов': 7000, 'Подольск': 8000, 'Видное': 8000, 'Пушкино': 8000, 'Щёлково': 8000, 'Домодедово': 8000, 'Зеленоград': 8000, 'Сергиев Посад': 9000, 'Коломна': 9000 }
    };
    var CALC_HOLIDAYS = { '12-31': 2, '01-01': 2, '05-09': 1.4, '02-23': 1.3 };
    var CALC_HOLIDAY_RANGES = [
      { sm: 12, sd: 10, em: 12, ed: 30, k: 1.5 },
      { sm: 1, sd: 2, em: 1, ed: 8, k: 1.3 },
      { sm: 5, sd: 1, em: 5, ed: 3, k: 1.2 },
      { sm: 5, sd: 4, em: 5, ed: 8, k: 1.3 },
      { sm: 3, sd: 6, em: 3, ed: 8, k: 1.3 }
    ];

    function getCfgServices() { return (dynCfg && dynCfg.services) || CALC_SERVICES; }
    function getCfgTravel() { return (dynCfg && dynCfg.travel) || CALC_TRAVEL; }
    function getCfgHolidays() { return (dynCfg && dynCfg.holidays) || CALC_HOLIDAYS; }
    function getCfgRanges() { return (dynCfg && dynCfg.holidayRanges) || CALC_HOLIDAY_RANGES; }
    function getCfgDeposit() { return (dynCfg && dynCfg.deposit) || 50; }

    function getTravelCost(oblast, city) {
      var t = getCfgTravel();
      var reg = t[oblast];
      if (!reg) return 0;
      if (reg.cities) return reg.cities[city] || 0;
      return reg[city] || 0;
    }

    function getAvailableRegions() {
      return Object.keys(getCfgTravel() || {});
    }

    function getAvailableCities(oblast) {
      var reg = (getCfgTravel() || {})[oblast];
      if (!reg) return [];
      return Object.keys(reg.cities || reg || {});
    }

    function getHolidayMultiplier(month, day) {
      if (!month || !day) return 1;
      var key = String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var keyLegacy = key.replace('-', '_');
      var hols = getCfgHolidays();
      if (hols[key]) return hols[key];
      if (hols[keyLegacy]) return hols[keyLegacy];
      var y = new Date().getFullYear();
      var dateTs = new Date(y, month - 1, day).getTime();
      var ranges = getCfgRanges();
      for (var i = 0; i < ranges.length; i++) {
        var r = ranges[i];
        var startTs = new Date(y, r.sm - 1, r.sd).getTime();
        var endTs = new Date(y, r.em - 1, r.ed).getTime();
        if (endTs < startTs) {
          if (dateTs >= startTs || dateTs <= endTs) return r.k;
        } else {
          if (dateTs >= startTs && dateTs <= endTs) return r.k;
        }
      }
      return 1;
    }

    function rub(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

    // Fetch dynamic config on load
    window.addEventListener('load', function () {
      fetch('/api/prices')
        .then(res => res.json())
        .then(data => {
          if (data && data.services) dynCfg = data;
          if (data && data.metrics && data.metrics.yandexCounterId) {
            initYandexMetrika(data.metrics.yandexCounterId, 'site76');
          }
        })
        .catch(err => {
          console.error('Using fallback prices.', err);
          if (!site76MetricsState.ready) initYandexMetrika(SITE76_FALLBACK_COUNTER_ID, 'site76');
        });
    });

    // Quiz State
    var qState = {
      step: '', // start, month, day, time, oblast, city, audience, guests, vedushchy, category, indiv_sub, welcome_wishes, duration
      month: 0, day: 0, time: '',
      oblast: '', city: '',
      audience: '', guests: '', vedushchy: '',
      category: '', indivEvent: '', welcomeWishes: '',
      serviceType: '', duration: '',
      history: [], // stack of steps to go back
      lastQuizResult: null,
      sentLeadEvents: {}
    };

    var uiTitle = '';
    var uiButtons = []; // {label, color, val}
    var uiInput = null; // {placeholder}

    function pushState(newStep) {
      qState.history.push(qState.step);
      qState.step = newStep;
      renderActiveStep();
    }
    function popState() {
      if (qState.history.length === 0) return;
      qState.step = qState.history.pop();
      renderActiveStep();
    }

    function renderActiveStep() {
      uiButtons = []; uiInput = null; uiTitle = '';
      var s = qState.step;

      if (s === 'start') {
        uiTitle = 'Чтобы узнать стоимость, вам нужно будет ответить на несколько вопросов.\nЭто займет не более минуты. Готовы?';
        uiButtons = [{ label: 'Далее →', val: 'start', color: 'primary' }];
      }
      else if (s === 'month') {
        uiTitle = 'В каком месяце будет праздник?';
        var mNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
        mNames.forEach((n, i) => uiButtons.push({ label: n, val: i + 1 }));
      }
      else if (s === 'day') {
        uiTitle = 'Месяц: ' + ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'][qState.month - 1] + '\nВыберите число:';
        var days31 = [1, 3, 5, 7, 8, 10, 12];
        var maxDay = qState.month === 2 ? 29 : days31.includes(qState.month) ? 31 : 30;
        for (var i = 1; i <= maxDay; i++) uiButtons.push({ label: i.toString(), val: i });
      }
      else if (s === 'time') {
        uiTitle = 'Напишите примерное время начала\n(например: 18:00, вечером)';
        uiInput = { placeholder: 'Введите время...' };
        uiButtons = [{ label: '🕒 Пока не знаю', val: 'Не указано', color: 'secondary' }];
      }
      else if (s === 'oblast') {
        uiTitle = 'Шаг 2 из 3: Локация\nВыберите область:';
        getAvailableRegions().forEach(ob => uiButtons.push({ label: ob, val: ob }));
      }
      else if (s === 'city') {
        uiTitle = 'Область: ' + qState.oblast + '\nВыберите город:';
        var cities = getAvailableCities(qState.oblast);
        cities.forEach(c => uiButtons.push({ label: c, val: c }));
      }
      else if (s === 'audience') {
        uiTitle = 'Шаг 3 из 3: Формат\nДля кого шоу?';
        uiButtons = [
          { label: '👶 Для детей', val: 'детское', color: 'primary' },
          { label: '🎭 Для взрослых', val: 'взрослые', color: 'primary' }
        ];
      }
      else if (s === 'guests') {
        uiTitle = 'Сколько примерно будет гостей?';
        uiButtons = [
          { label: '👤 До 30 человек', val: 'мало' },
          { label: '👥 Больше 30 человек', val: 'много' }
        ];
      }
      else if (s === 'vedushchy') {
        uiTitle = 'Будет ли на мероприятии ведущий?';
        uiButtons = [
          { label: '✅ Есть ведущий', val: 'Да' },
          { label: '❌ Нет ведущего', val: 'Нет' }
        ];
      }
      else if (s === 'category') {
        uiTitle = 'Выберите формат шоу:';
        uiButtons = [
          { label: '🎭 Стандартная шоу-программа', val: 'Стандартная шоу-программа' },
          { label: '🎪 Индивидуальное шоу', val: 'Индивидуальное шоу' },
          { label: '🪄 Фокусы на встречу гостей / Фуршет', val: 'Микромагия' }
        ];
      }
      else if (s === 'indiv_sub') {
        uiTitle = '🎪 Индивидуальное шоу\nКакое у вас событие?';
        uiButtons = [
          { label: '🎓 Выпускной', val: 'Выпускной' },
          { label: '💍 Свадьба', val: 'Свадьба' },
          { label: '🏢 Корпоратив', val: 'Корпоратив' },
          { label: '🎂 Юбилей', val: 'Юбилей' }
        ];
      }
      else if (s === 'welcome_wishes') {
        uiTitle = '🪄 Микромагия / Фуршет\nЧто вы хотите видеть? Опишите в свободной форме:';
        uiInput = { placeholder: 'Пожелания к формату...' };
      }
      else if (s === 'duration') {
        if (qState.serviceType === 'Детское шоу') {
          uiTitle = '👶 Для детей\nВыберите длительность:';
          uiButtons = [{ label: '30 минут', val: '30 минут' }, { label: '40 минут', val: '40 минут' }, { label: 'Индивидуальное (шоу + МК)', val: 'Индивидуальное' }];
        } else if (qState.serviceType === 'Стандартная шоу-программа' || qState.serviceType === 'Индивидуальное шоу') {
          uiTitle = qState.serviceType + '\nВыберите длительность:';
          uiButtons = [{ label: '20 минут', val: '20 минут' }, { label: '30 минут', val: '30 минут' }, { label: '40 минут', val: '40 минут' }];
        } else if (qState.serviceType === 'Микромагия_мало') {
          uiTitle = '🪄 Микромагия (До 30 чел)\nФокусы на расстоянии вытянутой руки.\nВыберите длительность:';
          uiButtons = [{ label: '30 минут', val: '30 минут' }, { label: '1 час', val: '1 час' }];
        } else if (qState.serviceType === 'Микромагия_много') {
          uiTitle = '🪄 Микромагия (Фуршет)\nВыберите длительность:';
          uiButtons = [{ label: '30 минут', val: '30 минут' }, { label: '1 час', val: '1 час' }, { label: '2 часа', val: '2 часа' }, { label: '3 часа', val: '3 часа' }];
        }
      }

      drawQuizHTML();
    }

    function drawQuizHTML() {
      var html = '';
      var progress = 0;
      if (['start', 'month', 'day', 'time'].includes(qState.step)) progress = 33;
      if (['oblast', 'city'].includes(qState.step)) progress = 66;
      if (['audience', 'guests', 'vedushchy', 'category', 'indiv_sub', 'welcome_wishes', 'duration'].includes(qState.step)) progress = 95;

      html += '<div style="margin-bottom:24px;">'
        + '<div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;">'
        + '<div style="height:4px;background:#CBA135;border-radius:2px;width:' + progress + '%;transition:.3s;"></div>'
        + '</div></div>';

      var titleParts = uiTitle.split('\n');
      html += '<h3 style="font-family:var(--ff-head);color:#fff;font-size:20px;margin-bottom:8px;">' + titleParts[0] + '</h3>';
      if (titleParts[1]) html += '<p style="color:#aaa;font-size:15px;margin-bottom:20px;line-height:1.4;">' + titleParts[1] + '</p><br>';

      if (uiInput) {
        html += '<input id="qDynInput" type="text" placeholder="' + uiInput.placeholder + '" style="width:100%;background:#12121f;color:#eee;border:1px solid rgba(203,161,40,0.4);border-radius:10px;padding:14px 16px;font-size:16px;outline:none;box-sizing:border-box;margin-bottom:20px;" onkeydown="if(event.key===\'Enter\')handleDynInput()">';
        html += '<button onclick="handleDynInput()" class="btn btn--primary" style="width:100%;">Далее →</button>';
      }

      if (uiButtons.length > 0) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:10px;">';
        uiButtons.forEach(b => {
          var bg = b.color === 'primary' ? 'linear-gradient(135deg,var(--gold),var(--gold2))' : 'rgba(203,161,40,0.1)';
          var color = b.color === 'primary' ? '#111' : '#eee';
          var hoverBg = b.color === 'primary' ? bg : 'rgba(203,161,40,0.25)';
          var flex = ['day', 'month', 'duration', 'indiv_sub'].includes(qState.step) ? 'flex: 1 1 calc(33% - 10px); min-width:80px; text-align:center;' : 'width:100%; text-align:left;';
          if (qState.step === 'month' || qState.step === 'duration' || qState.step === 'indiv_sub') flex = 'flex: 1 1 calc(50% - 10px); min-width:120px; text-align:center;';
          if (qState.step === 'start') flex = 'width:100%; text-align:center;';

          html += '<button onclick="handleDynClick(\'' + String(b.val) + '\')" style="background:' + bg + ';border:1px solid rgba(203,161,40,0.35);color:' + color + ';border-radius:10px;padding:14px 16px;font-size:15px;font-weight:600;cursor:pointer;transition:.2s;' + flex + '" onmouseover="this.style.background=\'' + hoverBg + '\'" onmouseout="this.style.background=\'' + bg + '\'">' + b.label + '</button>';
        });
        html += '</div>';
      }

      var activeMagicPrize = getMagicPrize();
      if (qState.step === 'start' && activeMagicPrize) {
        html += '<div style="margin-top:14px;margin-bottom:16px;padding:12px 14px;border-radius:12px;background:rgba(143,210,160,0.08);border:1px solid rgba(143,210,160,0.25);color:#cfe8d4;font-size:14px;line-height:1.45;">🎁 Активный бонус из игры: <b style="color:#8fd2a0;">' + activeMagicPrize.userLabel + '</b></div>';
      }

      if (qState.history.length > 0) {
        html += '<button onclick="routeToMiniApp(\'' + VK_CONTACT_URL + '\')" style="margin-top:20px;width:100%;text-align:center;background:none;border:1px dashed rgba(255,255,255,0.2);color:#ccc;padding:12px;border-radius:8px;font-size:14px;cursor:pointer;transition:.2s;" onmouseover="this.style.borderColor=\'var(--gold)\';this.style.color=\'#fff\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,0.2)\';this.style.color=\'#ccc\'">💬 Написать лично</button>';
        html += '<div style="text-align:center;"><button onclick="popState()" style="margin-top:12px;background:none;border:none;color:#888;font-size:14px;cursor:pointer;padding:8px 0;">← Назад</button></div>';
      } else if (qState.step === 'start') {
        html += '<button onclick="routeToMiniApp(\'' + VK_CONTACT_URL + '\')" style="margin-top:20px;width:100%;text-align:center;background:none;border:1px dashed rgba(255,255,255,0.2);color:#ccc;padding:12px;border-radius:8px;font-size:14px;cursor:pointer;transition:.2s;" onmouseover="this.style.borderColor=\'var(--gold)\';this.style.color=\'#fff\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,0.2)\';this.style.color=\'#ccc\'">💬 Или написать лично</button>';
      }

      document.getElementById('quizContent').innerHTML = html;
      var inp = document.getElementById('qDynInput');
      if (inp) { inp.focus(); }
    }

    function handleDynClick(val) {
      if (qState.step === 'start') { pushState('month'); return; }
      if (qState.step === 'month') { qState.month = parseInt(val); pushState('day'); return; }
      if (qState.step === 'day') { qState.day = parseInt(val); pushState('time'); return; }
      if (qState.step === 'time') { qState.time = val; pushState('oblast'); return; }
      if (qState.step === 'oblast') { qState.oblast = val; pushState('city'); return; }
      if (qState.step === 'city') { qState.city = val; pushState('audience'); return; }

      if (qState.step === 'audience') {
        qState.audience = val;
        if (val === 'детское') { qState.serviceType = 'Детское шоу'; pushState('duration'); }
        else { pushState('guests'); }
        return;
      }
      if (qState.step === 'guests') {
        qState.guests = val;
        if (val === 'мало') { qState.serviceType = 'Микромагия_мало'; pushState('duration'); }
        else { pushState('vedushchy'); }
        return;
      }
      if (qState.step === 'vedushchy') { qState.vedushchy = val; pushState('category'); return; }
      if (qState.step === 'category') {
        qState.category = val;
        if (val === 'Индивидуальное шоу') { pushState('indiv_sub'); }
        else if (val === 'Микромагия') { qState.serviceType = 'Микромагия_много'; pushState('welcome_wishes'); }
        else { qState.serviceType = 'Стандартная шоу-программа'; pushState('duration'); }
        return;
      }
      if (qState.step === 'indiv_sub') {
        qState.indivEvent = val; qState.serviceType = 'Индивидуальное шоу'; pushState('duration'); return;
      }
      if (qState.step === 'duration') {
        qState.duration = val;
        finishDynQuiz();
        return;
      }
    }

    function handleDynInput() {
      var val = (document.getElementById('qDynInput') || {}).value || '';
      if (qState.step === 'time') { qState.time = val || 'Не указано'; pushState('oblast'); return; }
      if (qState.step === 'welcome_wishes') { qState.welcomeWishes = val || 'Нет'; pushState('duration'); return; }
    }

    function calcFinalPrice() {
      // Logic from vkbot.js calcPrice
      var mappedType = qState.serviceType;
      var mappedDur = qState.duration;
      if (mappedType === 'Микромагия_мало' || mappedType === 'Микромагия_много') mappedType = 'Микромагия';
      if (mappedType === 'Стандартная шоу-программа') mappedType = 'Взрослое шоу';
      if (mappedType === 'Индивидуальное шоу') mappedType = qState.indivEvent || 'Выпускной';

      var svcEntry = (getCfgServices()[mappedType] || {})[mappedDur];
      var serviceBase = typeof svcEntry === 'object' ? (svcEntry.price || 0) : (svcEntry || 0);
      if (!serviceBase) return null;

      var travelCost = getTravelCost(qState.oblast, qState.city);
      var mult = getHolidayMultiplier(qState.month, qState.day);
      var originalTotal = Math.round((serviceBase + travelCost) * mult);
      var magicPrize = getMagicPrize();
      var discountAmount = 0;
      if (magicPrize && magicPrize.type === 'discount' && magicPrize.percent > 0) {
        discountAmount = Math.round(originalTotal * (magicPrize.percent / 100));
      }
      var total = Math.max(originalTotal - discountAmount, 0);
      var depositPct = getCfgDeposit() / 100;
      var deposit = Math.round(total * depositPct);

      return {
        total: total,
        originalTotal: originalTotal,
        discountAmount: discountAmount,
        deposit: deposit,
        travel: travelCost,
        mult: mult,
        magicPrize: magicPrize
      };
    }

    function finishDynQuiz() {
      trackYandexGoal('quiz_completed', { app: 'site76' });
      var dateStr = qState.day + '.' + qState.month + ' / ' + qState.time;
      var locStr = qState.oblast + ', ' + qState.city;
      var typeStr = (qState.serviceType === 'Микромагия_мало' || qState.serviceType === 'Микромагия_много') ? 'Микромагия' : qState.serviceType;
      if (qState.indivEvent) typeStr += ' (' + qState.indivEvent + ')';

      var price = calcFinalPrice();
      var magicPrize = getMagicPrize();
      var guestsLabel = qState.guests ? (qState.guests === 'мало' ? 'До 30' : 'Больше 30') : '';
      var leadId = 'QZ-' + Date.now().toString().slice(-8);
      var priceText = price ? rub(price.total) : '';
      var depositText = price ? rub(price.deposit) : '';
      var holidayText = price && price.mult > 1 ? price.mult + 'x' : '';

      var msg = '🎩 Расчёт с сайта\n\n'
        + '📅 Дата: ' + dateStr + '\n📍 Город: ' + locStr + '\n'
        + '🎪 Формат: ' + typeStr + ' — ' + qState.duration + '\n';

      if (qState.guests) msg += '👥 Гости: ' + guestsLabel + '\n';
      if (qState.vedushchy) msg += '🎤 Ведущий: ' + qState.vedushchy + '\n';
      if (qState.welcomeWishes) msg += '✨ Пожелания: ' + qState.welcomeWishes + '\n';
      if (magicPrize) msg += '🎁 Бонус из игры: ' + magicPrize.userLabel + '\n';
      if (qState.serviceType === 'Детское шоу') msg += '\n📌 Каждый ребенок сверх 10 = +1 000 руб.\n';

      var html = '<div style="text-align:center;">';
      html += '<div style="font-size:48px;margin-bottom:10px;">✅</div>';

      if (price) {
        msg += '\n💰 Расчёт:\nИтого: ' + rub(price.total) + '\nПредоплата: ' + rub(price.deposit);
        html += '<h3 style="font-family:var(--ff-head);color:var(--gold);font-size:24px;margin-bottom:20px;">Ваш предварительный расчет</h3>';
        html += '<div style="background:rgba(255,255,255,0.03);border:1px dashed rgba(203,161,40,0.3);padding:16px;border-radius:12px;margin-bottom:24px;">';
        if (price.discountAmount > 0) {
          html += '<p style="color:#777;font-size:14px;margin-bottom:6px;text-decoration:line-through;">Без бонуса: ' + rub(price.originalTotal) + '</p>';
        }
        html += '<p style="color:#eee;font-size:16px;margin-bottom:8px;">Итоговая стоимость: <b style="color:var(--gold);font-size:20px;">' + rub(price.total) + '</b></p>';
        html += '<p style="color:#aaa;font-size:14px;">Размер предоплаты: ' + rub(price.deposit) + '</p>';
        if (price.magicPrize) {
          html += '<p style="color:#8fd2a0;font-size:13px;margin-top:8px;">Активирован бонус: ' + price.magicPrize.userLabel + '</p>';
        }
        if (price.mult > 1) html += '<p style="color:#e96;font-size:12px;margin-top:6px;">*Учтена праздничная наценка ' + price.mult + 'x</p>';
        html += '<p style="color:#88a;font-size:13px;margin-top:2px;">*Это сумма под ключ</p>';
        html += '</div>';
        html += '<p style="color:#ccc;font-size:14px;margin-bottom:24px;line-height:1.5;">Теперь вы можете сразу написать Дмитрию в личку ВКонтакте. Контекст квиза и бонус из игры автоматически отправятся в уведомление, чтобы разговор начался уже по делу.</p>';
        html += '<button onclick="handleQuizBookingChannel(\'vk\')" class="btn btn--primary" style="width:100%;margin-bottom:12px;font-size:17px;">Забронировать в VK</button>';
        html += '<button onclick="handleQuizBookingChannel(\'telegram\')" class="btn" style="width:100%;margin-bottom:12px;font-size:17px;">Написать лично в VK</button>';
      } else {
        html += '<h3 style="font-family:var(--ff-head);color:var(--gold);font-size:24px;margin-bottom:20px;">Заявка сформирована</h3>';
        html += '<p style="color:#ccc;font-size:14px;margin-bottom:24px;line-height:1.5;">К сожалению, точную стоимость рассчитать автоматически не удалось. Но контекст уже сохранён: Дмитрий увидит ответы квиза и сможет быстро дать точную стоимость в удобном вам канале.</p>';
        html += '<button onclick="handleQuizBookingChannel(\'vk\')" class="btn btn--primary" style="width:100%;margin-bottom:12px;font-size:17px;">Написать в VK</button>';
        html += '<button onclick="handleQuizBookingChannel(\'telegram\')" class="btn" style="width:100%;margin-bottom:12px;font-size:17px;">Написать лично в VK</button>';
      }

      html += '<div style="display:flex;justify-content:center;gap:20px;">';
      html += '<button onclick="popState()" style="background:none;border:none;color:#888;font-size:14px;cursor:pointer;">← Назад</button>';
      html += '<button onclick="closeQuiz()" style="background:none;border:none;color:#888;font-size:14px;cursor:pointer;">Закрыть</button>';
      html += '</div>';
      html += '</div>';

      qState.lastQuizResult = {
        leadId: leadId,
        date: dateStr,
        location: locStr,
        service: typeStr,
        duration: qState.duration,
        guestsLabel: guestsLabel,
        hostLabel: qState.vedushchy || '',
        wishes: qState.welcomeWishes || '',
        priceText: priceText,
        depositText: depositText,
        holidayText: holidayText,
        magicPrize: magicPrize,
        magicPrizeLabel: magicPrize ? magicPrize.userLabel : '',
        contactMessage: '',
        rawMessage: msg
      };
      qState.lastQuizResult.contactMessage = buildQuizContactMessage(qState.lastQuizResult);

      document.getElementById('quizContent').innerHTML = html;
      sendQuizLead(qState.lastQuizResult, { kind: 'quiz_completed', note: 'Клиент завершил квиз и увидел итоговый экран.' });
    }

    function openQuiz() {
      qState = {
        step: 'start',
        month: 0,
        day: 0,
        time: '',
        oblast: '',
        city: '',
        audience: '',
        guests: '',
        vedushchy: '',
        category: '',
        indivEvent: '',
        welcomeWishes: '',
        serviceType: '',
        duration: '',
        history: [],
        lastQuizResult: null,
        sentLeadEvents: {}
      };
      document.getElementById('quizOverlay').style.display = 'block';
      document.body.style.overflow = 'hidden';
      renderActiveStep();
    }
    function closeQuiz() {
      document.getElementById('quizOverlay').style.display = 'none';
      document.body.style.overflow = '';
    }

    function quizSendToVK(msg) {
      closeQuiz();
      routeToMiniApp(buildVkPersonalChatUrl(msg));
    }
    function routeToBotForPrivate() { openAssistant(); }

    // ===== AI ASSISTANT =====
    var assistantMessages = []; // history { role, content }
    var assistantBusy = false;

    function openAssistant() {
      var ov = document.getElementById('assistantOverlay');
      ov.style.display = 'block';

      // Первое приветствие — два сообщения с эффектом "печатает"
      if (assistantMessages.length === 0) {
        var greeting1 = 'Здравствуйте! Меня зовут Екатерина 🤝';
        var greeting2 = 'Я менеджер Дмитрия Костюка. Расскажите про ваше мероприятие — посчитаю точную стоимость.';

        // показываем "печатает" сразу
        addAssistantTyping();

        setTimeout(function () {
          removeAssistantTyping();
          assistantMessages.push({ role: 'assistant', content: greeting1 });
          streamAssistantReply(greeting1).then(function () {
            // короткая пауза → опять "печатает" → второе сообщение
            setTimeout(function () {
              addAssistantTyping();
              setTimeout(function () {
                removeAssistantTyping();
                assistantMessages.push({ role: 'assistant', content: greeting2 });
                streamAssistantReply(greeting2);
              }, 900);
            }, 350);
          });
        }, 700);
      }

      setTimeout(function () {
        var input = document.getElementById('assistantInput');
        if (input) input.focus();
      }, 150);
    }

    function closeAssistant() {
      document.getElementById('assistantOverlay').style.display = 'none';
    }

    function addAssistantBubble(role, text) {
      var box = document.getElementById('assistantMessages');
      if (!box) return;
      var bubble = document.createElement('div');
      var isUser = role === 'user';
      bubble.style.cssText = [
        'max-width: 85%',
        'padding: 10px 14px',
        'border-radius: 16px',
        'font-size: 14px',
        'line-height: 1.45',
        'white-space: pre-wrap',
        'word-wrap: break-word',
        isUser
          ? 'align-self: flex-end; background: rgba(203,161,40,0.18); color: #fff; border: 1px solid rgba(203,161,40,0.25)'
          : 'align-self: flex-start; background: rgba(255,255,255,0.05); color: #eee; border: 1px solid rgba(255,255,255,0.06)'
      ].join(';');
      bubble.textContent = text;
      box.appendChild(bubble);
      box.scrollTop = box.scrollHeight;
      return bubble;
    }

    function addAssistantTyping() {
      var box = document.getElementById('assistantMessages');
      if (!box) return null;
      var b = document.createElement('div');
      b.id = 'assistantTyping';
      b.style.cssText = 'align-self:flex-start;padding:10px 14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.06);border-radius:16px;display:flex;align-items:center;gap:4px;';
      b.innerHTML =
        '<span class="td"></span><span class="td"></span><span class="td"></span>';
      box.appendChild(b);
      box.scrollTop = box.scrollHeight;
      return b;
    }
    function removeAssistantTyping() {
      var t = document.getElementById('assistantTyping');
      if (t) t.remove();
    }

    // Постепенный вывод текста как живой набор
    function streamAssistantReply(fullText) {
      return new Promise(function (resolve) {
        var box = document.getElementById('assistantMessages');
        if (!box) { resolve(); return; }
        var bubble = document.createElement('div');
        bubble.style.cssText = [
          'max-width: 85%',
          'padding: 10px 14px',
          'border-radius: 16px',
          'font-size: 14px',
          'line-height: 1.45',
          'white-space: pre-wrap',
          'word-wrap: break-word',
          'align-self: flex-start',
          'background: rgba(255,255,255,0.05)',
          'color: #eee',
          'border: 1px solid rgba(255,255,255,0.06)'
        ].join(';');
        box.appendChild(bubble);

        // Бьём текст на слова, чтобы шёл естественный набор
        var words = fullText.split(/(\s+)/); // сохраняем пробелы между словами
        var i = 0;
        var current = '';

        function step() {
          if (i >= words.length) { resolve(); return; }
          current += words[i];
          bubble.textContent = current;
          box.scrollTop = box.scrollHeight;
          i++;
          // 35-90мс на слово + случайная микро-пауза для оживления
          var word = words[i - 1] || '';
          var delay = 35 + Math.random() * 55;
          if (word.length > 6) delay += 30;
          // Иногда лёгкая «задумчивая» пауза после точки/запятой
          if (/[.!?]$/.test(word.trim())) delay += 250;
          else if (/[,;:]$/.test(word.trim())) delay += 120;
          setTimeout(step, delay);
        }
        step();
      });
    }

    function sendAssistantMessage(e) {
      if (e) e.preventDefault();
      if (assistantBusy) return false;
      var input = document.getElementById('assistantInput');
      var sendBtn = document.getElementById('assistantSend');
      var text = (input.value || '').trim();
      if (!text) return false;

      addAssistantBubble('user', text);
      assistantMessages.push({ role: 'user', content: text });
      input.value = '';
      assistantBusy = true;
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.5';
      addAssistantTyping();

      // контекст текущего шага квиза
      var quizContext = {};
      try {
        if (typeof qState !== 'undefined' && qState) {
          quizContext.step = qState.step || '';
          quizContext.selected = {
            month: qState.month, day: qState.day, time: qState.time,
            oblast: qState.oblast, city: qState.city,
            category: qState.category, duration: qState.duration,
            guests: qState.guests
          };
        }
      } catch (_) { }

      // Засекаем время запроса для минимальной задержки «человечности»
      var startTime = Date.now();
      var MIN_THINK = 900 + Math.random() * 600; // 0.9-1.5s — будто менеджер читает

      // sessionId — стабильный ID этого посетителя в localStorage
      var sessionId = '';
      try {
        sessionId = localStorage.getItem('ekat_sid') || '';
        if (!sessionId) {
          sessionId = 'sid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
          localStorage.setItem('ekat_sid', sessionId);
        }
      } catch (_) { }

      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: assistantMessages, quizContext: quizContext, sessionId: sessionId })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          // Гарантируем минимальную задержку перед стартом печати
          var elapsed = Date.now() - startTime;
          var wait = Math.max(0, MIN_THINK - elapsed);
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(data); }, wait);
          });
        })
        .then(function (data) {
          removeAssistantTyping();
          if (data && data.ok && data.reply) {
            assistantMessages.push({ role: 'assistant', content: data.reply });
            return streamAssistantReply(data.reply);
          } else {
            addAssistantBubble('assistant', 'Извините, не удалось получить ответ. Попробуйте позже.');
          }
        })
        .catch(function () {
          removeAssistantTyping();
          addAssistantBubble('assistant', 'Извините, я временно недоступен. Попробуйте чуть позже.');
        })
        .finally(function () {
          assistantBusy = false;
          sendBtn.disabled = false;
          sendBtn.style.opacity = '1';
          if (input) input.focus();
        });

      return false;
    }

    // Lightbox Logic
    function openLightbox(el) {
      var lb = document.getElementById('lightbox');
      var lbImg = document.getElementById('lbImg');
      if (!lb || !lbImg || !el) return;
      var imgPath;
      if (el.tagName === 'IMG') {
        imgPath = el.src;
      } else if (el.tagName === 'DIV' && el.classList.contains('swiper-slide')) {
        imgPath = el.querySelector('img').src;
      }
      if (imgPath) {
        lbImg.src = imgPath;
        lb.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    }

    function closeLightbox() {
      var lb = document.getElementById('lightbox');
      var lbImg = document.getElementById('lbImg');
      if (!lb || !lbImg) return;
      lb.classList.remove('active');
      document.body.style.overflow = '';
      lbImg.src = '';
    }

    function initBrandsMarquee() {
      var track = document.getElementById('brandsTrack');
      if (!track) return;
      var sets = track.querySelectorAll('.brand-set');
      if (!sets.length) return;

      var firstSet = sets[0];
      var recalc = function () {
        var shift = Math.round(firstSet.getBoundingClientRect().width || 0);
        if (!shift) return;
        track.style.setProperty('--brands-shift', shift + 'px');
        var duration = Math.max(14, shift / 65);
        track.style.setProperty('--brands-duration', duration.toFixed(2) + 's');
      };

      recalc();
      window.addEventListener('resize', recalc, { passive: true });
      track.querySelectorAll('img').forEach(function (img) {
        if (!img.complete) {
          img.addEventListener('load', recalc, { once: true });
          img.addEventListener('error', recalc, { once: true });
        }
      });
    }

    // Initialize Gallery Swiper
    document.addEventListener("DOMContentLoaded", function () {
      initBrandsMarquee();
      new Swiper('.swiper-gallery', {
        effect: 'coverflow',
        grabCursor: true,
        centeredSlides: true,
        slidesPerView: 'auto',
        coverflowEffect: {
          rotate: 40,
          stretch: 0,
          depth: 250,
          modifier: 1,
          slideShadows: true,
        },
        loop: true,
        autoplay: {
          delay: 3000,
          disableOnInteraction: false,
        },
        pagination: {
          el: '.swiper-pagination',
        },
      });
    });