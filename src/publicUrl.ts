export const normalizePublicBaseUrl = (
  value: string | null | undefined,
  fallback = 'http://localhost:3000',
) => {
  const raw = (value || '').trim().replace(/\/+$/, '');
  const base = raw || fallback;
  if (/^https?:\/\//i.test(base)) {
    return base.replace(/\/+$/, '');
  }
  const protocol = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(base)
    ? 'http'
    : 'https';
  return `${protocol}://${base}`;
};

export const getPublicBaseUrl = () =>
  normalizePublicBaseUrl(process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN);
