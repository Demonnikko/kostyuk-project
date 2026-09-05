/* Запрет зума в мини-аппе. iOS Safari игнорирует user-scalable=no в meta,
   поэтому глушим жесты масштабирования вручную:
   - gesturestart/gesturechange/gestureend — пинч-зум двумя пальцами;
   - двойной тап (double-tap to zoom);
   - Ctrl/Cmd + колесо (на случай десктопного вебвью).
   Обычный скролл и тапы по элементам не трогаем. */
(function () {
  // Пинч-зум (iOS Safari gesture events)
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
  });

  // Двойной тап -> зум: гасим второй быстрый тап
  var lastTouch = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    if (now - lastTouch <= 300) { e.preventDefault(); }
    lastTouch = now;
  }, { passive: false });

  // Ctrl/Cmd + wheel (десктопный вебвью)
  document.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  }, { passive: false });
})();
