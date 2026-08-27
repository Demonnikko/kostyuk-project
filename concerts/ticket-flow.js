(function (root) {
  'use strict';

  function toggleSelection(selected, seat, maxSeats) {
    var current = Array.isArray(selected) ? selected : [];
    var index = current.findIndex(function (item) { return item.key === seat.key; });
    if (index >= 0) return current.filter(function (_, itemIndex) { return itemIndex !== index; });
    if (current.length >= (maxSeats || 10)) throw new Error('Можно выбрать максимум 10 мест за один заказ.');
    return current.concat([seat]);
  }

  function shouldRollbackSeat(status) {
    return Number(status) === 409;
  }

  function buildDraft(input) {
    var date = input.date || {};
    var selected = Array.isArray(input.selected) ? input.selected : [];
    var total = typeof input.total === 'number'
      ? input.total
      : selected.reduce(function (sum, seat) { return sum + (Number(seat.price) || 0); }, 0);

    return {
      id: input.id || ('ORDER-' + Date.now().toString(36).toUpperCase()),
      status: 'draft',
      show: input.show || '',
      date: date.date || '',
      time: date.time || '',
      venue: date.venue || '',
      seats: selected.map(function (seat) { return seat.label || seat.key; }),
      seatData: selected.map(function (seat) {
        return { key: seat.key, label: seat.label || seat.key, zone: seat.zone || '', price: Number(seat.price) || 0 };
      }),
      quantity: selected.length,
      total: total,
      contact: Object.assign({}, input.contact || {}),
      createdAt: new Date().toISOString()
    };
  }

  function storeDraft(key, draft) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, JSON.stringify(draft));
      return true;
    } catch (_) {
      return false;
    }
  }

  function formatMoney(value) {
    return (Number(value) || 0).toLocaleString('ru-RU') + ' ₽';
  }

  function renderReview(target, draft) {
    if (!target || !root.document) return;
    target.textContent = '';
    var rows = [
      ['Шоу', draft.show],
      ['Сеанс', [draft.date, draft.time].filter(Boolean).join(' · ')],
      ['Площадка', draft.venue],
      ['Места', draft.seats.join(', ')],
      ['Билетов', draft.quantity + ' шт.'],
      ['Покупатель', draft.contact.name || '—'],
      ['Телефон', draft.contact.phone || '—'],
      ['Итого', formatMoney(draft.total)]
    ];
    rows.forEach(function (row, index) {
      var wrap = root.document.createElement('div');
      wrap.className = 'ticket-review__row' + (index === rows.length - 1 ? ' ticket-review__row--total' : '');
      var label = root.document.createElement('span');
      var value = root.document.createElement('strong');
      label.textContent = row[0];
      value.textContent = row[1] || '—';
      wrap.appendChild(label);
      wrap.appendChild(value);
      target.appendChild(wrap);
    });
  }

  function showPaymentPending(statusElement, button) {
    if (statusElement) {
      statusElement.hidden = false;
      statusElement.textContent = 'Онлайн-оплата пока не подключена. Ваш выбор сохранён на этом устройстве как черновик заказа.';
    }
    if (button) {
      button.textContent = 'Оплата скоро будет доступна';
      button.disabled = true;
    }
  }

  root.TicketFlowCore = {
    toggleSelection: toggleSelection,
    shouldRollbackSeat: shouldRollbackSeat,
    buildDraft: buildDraft,
    storeDraft: storeDraft,
    formatMoney: formatMoney,
    renderReview: renderReview,
    showPaymentPending: showPaymentPending
  };
})(globalThis);
