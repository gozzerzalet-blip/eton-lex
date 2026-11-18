/** Comprueba que un enlace antiguo redirige al canonical sin perder ruta ni query. */
import http from 'node:http';
import { createApp } from '../app.js';
import { db } from '../db/index.js';
const server = http.createServer(createApp());
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
try {
    const oldLink = await fetch(`http://127.0.0.1:${port}/registro?invitado=ana&fuente=antigua`, {
        headers: { 'x-forwarded-host': 'antiguo.suga.run' },
        redirect: 'manual',
    });
    const canonical = await fetch(`http://127.0.0.1:${port}/registro?invitado=ana`, {
        headers: { 'x-forwarded-host': 'etonlex.com' },
        redirect: 'manual',
    });
    console.log(JSON.stringify({
        oldStatus: oldLink.status,
        oldLocation: oldLink.headers.get('location'),
        canonicalStatus: canonical.status,
    }));
}
finally {
    await new Promise((resolve) => server.close(() => resolve()));
    db.close();
}
//# sourceMappingURL=legacy-link-probe.js.map