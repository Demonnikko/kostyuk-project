export function buildAudienceTrendSeries(raw, dayKeys) {
  return dayKeys.slice().reverse().map((day) => ({
    day,
    value: Math.max(0, Number(raw?.[day]?.total || 0)),
  }));
}

function shortDate(day) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
    .format(new Date(`${day}T12:00:00+03:00`))
    .replace('.', '');
}

function dayLabel(day) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
    .format(new Date(`${day}T12:00:00+03:00`));
}

export function renderAudienceTrend(series) {
  const width = 760;
  const height = 230;
  const pad = { top: 24, right: 18, bottom: 38, left: 42 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(1, ...series.map((item) => item.value));
  const xAt = (index) => pad.left + (series.length <= 1 ? plotWidth / 2 : plotWidth * index / (series.length - 1));
  const yAt = (value) => pad.top + plotHeight - plotHeight * value / maxValue;
  const points = series.map((item, index) => `${xAt(index).toFixed(1)},${yAt(item.value).toFixed(1)}`).join(' ');
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const y = pad.top + plotHeight * ratio;
    const value = Math.round(maxValue * (1 - ratio));
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="audience-trend-grid"/><text x="${pad.left - 9}" y="${y + 4}" class="audience-trend-axis" text-anchor="end">${value}</text>`;
  }).join('');
  const labels = series.map((item, index) => {
    const show = series.length <= 10 || index === 0 || index === series.length - 1 || index % 5 === 0;
    if (!show) return '';
    return `<text x="${xAt(index)}" y="${height - 12}" class="audience-trend-axis" text-anchor="middle">${shortDate(item.day)}</text>`;
  }).join('');
  const dots = series.map((item, index) => `<circle cx="${xAt(index)}" cy="${yAt(item.value)}" r="4" class="audience-trend-dot" tabindex="0"><title>${dayLabel(item.day)}: ${item.value} сеансов</title></circle>`).join('');
  const today = series[series.length - 1]?.value || 0;
  const yesterday = series[series.length - 2]?.value || 0;
  const maximum = series.reduce((max, item) => Math.max(max, item.value), 0);

  return `<div class="audience-trend-summary"><span>Сегодня <strong>${today}</strong></span><span>Вчера <strong>${yesterday}</strong></span><span>Максимум <strong>${maximum}</strong></span></div><svg class="audience-trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Посещения сайта по дням">${grid}<polyline points="${points}" class="audience-trend-line"/>${dots}${labels}</svg>`;
}

if (typeof window !== 'undefined') {
  window.AdminAnalyticsTrend = { buildAudienceTrendSeries, renderAudienceTrend };
}
