const SHOW_IDS = new Set(['secret', 'huligan', 'matvey']);

export function parseLaunchRoute(locationLike) {
  const params = new URLSearchParams(locationLike?.search || '');
  const show = params.get('show');

  return { show: SHOW_IDS.has(show) ? show : null };
}
