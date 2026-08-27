/* KOSTYUK PROJECT — интерактивные анимации 8 уровней квеста «Спасти Матвея».
   Кнопка «Нажми меня» на каждом уровне открывает полноэкранный overlay
   с короткой анимацией. Тап/клик по фону закрывает. Всё на одном canvas,
   requestAnimationFrame, автоочистка — чтобы не грузить страницу. */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- overlay ----
  var fx = document.createElement('div');
  fx.className = 'quest-fx';
  fx.innerHTML =
    '<canvas class="quest-fx__canvas"></canvas>' +
    '<div class="quest-fx__label"></div>' +
    '<div class="quest-fx__hint"></div>';
  document.body.appendChild(fx);

  var canvas = fx.querySelector('.quest-fx__canvas');
  var labelEl = fx.querySelector('.quest-fx__label');
  var hintEl = fx.querySelector('.quest-fx__hint');
  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, raf = null, running = null, autoTimer = null;

  // Сколько играет каждая сцена и сама закрывается (мс).
  var DURATION = {
    scale: 3000, silence: 2600, card: 8000, mindheart: 3200,
    feeling: 3400, cube: 3600, snow: 4200, fireworks: 4200
  };

  function size() {
    W = fx.clientWidth; H = fx.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    if (autoTimer) clearTimeout(autoTimer);
    raf = null; running = null; autoTimer = null;
    ctx.clearRect(0, 0, W, H);
    canvas.onclick = null;
  }

  function close() {
    stop();
    fx.classList.remove('is-open');
    labelEl.textContent = '';
    hintEl.style.display = '';
  }

  function open(kind) {
    fx.classList.add('is-open');
    size();
    labelEl.textContent = '';
    hintEl.style.display = '';
    (SCENES[kind] || function () {})();
    // Анимация проигрывается и сама исчезает.
    var dur = DURATION[kind] || 3200;
    autoTimer = setTimeout(close, dur);
  }

  // фон закрывает; клик по canvas обрабатывают сцены, которым это нужно
  fx.addEventListener('click', function (e) {
    if (e.target === fx || e.target === labelEl) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', function () { if (fx.classList.contains('is-open')) size(); });

  function rand(a, b) { return a + Math.random() * (b - a); }
  function loop(fn) { fn(); raf = requestAnimationFrame(function () { loop(fn); }); }

  // ================= СЦЕНЫ =================
  var SCENES = {

    // 01 — Запуск шкалы: шкала настроений заполняется грусть→радость
    scale: function () {
      labelEl.textContent = 'Запуск шкалы';
      var faces = ['😖', '☹️', '😐', '🙂', '😄', '🤩'];
      var t0 = performance.now();
      loop(function () {
        var p = Math.min(1, (performance.now() - t0) / 2200); // заполнение за 2.2с
        ctx.clearRect(0, 0, W, H);
        var barW = Math.min(W * 0.8, 620), barH = 26, x = (W - barW) / 2, y = H * 0.62;
        // фон шкалы
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        roundRect(x, y, barW, barH, 13); ctx.fill();
        // заполнение градиентом
        var g = ctx.createLinearGradient(x, 0, x + barW, 0);
        g.addColorStop(0, '#e0483c'); g.addColorStop(0.5, '#f4c430'); g.addColorStop(1, '#3dbf6e');
        ctx.fillStyle = g;
        roundRect(x, y, barW * p, barH, 13); ctx.fill();
        // бегунок-смайлик
        var fi = Math.min(faces.length - 1, Math.floor(p * faces.length));
        ctx.font = '46px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(faces[fi], x + barW * p, y - 44);
      });
    },

    // 02 — Тишина: смайлики «тсс» появляются по всему экрану
    silence: function () {
      labelEl.textContent = 'Тихо…';
      var items = [];
      for (var i = 0; i < 16; i++) {
        items.push({ x: rand(0.08, 0.92) * W, y: rand(0.12, 0.9) * H, s: 0, d: i * 90, size: rand(40, 84) });
      }
      var t0 = performance.now();
      loop(function () {
        var now = performance.now() - t0;
        ctx.clearRect(0, 0, W, H);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (var k = 0; k < items.length; k++) {
          var it = items[k];
          var e = Math.max(0, Math.min(1, (now - it.d) / 500));
          var s = e < 0.6 ? e / 0.6 : 1 - (e - 0.6) / 0.4 * 0.15; // всплеск и лёгкая усадка
          if (s <= 0) continue;
          ctx.font = (it.size * s) + 'px serif';
          ctx.fillText('🤫', it.x, it.y);
        }
      });
    },

    // 03 — Карта на скорость: карта летает, поймай тапом
    card: function () {
      labelEl.textContent = '';
      hintEl.textContent = 'Поймай карту — тапни по ней';
      var c = { x: rand(0.2, 0.8) * W, y: rand(0.2, 0.8) * H, vx: rand(-6, 6) || 4, vy: rand(-6, 6) || 4, w: 88, h: 124, caught: false, rot: 0 };
      if (Math.abs(c.vx) < 3) c.vx = 4; if (Math.abs(c.vy) < 3) c.vy = 4;
      var t0 = performance.now();
      canvas.onclick = function (e) {
        var r = canvas.getBoundingClientRect();
        var mx = e.clientX - r.left, my = e.clientY - r.top;
        if (!c.caught && Math.abs(mx - c.x) < c.w && Math.abs(my - c.y) < c.h) {
          c.caught = true; labelEl.textContent = 'Поймал! 🎉';
          setTimeout(close, 900);
        }
      };
      loop(function () {
        ctx.clearRect(0, 0, W, H);
        if (!c.caught) {
          c.x += c.vx; c.y += c.vy; c.rot += 0.04;
          if (c.x < c.w / 2 || c.x > W - c.w / 2) c.vx *= -1;
          if (c.y < c.h / 2 || c.y > H - c.h / 2) c.vy *= -1;
        }
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(Math.sin(c.rot) * 0.25);
        // рубашка карты (оранжевая) + масть
        ctx.fillStyle = c.caught ? '#3dbf6e' : '#ff7a1a';
        roundRect(-c.w / 2, -c.h / 2, c.w, c.h, 12); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        roundRect(-c.w / 2 + 6, -c.h / 2 + 6, c.w - 12, c.h - 12, 8); ctx.fill();
        ctx.fillStyle = '#111'; ctx.font = '54px Georgia, serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(c.caught ? '★' : '♠', 0, 0);
        ctx.restore();
      });
    },

    // 04 — Разум и сердце: пульс сердца ↔ вращение шестерёнок
    mindheart: function () {
      labelEl.textContent = 'Разум и сердце';
      var t0 = performance.now();
      loop(function () {
        var t = (performance.now() - t0) / 1000;
        ctx.clearRect(0, 0, W, H);
        var cx = W / 2, cy = H * 0.5, R = Math.min(W, H) * 0.16;
        // шестерёнка слева (разум)
        drawGear(cx - R * 1.7, cy, R * 0.9, t * 1.2, 'rgba(184,144,255,0.9)');
        drawGear(cx - R * 1.7 + R * 0.9, cy - R * 0.7, R * 0.5, -t * 1.6, 'rgba(140,80,240,0.8)');
        // сердце справа (пульс)
        var beat = 1 + Math.sin(t * 4) * 0.12;
        ctx.save(); ctx.translate(cx + R * 1.4, cy); ctx.scale(beat, beat);
        drawHeart(0, 0, R, '#ff5a7a'); ctx.restore();
        // соединяющая искра
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.3 + Math.sin(t * 4) * 0.25) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx - R * 0.5, cy); ctx.lineTo(cx + R * 0.6, cy); ctx.stroke();
      });
    },

    // 05 — Чувство: волна сердечек поднимается вверх
    feeling: function () {
      labelEl.textContent = 'Чувство';
      var hearts = [];
      function spawn() {
        hearts.push({ x: rand(0.1, 0.9) * W, y: H + 40, vy: rand(1.6, 3.4), size: rand(22, 52), sway: rand(0, 6.28), alpha: rand(0.5, 1) });
      }
      var t0 = performance.now(), last = 0;
      loop(function () {
        var now = performance.now();
        if (now - last > 140) { spawn(); last = now; }
        ctx.clearRect(0, 0, W, H);
        for (var i = hearts.length - 1; i >= 0; i--) {
          var h = hearts[i];
          h.y -= h.vy; h.sway += 0.05;
          var x = h.x + Math.sin(h.sway) * 22;
          ctx.globalAlpha = h.alpha * Math.max(0, Math.min(1, h.y / H));
          drawHeart(x, h.y, h.size, '#ff6fa3');
          if (h.y < -60) hearts.splice(i, 1);
        }
        ctx.globalAlpha = 1;
      });
    },

    // 06 — Предсказание: большой кубик Рубика крутится и «перемешивается»
    cube: function () {
      labelEl.textContent = 'Предсказание';
      var cols = ['#e0483c', '#3dbf6e', '#4a8fd9', '#f4c430', '#ff8a3d', '#f5f0e5'];
      var grid = [];
      for (var i = 0; i < 9; i++) grid.push(cols[(Math.random() * cols.length) | 0]);
      var t0 = performance.now(), lastShuffle = 0;
      loop(function () {
        var t = (performance.now() - t0) / 1000;
        if (performance.now() - lastShuffle > 320) { // перемешивание граней
          grid[(Math.random() * 9) | 0] = cols[(Math.random() * cols.length) | 0];
          lastShuffle = performance.now();
        }
        ctx.clearRect(0, 0, W, H);
        var cx = W / 2, cy = H / 2;
        var side = Math.min(W, H) * 0.42;
        var wob = Math.sin(t * 1.5) * 0.18;      // покачивание как 3D-вращение
        var sx = Math.cos(t) * 0.5 + 0.6;         // «дыхание» ширины
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(wob);
        var cell = side / 3, ox = -side / 2, oy = -side / 2;
        for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
          ctx.save();
          ctx.translate(ox + c * cell + cell / 2, oy + r * cell + cell / 2);
          ctx.scale(sx, 1);
          ctx.fillStyle = grid[r * 3 + c];
          roundRect(-cell / 2 + 4, -cell / 2 + 4, cell - 8, cell - 8, 8); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      });
    },

    // 07 — Снежный шторм: метель на весь экран
    snow: function () {
      labelEl.textContent = 'Снежный шторм';
      var flakes = [];
      var N = Math.round(Math.min(220, (W * H) / 6000));
      for (var i = 0; i < N; i++) flakes.push({ x: rand(0, W), y: rand(0, H), r: rand(1.5, 5), vy: rand(1.5, 5), vx: rand(-1.2, 1.2), sway: rand(0, 6.28) });
      var wind = 0, t0 = performance.now();
      loop(function () {
        var t = (performance.now() - t0) / 1000;
        wind = Math.sin(t * 0.7) * 2.5;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (var i = 0; i < flakes.length; i++) {
          var f = flakes[i];
          f.sway += 0.03;
          f.y += f.vy; f.x += f.vx + wind + Math.sin(f.sway) * 0.8;
          if (f.y > H) { f.y = -8; f.x = rand(0, W); }
          if (f.x > W + 8) f.x = -8; if (f.x < -8) f.x = W + 8;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.2832); ctx.fill();
        }
      });
    },

    // 08 — Триумф мастера: фейерверк-салют
    fireworks: function () {
      labelEl.textContent = 'Триумф мастера!';
      var parts = [], lastBurst = 0;
      var palette = ['#ffd54a', '#ff6fa3', '#8c50f0', '#3dbf6e', '#4a8fd9', '#ff8a3d'];
      function burst() {
        var bx = rand(0.2, 0.8) * W, by = rand(0.2, 0.55) * H;
        var col = palette[(Math.random() * palette.length) | 0];
        var n = 34;
        for (var i = 0; i < n; i++) {
          var a = (Math.PI * 2 * i) / n, sp = rand(2.5, 6);
          parts.push({ x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col: col, size: rand(2, 4) });
        }
      }
      loop(function () {
        if (performance.now() - lastBurst > 550) { burst(); lastBurst = performance.now(); }
        ctx.clearRect(0, 0, W, H);
        for (var i = parts.length - 1; i >= 0; i--) {
          var p = parts[i];
          p.vy += 0.06; p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.life -= 0.012;
          if (p.life <= 0) { parts.splice(i, 1); continue; }
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.col;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.2832); ctx.fill();
        }
        ctx.globalAlpha = 1;
      });
    }
  };

  // ---- helpers ----
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawHeart(x, y, s, color) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s / 100, s / 100);
    ctx.beginPath();
    ctx.moveTo(0, 30);
    ctx.bezierCurveTo(-50, -20, -35, -60, 0, -30);
    ctx.bezierCurveTo(35, -60, 50, -20, 0, 30);
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
  }
  function drawGear(cx, cy, r, rot, color) {
    var teeth = 8;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
    ctx.beginPath();
    for (var i = 0; i < teeth * 2; i++) {
      var rr = (i % 2 === 0) ? r : r * 0.78;
      var a = (Math.PI / teeth) * i;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, 6.2832);
    ctx.fillStyle = 'rgba(6,3,18,0.9)'; ctx.fill();
    ctx.restore();
  }

  // ---- привязка кнопок ----
  document.querySelectorAll('.level__play').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var kind = btn.getAttribute('data-quest');
      if (reduce) { // без анимаций — просто подпись
        fx.classList.add('is-open');
        labelEl.textContent = btn.closest('.level').querySelector('.level__title').textContent;
        return;
      }
      open(kind);
    });
  });
})();
