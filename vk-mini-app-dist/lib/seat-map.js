// Renders a hall seat map from the DB layout and manages seat selection.
// Layout-driven: works for any viewBox/zone set (huligan 580x410, secret 1280x761,
// matvey 580x410) without hard-coded schemas. Occupancy comes from `taken`.
// Pure DOM/SVG, no framework. Accessible: seats are buttons with aria-pressed.

const SVG_NS = 'http://www.w3.org/2000/svg';

function zoneColor(zones, zoneId) {
  const z = zones && zones[zoneId];
  return (z && z.color) || '#8a8a90';
}
function zonePrice(zones, zoneId) {
  const z = zones && zones[zoneId];
  return z && Number(z.price) ? Number(z.price) : 0;
}

// Human-readable seat name for cart/aria, derived from the layout fields.
export function seatLabel(seat) {
  if (seat.label) return seat.label;
  const t = seat.table;
  if (t === 'Бар') return `Бар, место ${seat.seatNum}`;
  if (typeof t === 'number') return `Стол ${t}, место ${seat.seatNum}`;
  if (typeof t === 'string' && t) return `${t}, место ${seat.seatNum}`;
  return `Место ${seat.seatNum}`;
}

// Radius per seat type, scaled for the hall's coordinate system.
function seatRadius(seat, scale) {
  const base = seat.type === 'round4' ? 5.2
    : seat.type === 'divanSeat' ? 5.6
    : seat.type === 'round8' ? 12
    : 6;
  return base * scale;
}

/**
 * Renders the seat map into `container` and wires selection.
 * @param {object} opts
 *   container: HTMLElement
 *   hall: { viewBox, zones, seats:[{key,zone,seatNum,x,y,type,taken}] }
 *   maxSeats: number (default 10)
 *   onChange: (selectedSeats[]) => void
 * @returns { getSelected, destroy }
 */
export function renderSeatMap({ container, hall, maxSeats = 10, onChange }) {
  const selected = new Map(); // key -> seat
  const seatEls = new Map();  // key -> circle element
  const viewBox = hall.viewBox || '0 0 580 410';
  const vbParts = viewBox.trim().split(/\s+/).map(Number);
  const vbWidth = vbParts[2] || 580;
  // Larger halls (secret 1280) get a smaller per-seat scale so dots stay proportional.
  const scale = vbWidth > 800 ? 1 : 1;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', 'seatmap__svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Схема зала. Выберите места.');

  function fireChange() {
    if (onChange) onChange([...selected.values()]);
  }

  function paint(seat) {
    const el = seatEls.get(seat.key);
    if (!el) return;
    const isSel = selected.has(seat.key);
    if (seat.taken) {
      el.setAttribute('fill', 'rgba(255,255,255,0.10)');
      el.setAttribute('stroke', 'rgba(255,255,255,0.10)');
    } else if (isSel) {
      el.setAttribute('fill', '#ffffff');
      el.setAttribute('stroke', zoneColor(hall.zones, seat.zone));
    } else {
      el.setAttribute('fill', zoneColor(hall.zones, seat.zone));
      el.setAttribute('stroke', 'rgba(255,255,255,0.22)');
    }
    el.setAttribute('aria-pressed', isSel ? 'true' : 'false');
  }

  function toggle(seat) {
    if (seat.taken) return;
    if (selected.has(seat.key)) {
      selected.delete(seat.key);
    } else {
      if (selected.size >= maxSeats) return;
      selected.set(seat.key, seat);
    }
    paint(seat);
    fireChange();
  }

  for (const seat of hall.seats) {
    if (seat.x == null || seat.y == null) continue;
    const r = seatRadius(seat, scale);
    const hit = document.createElementNS(SVG_NS, 'circle');
    hit.setAttribute('cx', seat.x);
    hit.setAttribute('cy', seat.y);
    hit.setAttribute('r', r + 4);
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('class', 'seatmap__hit');
    hit.setAttribute('role', 'button');
    hit.setAttribute('tabindex', seat.taken ? '-1' : '0');
    const price = zonePrice(hall.zones, seat.zone);
    hit.setAttribute('aria-label', `${seatLabel(seat)}${seat.taken ? ', занято' : `, ${price} ₽`}`);
    hit.setAttribute('aria-pressed', 'false');
    if (seat.taken) hit.setAttribute('aria-disabled', 'true');

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', seat.x);
    dot.setAttribute('cy', seat.y);
    dot.setAttribute('r', r);
    dot.setAttribute('stroke-width', '0.8');
    dot.setAttribute('class', 'seatmap__dot');
    seatEls.set(seat.key, dot);

    const num = document.createElementNS(SVG_NS, 'text');
    num.setAttribute('x', seat.x);
    num.setAttribute('y', seat.y);
    num.setAttribute('text-anchor', 'middle');
    num.setAttribute('dominant-baseline', 'central');
    num.setAttribute('font-size', String((seat.type === 'round4' ? 5.5 : 6.5) * scale));
    num.setAttribute('fill', seat.taken ? 'rgba(255,255,255,0.3)' : '#fff');
    num.setAttribute('pointer-events', 'none');
    num.textContent = seat.seatNum != null ? String(seat.seatNum) : '';

    if (!seat.taken) {
      const handler = () => toggle(seat);
      hit.addEventListener('click', handler);
      hit.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      });
    }

    svg.appendChild(hit);
    svg.appendChild(dot);
    svg.appendChild(num);
    paint(seat);
  }

  container.innerHTML = '';
  container.appendChild(svg);

  return {
    getSelected: () => [...selected.values()],
    destroy: () => { container.innerHTML = ''; selected.clear(); seatEls.clear(); },
  };
}

// Computes the order total from selected seats and the hall zones.
export function selectionTotal(selectedSeats, zones) {
  return selectedSeats.reduce((sum, s) => sum + zonePrice(zones, s.zone), 0);
}
