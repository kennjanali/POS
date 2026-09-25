import { Hono } from 'hono';
import { csrf } from 'hono/csrf';

import { requireAdmin } from './access';
import { admin } from './admin';
import { api } from './api';
import type { Env } from './env';
import { site } from './site';

const app = new Hono<{ Bindings: Env }>();

app.route('/api', api);
// Forms post only from these pages: a login cookie or a remembered admin
// password must not let another site submit them.
app.use('/admin/*', csrf());
app.use('/admin', requireAdmin);
app.use('/admin/*', requireAdmin);
app.route('/admin', admin);
app.use('*', csrf());
app.route('/', site);

export default app;
