/**
 * Only you may open /admin — it holds every customer's daily revenue, so it
 * fails closed, never open.
 *
 *  1. Cloudflare Access, when ACCESS_TEAM_DOMAIN and ACCESS_AUD are set:
 *     Access signs every request it lets through, and that signature is
 *     checked here.
 *  2. Otherwise the ADMIN_PASSWORD secret, as HTTP Basic auth (user `admin`)
 *     over HTTPS. Free, no Zero Trust signup needed.
 *  3. With neither, the dashboard is locked.
 */

import type { MiddlewareHandler } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { Env } from './env';

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.env.DEV_ADMIN === 'true') return next();

  const team = c.env.ACCESS_TEAM_DOMAIN;
  const audience = c.env.ACCESS_AUD;
  if (team && audience) {
    const token = c.req.header('cf-access-jwt-assertion');
    if (!token) return c.text('Sign in through Cloudflare Access.', 403);
    let jwks = jwksByTeam.get(team);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
      jwksByTeam.set(team, jwks);
    }
    try {
      await jwtVerify(token, jwks, { issuer: `https://${team}`, audience });
    } catch {
      return c.text('Sign in through Cloudflare Access.', 403);
    }
    return next();
  }

  // Refuse a weak password outright rather than guard revenue with one.
  const password = c.env.ADMIN_PASSWORD;
  if (!password || password.length < 20) {
    return c.text('The dashboard is locked until an admin password (20+ characters) or Cloudflare Access is set up.', 403);
  }
  return basicAuth({ username: 'admin', password, realm: 'POS@034 admin' })(c, next);
};
