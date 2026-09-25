import { Hono } from 'hono';

import { requireAdmin } from './access';
import { admin } from './admin';
import { api } from './api';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.route('/api', api);
app.use('/admin', requireAdmin);
app.use('/admin/*', requireAdmin);
app.route('/admin', admin);
app.get('/', (c) => c.redirect('/admin'));

export default app;
