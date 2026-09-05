/* track.js — лёгкий сбор аналитики (воронка + источник). Всё через /api/track.
   Не собирает персональные данные. Не ломает страницу при ошибке. */
(function () {
  'use strict';

  // sessionId на весь визит (sessionStorage — очищается при закрытии вкладки).
  function getSessionId() {
    try {
      var k = 'k_sid';
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
  }

  // Источник трафика: utm_source > реферер-домен > поддомен > direct.
  function getSource() {
    try {
      var p = new URLSearchParams(location.search);
      var utm = p.get('utm_source') || p.get('utm') || p.get('from');
      if (utm) return String(utm).slice(0, 60);
      if (document.referrer) {
        var host = new URL(document.referrer).hostname;
        if (host && host !== location.hostname) return host.slice(0, 60);
      }
      // поддомен (show./event./school.) — если открыли прямой вход
      var sub = location.hostname.split('.')[0];
      if (['show', 'event', 'school'].indexOf(sub) !== -1) return sub;
      return 'direct';
    } catch (e) {
      return 'direct';
    }
  }

  var SID = getSessionId();
  var SRC = getSource();
  var PROMO = '';
  try {
    var promoParams = new URLSearchParams(location.search);
    PROMO = String(promoParams.get('promo') || promoParams.get('promocode') || promoParams.get('promoCode') || '')
      .trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
  } catch (e) { PROMO = ''; }
  var sent = {}; // не шлём один и тот же шаг повторно в рамках визита

  function step(show, stepName) {
    if (!show || !stepName) return;
    var key = show + ':' + stepName;
    if (sent[key]) return;
    sent[key] = true;
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show: show, step: stepName, sessionId: SID, source: SRC, promoCode: PROMO }),
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* тихо */ }
  }

  window.KTrack = { step: step, sessionId: SID, source: SRC };

  // Рекламная ссылка сразу подставляет промокод в форму покупки.
  if (PROMO) window.addEventListener('DOMContentLoaded', function () {
    var input = document.getElementById('promoCodeInput');
    if (!input) return;
    input.value = PROMO;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
})();
