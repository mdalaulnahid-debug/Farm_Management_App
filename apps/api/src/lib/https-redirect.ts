import Fastify from 'fastify';

/**
 * Where a plain-http visit is sent. PASSKEY_ORIGIN, when set, is the farm's one real address, so an old or
 * bare name lands there too; otherwise the same host the browser asked for, over https.
 * Returns null when there is no usable host (the request is then refused instead of redirected).
 */
export function httpsTarget(host: string | undefined, url: string, origin = process.env.PASSKEY_ORIGIN): string | null {
  const pinned = origin?.trim().replace(/\/+$/, '');
  if (pinned && /^https:\/\/[^/]+$/.test(pinned)) return pinned + url;
  // Host may carry a port (bdp-agrofarm...:80); https uses its default port.
  const name = (host ?? '').trim().replace(/:\d+$/, '');
  if (!/^[a-z0-9.-]+$/i.test(name)) return null;
  return `https://${name}${url}`;
}

/**
 * A tiny server that only answers "go to https://". It never serves the app, so nothing on plain http can
 * read a page or take a password. Behind `tailscale serve --http=80` it means a bare name pasted into any
 * browser still opens the site. Started only when HTTPS_REDIRECT_PORT is set; it listens on 127.0.0.1 only.
 */
export function buildRedirectApp() {
  const app = Fastify({ logger: false });
  app.all('/*', async (req, reply) => {
    const target = httpsTarget(req.headers.host, req.url);
    if (!target) return reply.status(400).send('Open this site with https://');
    // 308 keeps the method; the browser never sends a form body over plain http again.
    return reply.header('Cache-Control', 'no-store').redirect(target, 308);
  });
  return app;
}
