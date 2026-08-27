/* KOSTYUK PROJECT — «живой» тематический фон страниц шоу.
   Лёгкая canvas-анимация: элементы плавно дрейфуют, мягко отталкиваются
   друг от друга и отскакивают от краёв (как заставка DVD/ВЧС).
   Тип элементов берётся из класса <body>: secret → «?», huligan → карты, matvey → звёзды. */
(function () {
  'use strict';

  // Уважаем настройку «уменьшить движение» — не грузим и не мигаем.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var body = document.body;
  var THEME =
    body.classList.contains('show-page--secret')  ? 'secret'  :
    body.classList.contains('show-page--huligan') ? 'huligan' :
    body.classList.contains('show-page--matvey')  ? 'matvey'  : null;
  if (!THEME) return;

  var canvas = document.createElement('canvas');
  canvas.className = 'show-ambient';
  canvas.setAttribute('aria-hidden', 'true');
  // Фиксируем на весь экран, позади всего контента, клики сквозь него.
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;';
  // Вставляем первым в body, чтобы был позади (контент имеет z-index:2).
  body.insertBefore(canvas, body.firstChild);

  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2); // не раздуваем на retina
  var W = 0, H = 0;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // Количество зависит от площади — на телефоне меньше, чтобы не грузить.
  var COUNT = Math.max(9, Math.min(16, Math.round((W * H) / 90000)));

  // Масти для Хулигана: рубашка оранжевая, номинал/масть чёрные.
  var SUITS = ['♠', '♥', '♦', '♣']; // ♠ ♥ ♦ ♣

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeParticle() {
    var size = rand(26, 46);
    return {
      x: rand(size, W - size),
      y: rand(size, H - size),
      vx: rand(-0.25, 0.25),
      vy: rand(-0.25, 0.25),
      size: size,
      rot: rand(-0.35, 0.35),
      vr: rand(-0.0025, 0.0025),
      alpha: rand(0.05, 0.12),          // еле заметные
      suit: SUITS[(Math.random() * 4) | 0]
    };
  }

  var parts = [];
  for (var i = 0; i < COUNT; i++) parts.push(makeParticle());

  function drawQuestion(p) {
    ctx.font = '700 ' + p.size + 'px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(240, 217, 139,' + p.alpha + ')'; // золото
    ctx.fillText('?', 0, 0);
  }

  function drawStar(p) {
    var r = p.size * 0.5, ir = r * 0.42, spikes = 5;
    ctx.beginPath();
    for (var k = 0; k < spikes * 2; k++) {
      var rad = (k % 2 === 0) ? r : ir;
      var a = (Math.PI / spikes) * k - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(200, 180, 255,' + p.alpha + ')'; // мягкий сиреневый
    ctx.fill();
  }

  function drawCard(p) {
    var w = p.size * 0.72, h = p.size, r = p.size * 0.12;
    // рубашка — оранжевая
    roundRect(-w / 2, -h / 2, w, h, r);
    ctx.fillStyle = 'rgba(255, 120, 20,' + (p.alpha + 0.02) + ')';
    ctx.fill();
    // масть/номинал — чёрные, по центру
    ctx.font = '700 ' + (p.size * 0.5) + 'px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0,' + Math.min(1, p.alpha + 0.25) + ')';
    ctx.fillText(p.suit, 0, 0);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var drawShape =
    THEME === 'secret'  ? drawQuestion :
    THEME === 'huligan' ? drawCard :
                          drawStar;

  var MAX_SPEED = 0.5;

  function step() {
    // Мягкое расталкивание: если две частицы близко — плавно расходятся.
    for (var i = 0; i < parts.length; i++) {
      var a = parts[i];
      for (var j = i + 1; j < parts.length; j++) {
        var b = parts[j];
        var dx = b.x - a.x, dy = b.y - a.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        var minDist = (a.size + b.size) * 0.55;
        if (dist < minDist) {
          var push = (minDist - dist) / minDist * 0.06; // слабый импульс → плавно
          var nx = dx / dist, ny = dy / dist;
          a.vx -= nx * push; a.vy -= ny * push;
          b.vx += nx * push; b.vy += ny * push;
        }
      }
    }

    ctx.clearRect(0, 0, W, H);
    for (var k = 0; k < parts.length; k++) {
      var p = parts[k];
      // ограничиваем скорость, чтобы не разгонялись после толчков
      var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (sp > MAX_SPEED) { p.vx = p.vx / sp * MAX_SPEED; p.vy = p.vy / sp * MAX_SPEED; }

      p.x += p.vx; p.y += p.vy; p.rot += p.vr;

      // отскок от краёв, как заставка DVD
      var m = p.size;
      if (p.x < m)      { p.x = m;     p.vx = Math.abs(p.vx); }
      if (p.x > W - m)  { p.x = W - m; p.vx = -Math.abs(p.vx); }
      if (p.y < m)      { p.y = m;     p.vy = Math.abs(p.vy); }
      if (p.y > H - m)  { p.y = H - m; p.vy = -Math.abs(p.vy); }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      drawShape(p);
      ctx.restore();
    }
  }

  var raf = null;
  function loop() { step(); raf = requestAnimationFrame(loop); }

  // Пауза, когда вкладка скрыта — не тратим батарею/CPU.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
    else if (!raf) loop();
  });

  loop();
})();
