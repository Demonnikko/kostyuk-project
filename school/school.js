// School Page JS Logic

// Stargate Portal JS Navigation
    function kpGoToShow(e) {
      if (e) e.preventDefault();
      var url = '/events/';
      var portal = document.getElementById('kostyukPortal');
      if (portal) {
        portal.classList.add('active');
        setTimeout(function(){ window.location.href = url; }, 1750);
      } else {
        window.location.href = url;
      }
      return false;
    }
    function kpGoToConcerts(e) {
      if (e) e.preventDefault();
      var url = '/concerts/';
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

// Switcher Toggle Logic
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('headerNav');
    if (toggle && nav) {
      toggle.addEventListener('click', function() {
        var isOpen = nav.classList.toggle('open');
        toggle.textContent = isOpen ? '\u2715' : '\u2630';
      });
      nav.querySelectorAll('a').forEach(function(link) {
        link.addEventListener('click', function() {
          nav.classList.remove('open');
          toggle.textContent = '\u2630';
        });
      });
    }

    document.querySelectorAll('.faq-question').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = btn.closest('.faq-item');
        var isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function(i) { i.classList.remove('open'); });
        if (!isOpen) item.classList.add('open');
      });
    });

    var dailyItems = document.querySelectorAll('.app-daily-item');
    var dailyCount = document.getElementById('dailyCount');
    var completed = 0;
    dailyItems.forEach(function(item) {
      item.addEventListener('click', function() {
        item.classList.toggle('done');
        completed = document.querySelectorAll('.app-daily-item.done').length;
        if (dailyCount) dailyCount.textContent = completed + ' / 3';
        updateXP();
      });
    });

    var missions = document.querySelectorAll('.app-mission');
    missions.forEach(function(m) {
      m.addEventListener('click', function() {
        m.classList.toggle('done');
        updateXP();
      });
    });

    function updateXP() {
      var bar = document.getElementById('xpBar');
      var text = document.getElementById('xpText');
      if (!bar || !text) return;
      var d = document.querySelectorAll('.app-daily-item.done').length;
      var m = document.querySelectorAll('.app-mission.done').length;
      var pct = Math.min(100, 30 + d * 12 + m * 10);
      bar.style.width = pct + '%';
      var total = Math.round(200 * pct / 100);
      text.textContent = total + ' / 200 XP';
    }

// Form booking logic
    (function(){
      var nameEl = document.getElementById('kpName');
      'KOSTYUK PROJECT'.split('').forEach(function(ch, i){
        var s = document.createElement('span');
        s.textContent = ch === ' ' ? ' ' : ch;
        s.style.animationDelay = (0.45 + i * 0.07) + 's';
        nameEl.appendChild(s);
      });
      var portal = document.getElementById('kostyukPortal');
      for (var i = 0; i < 60; i++){
        var st = document.createElement('div');
        st.className = 'kp-star';
        st.style.left = Math.random() * 100 + 'vw';
        st.style.top  = Math.random() * 100 + 'vh';
        st.style.animationDelay = (Math.random() * 0.8) + 's';
        st.style.transform = 'scale(' + (0.5 + Math.random() * 1.5) + ')';
        portal.appendChild(st);
      }
    })();
    function openKostyukPortal(e){
      if (e) e.preventDefault();
      var url = (e && e.currentTarget && e.currentTarget.getAttribute('href')) || '/show/';
      document.getElementById('kostyukPortal').classList.add('active');
      setTimeout(function(){ window.location.href = url; }, 1750);
      return false;
    }
    function toggleProjectSwitcher(open) {
      var switcher = document.getElementById('projectSwitcher');
      if (!switcher) return;
      switcher.classList.toggle('is-open', !!open);
      switcher.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.body.style.overflow = open ? 'hidden' : '';
    }