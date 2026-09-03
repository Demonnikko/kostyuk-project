// Checkout flow controller for one show inside the VK Mini App.
// Wires the DB-driven seat map -> cart/total -> contact form -> existing booking
// contracts (create + tbank_init) -> payment open. Writes to the SAME base as the
// web, so a VK purchase syncs: the seat becomes taken for the website too.
//
// Reserve/create use tempBookingId (parity with the web flow; no auth weakening).
// vkUserId is passed only as a validated label. Payment opens the server-issued
// paymentUrl; success is NEVER inferred from returning to the app — the T-Bank
// webhook remains the source of truth.

import { loadHallForBooking } from './show-data.js?v=3';
import { renderSeatMap, selectionTotal, seatLabel } from './seat-map.js?v=3';
import {
  buildCreateBookingRequest,
  buildTbankInitRequest,
} from './booking.js?v=3';

const RESERVE_SHOWS = new Set(['secret', 'huligan']); // matvey holds seats via its own create call

function makeTempBookingId() {
  const rand = Math.random().toString(36).slice(2).toUpperCase();
  return `TEMP-${rand}`;
}

// Reserve selected seats (best-effort; matvey skips — it validates on create).
export async function reserveSeats(showId, client, { seats, tempBookingId, vkUserId }) {
  if (!RESERVE_SHOWS.has(showId) || !seats.length) return { ok: true, skipped: true };
  const body = {
    action: 'reserve',
    show: showId,
    tempBookingId,
    seats: seats.map((s) => ({ tableId: parseInt(s.table, 10) || 0, seatIdx: parseInt(s.seatNum, 10) || 0, key: s.key })),
  };
  const vk = Number(vkUserId);
  if (Number.isFinite(vk) && vk > 0) body.vkUserId = vk;
  try {
    await client.postJson('/api/seats', body);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

// Full create+pay sequence. Returns { ok, paymentUrl, bookingId, error }.
// Idempotency: caller must guard against double submits (checkout controller does).
export async function submitBooking(showId, client, order, ctx = {}) {
  const create = buildCreateBookingRequest(showId, order, ctx);
  let createResp;
  try {
    createResp = await client.postJson(create.path, create.body);
  } catch (error) {
    return { ok: false, stage: 'create', error };
  }
  // clientKey may come from the server (secret/matvey) or the client (huligan).
  const bookingId = create.meta.bookingId;
  const clientKey = create.meta.clientKeyFrom === 'client'
    ? create.meta.clientKey
    : (createResp && (createResp.clientKey || createResp.data?.clientKey));
  if (!clientKey) {
    return { ok: false, stage: 'create', error: { code: 'no_client_key' } };
  }

  const init = buildTbankInitRequest(showId, { bookingId, clientKey });
  let initResp;
  try {
    initResp = await client.postJson(init.path, init.body);
  } catch (error) {
    return { ok: false, stage: 'tbank_init', bookingId, clientKey, error };
  }
  const paymentUrl = initResp && initResp.paymentUrl;
  if (!paymentUrl) {
    return { ok: false, stage: 'tbank_init', bookingId, clientKey, error: { code: 'no_payment_url', detail: initResp?.error } };
  }
  return { ok: true, bookingId, clientKey, paymentUrl };
}

// Opens the payment URL. Inside VK we prefer VK Bridge's external open; otherwise
// a normal navigation. Never assume success here — the webhook decides.
export async function openPayment(paymentUrl, { bridge, windowLike } = {}) {
  // Inside VK: open the T-Bank URL via VK Bridge so it uses the in-app browser.
  // VKWebAppOpenPayForm is for VK Pay specifically; external acquiring uses a link.
  if (bridge && typeof bridge.send === 'function') {
    try {
      await bridge.send('VKWebAppOpenLink', { url: paymentUrl });
      return { ok: true, via: 'vk-bridge' };
    } catch {
      // fall through to plain navigation
    }
  }
  const w = windowLike || (typeof window !== 'undefined' ? window : null);
  if (w && w.location) {
    w.location.href = paymentUrl;
    return { ok: true, via: 'location' };
  }
  return { ok: false, error: { code: 'no_navigation' } };
}

/**
 * Mounts the checkout UI into `root` for a show.
 * Dependencies are injectable for tests.
 */
export function createCheckout({
  root,
  showId,
  client,
  vkUserId = null,
  bridge = null,
  maxSeats = 10,
  onError = () => {},
}) {
  let hall = null;
  let mapCtrl = null;
  let selected = [];
  let submitting = false;
  const tempBookingId = makeTempBookingId();

  function renderShell() {
    root.innerHTML = `
      <section class="checkout">
        <div class="checkout__map" id="checkoutMap"><p class="checkout__status" role="status">Загружаем схему зала…</p></div>
        <div class="checkout__cart" id="checkoutCart" hidden></div>
        <form class="checkout__form" id="checkoutForm" hidden novalidate>
          <label>Имя<input name="name" required autocomplete="name" /></label>
          <label>Телефон<input name="phone" type="tel" required autocomplete="tel" /></label>
          <label>Email<input name="email" type="email" autocomplete="email" /></label>
          <label>Ник ВКонтакте (необязательно)<input name="vk" placeholder="vk.com/id или ник" /></label>
          <button class="checkout__pay" type="submit" id="checkoutPay" disabled>Выберите места</button>
          <p class="checkout__note">Оплата откроется в Т-Банке. Место закрепится в общей системе — на сайте оно станет занятым.</p>
        </form>
      </section>`;
  }

  function renderCart() {
    const cart = root.querySelector('#checkoutCart');
    const form = root.querySelector('#checkoutForm');
    const pay = root.querySelector('#checkoutPay');
    if (!selected.length) {
      cart.hidden = true;
      pay.disabled = true;
      pay.textContent = 'Выберите места';
      return;
    }
    const total = selectionTotal(selected, hall.zones);
    cart.hidden = false;
    form.hidden = false;
    cart.innerHTML = `
      <ul class="checkout__list">${selected.map((s) => `<li>${escapeHtml(seatLabel(s))}</li>`).join('')}</ul>
      <p class="checkout__total">Итого: <strong>${total}</strong> ₽</p>`;
    pay.disabled = false;
    pay.textContent = `Оплатить ${total} ₽`;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || !selected.length) return;
    const form = event.target;
    const contact = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      vk: form.vk.value.trim(),
    };
    if (!contact.name || !contact.phone) {
      onError({ code: 'contact_required' });
      return;
    }
    submitting = true;
    const pay = root.querySelector('#checkoutPay');
    pay.disabled = true;
    pay.textContent = 'Оформляем…';

    await reserveSeats(showId, client, { seats: selected, tempBookingId, vkUserId });

    const order = {
      seats: selected,
      contact,
      date: hall.config?.show || hall.schedule || null,
      tempBookingId,
      originalPrice: selectionTotal(selected, hall.zones),
      finalPrice: selectionTotal(selected, hall.zones),
    };
    const result = await submitBooking(showId, client, order, { vkUserId });
    if (!result.ok) {
      submitting = false;
      pay.disabled = false;
      pay.textContent = 'Повторить оплату';
      onError(result.error || { code: result.stage });
      return;
    }
    await openPayment(result.paymentUrl, { bridge });
    // Stay in a "paying" state; success is confirmed by the webhook, not here.
    pay.textContent = 'Оплата открыта…';
  }

  async function start() {
    renderShell();
    const hallData = await loadHallForBooking(showId, client);
    if (!hallData.ok) {
      root.querySelector('#checkoutMap').innerHTML =
        `<div class="checkout__error" role="alert">Не удалось загрузить схему зала.${hallData.error?.code === 'layout_missing' ? ' Схема ещё не опубликована.' : ''}</div>`;
      onError(hallData.error);
      return;
    }
    hall = hallData;
    mapCtrl = renderSeatMap({
      container: root.querySelector('#checkoutMap'),
      hall,
      maxSeats,
      onChange: (sel) => { selected = sel; renderCart(); },
    });
    root.querySelector('#checkoutForm').hidden = false;
    root.querySelector('#checkoutForm').addEventListener('submit', handleSubmit);
    renderCart();
  }

  return { start, getSelected: () => selected };
}

// re-export for convenience
export { seatLabel, selectionTotal };
