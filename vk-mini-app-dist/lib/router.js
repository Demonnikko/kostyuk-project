const SHOW_IDS = new Set(['secret', 'huligan', 'matvey']);

export function parseLaunchRoute(locationLike) {
  const params = new URLSearchParams(locationLike?.search || '');
  const show = params.get('show');

  return { show: SHOW_IDS.has(show) ? show : null };
}

export function buildLaunchHref(locationLike, show) {
  const params = new URLSearchParams(locationLike?.search || '');

  if (SHOW_IDS.has(show)) {
    params.set('show', show);
  } else {
    params.delete('show');
  }

  const search = params.toString();
  return `${locationLike?.pathname || '/'}${search ? `?${search}` : ''}${locationLike?.hash || ''}`;
}

export function pushLaunchRoute(historyLike, locationLike, show) {
  const href = buildLaunchHref(locationLike, show);
  historyLike.pushState({}, '', href);
  return href;
}

export function focusRouteHeading(root) {
  const heading = root?.querySelector('h1');
  if (!heading) return false;

  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  return true;
}
