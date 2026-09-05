/* Реле оплаты под белыми списками.
   Страницы шоу (родной код сайта) шлют запросы на /api/... — под белыми
   списками kostyukproject.ru недоступен. Перехватываем fetch и перенаправляем
   ВСЕ /api/-запросы на Yandex API Gateway (домен *.apigw.yandexcloud.net в
   белом списке), который пересылает их на боевой сервер. База, промокоды,
   T-Pay, синхрон с сайтом и админкой — те же, потому что сервер тот же.
   Сервер и его логику не меняем; переписывается только адрес назначения. */
(function () {
  var RELAY = 'https://d5d4j3knrg94nv4d4ov5.nm0huug4.apigw.yandexcloud.net';
  if (!window.fetch || window.__kpApiRelayInstalled) return;
  window.__kpApiRelayInstalled = true;
  var origFetch = window.fetch.bind(window);

  function rewrite(url) {
    try {
      if (typeof url !== 'string') return url;
      // Абсолютный /api/... -> на реле
      if (url.indexOf('/api/') === 0) return RELAY + url;
      // Полный URL на наш домен -> на реле (на случай абсолютных ссылок)
      if (url.indexOf('https://kostyukproject.ru/api/') === 0) {
        return RELAY + url.slice('https://kostyukproject.ru'.length);
      }
      if (url.indexOf('https://www.kostyukproject.ru/api/') === 0) {
        return RELAY + url.slice('https://www.kostyukproject.ru'.length);
      }
      return url;
    } catch (e) { return url; }
  }

  window.fetch = function (input, init) {
    if (typeof input === 'string') {
      return origFetch(rewrite(input), init);
    }
    // Request-объект: пересобираем с переписанным URL
    if (input && typeof input === 'object' && typeof input.url === 'string') {
      var newUrl = rewrite(input.url);
      if (newUrl !== input.url) {
        return origFetch(new Request(newUrl, input), init);
      }
    }
    return origFetch(input, init);
  };
})();
