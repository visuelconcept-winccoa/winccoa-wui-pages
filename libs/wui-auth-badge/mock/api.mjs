// `wui dev`: the badge backend, mocked. Badge 12345678 is "dev"'s.
let badge = '12345678';
export default {
  'GET /api/auth-badge/config': () => ({ prefix: '', maxFrameMs: 150, minUidLength: 4 }),
  'POST /api/auth-badge/login': ({ body }) =>
    body?.uid === badge ? { status: 'ok', username: 'dev', fullName: 'Dev', token: 'mock-token' } : { status: 'unknown' },
  'GET /api/auth-badge/me': () => ({ username: 'dev', badge: badge ? badge.slice(-4) : null }),
  'PUT /api/auth-badge/me': ({ body }) => {
    if (String(body?.uid ?? '').length < 4) return { status: 'invalid' };
    badge = String(body.uid);
    return { status: 'ok' };
  },
  'DELETE /api/auth-badge/me': () => {
    badge = '';
    return { status: 'ok' };
  }
};
