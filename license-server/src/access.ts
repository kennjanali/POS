/**
 * Only you may open /admin. Cloudflare Access sits in front of it and signs
 * every request it lets through; this checks that signature. Until Access is
 * configured the dashboard stays locked — it holds every customer's daily
 * revenue, so it must fail closed, never open.
 */

import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { Env } from './env';

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (c.env.DEV_ADMIN === 'true') return next();

  const team = c.env.ACCESS_TEAM_DOMAIN;
  const audience = c.env.ACCESS_AUD;
  if (!team || !audience) {
    return c.text('The dashboard is locked until Cloudflare Access is set up.', 403);
  }

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
};
