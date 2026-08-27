/* show-nav.js — поведение плавающей кнопки «К афише» на страницах шоу.
   Прячем при скролле вниз (не мешает читать), показываем при скролле вверх.
   Общий файл для secret / huligan / matvey. */
(function () {
  'use strict';

  var btn = document.querySelector('.show-back-to-afisha');
  if (!btn) return;

  var lastY = window.pageYOffset || 0;   // позиция скролла на прошлом кадре
  var ticking = false;                    // защита от лишних пересчётов за кадр

  // TODO(логика решения): по текущей и прошлой позиции скролла решить,
  // прятать кнопку или показывать. Ниже — точка, где ты задаёшь поведение.
  //
  // Параметры:
  //   currentY — текущая позиция скролла (px от верха)
  //   lastY    — позиция на прошлом кадре
  // Возвращает: true = спрятать кнопку, false = показать.
  //
  // Что стоит учесть (твой выбор формирует ощущение):
  //   • Порог у самого верха: пока страница почти не прокручена (например
  //     currentY < 80), кнопку логично всегда показывать — пользователь ещё
  //     «в шапке» и хочет видеть выход назад.
  //   • Мёртвая зона: реагировать не на каждый пиксель, а на заметное движение
  //     (например разница > 6px), иначе кнопка дёргается от микро-скролла
  //     и тряски тачпада/пальца.
  //   • Направление: вниз (currentY > lastY) — прятать, вверх — показывать.
  function shouldHide(currentY, lastY) {
    if (currentY < 80) return false;                 // у верха страницы — всегда видна
    if (Math.abs(currentY - lastY) < 6) {            // мёртвая зона: микро-движение игнорируем
      return btn.classList.contains('is-hidden');    // оставляем как было
    }
    return currentY > lastY;                          // вниз — прячем, вверх — показываем
  }

  function onScroll() {
    var currentY = window.pageYOffset || 0;
    btn.classList.toggle('is-hidden', shouldHide(currentY, lastY));
    lastY = currentY;
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(onScroll);
      ticking = true;
    }
  }, { passive: true });
})();
