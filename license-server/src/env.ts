export interface Env {
  DB: D1Database;
  /** Ed25519 private key as a JWK (JSON). A secret — never in wrangler.jsonc. */
  LICENSE_PRIVATE_KEY: string;
  /** Cloudflare Access, e.g. `kennjanali.cloudflareaccess.com`. Empty = admin locked. */
  ACCESS_TEAM_DOMAIN: string;
  /** The Access application's audience tag. Empty = admin locked. */
  ACCESS_AUD: string;
  /** Set only in .dev.vars for `wrangler dev`. Never deployed. */
  DEV_ADMIN?: string;
}
