import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ShipmentLedger, validEvent, validId } from './shipments.js';

const maxBodyBytes = 16 * 1024;

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse, ledger: ShipmentLedger) {
  const path = (req.url ?? '').split('?', 1)[0] ?? '';
  const route = /^\/shipments\/([^/]+)(\/events)?$/.exec(path);
  if (!route) return reply(res, 404, { error: 'not_found' });
  const shipmentId = route[1];
  if (!validId(shipmentId)) return reply(res, 400, { error: 'invalid_shipment_id' });
  const method = route[2] ? 'POST' : 'GET';
  if (req.method !== method) {
    res.setHeader('allow', method);
    return reply(res, 405, { error: 'method_not_allowed' });
  }
  if (method === 'GET') {
    const shipment = ledger.find(shipmentId);
    return shipment ? reply(res, 200, shipment) : reply(res, 404, { error: 'shipment_not_found' });
  }

  const mediaType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') return reply(res, 415, { error: 'expected_json' });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > maxBodyBytes) {
      req.resume();
      return reply(res, 413, { error: 'body_too_large' });
    }
    chunks.push(data);
  }

  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return reply(res, 400, { error: 'malformed_json' });
  }
  if (!validEvent(input)) return reply(res, 400, { error: 'invalid_event' });
  const result = ledger.append(shipmentId, input);
  if (result.kind === 'conflict') return reply(res, 409, { error: result.reason });
  return reply(res, result.kind === 'created' ? 201 : 200, result.event);
}

export function createShipmentServer() {
  const ledger = new ShipmentLedger();
  return createServer((req, res) => {
    void handle(req, res, ledger).catch(() => {
      if (!res.destroyed && !res.headersSent) reply(res, 500, { error: 'internal_error' });
    });
  });
}
