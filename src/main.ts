import { createShipmentServer } from './api.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');

const server = createShipmentServer();
server.listen(port, '127.0.0.1', () => console.log(`Listening on http://127.0.0.1:${port}`));
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
