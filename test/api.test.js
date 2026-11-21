import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createShipmentServer } from '../dist/api.js';

async function startApi(t) {
  const server = createShipmentServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${server.address().port}`;

  async function post(id, eventId, status) {
    return fetch(`${url}/shipments/${id}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId, status }),
    });
  }
  return { url, post, get: id => fetch(`${url}/shipments/${id}`) };
}

test('reports each accepted event in order and keeps an old replay idempotent', async t => {
  const api = await startApi(t);
  const states = ['created', 'picked_up', 'in_transit', 'delivered'];
  const events = [];
  for (const [i, status] of states.entries()) {
    const response = await api.post('parcel-42', 'scan-' + i, status);
    assert.equal(response.status, 201);
    events.push({ eventId: 'scan-' + i, status, sequence: i + 1 });
    assert.deepEqual(await response.json(), events[i]);
  }
  const replay = await api.post('parcel-42', 'scan-0', 'created');
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), events[0]);
  const changed = await api.post('parcel-42', 'scan-0', 'cancelled');
  assert.equal(changed.status, 409);
  assert.deepEqual(await changed.json(), { error: 'event_id_conflict' });
  assert.deepEqual(await (await api.get('parcel-42')).json(), { shipmentId: 'parcel-42', status: 'delivered', events });
});

test('rejects invalid transitions without reserving event IDs or creating shipments', async t => {
  const api = await startApi(t);
  const invalid = await api.post('A', '1', 'picked_up');
  assert.equal(invalid.status, 409);
  assert.deepEqual(await invalid.json(), { error: 'invalid_transition' });
  assert.equal((await api.get('A')).status, 404);
  assert.equal((await api.post('A', '1', 'created')).status, 201);
  assert.equal((await api.post('A', '2', 'delivered')).status, 409);
  assert.equal((await api.post('A', '2', 'cancelled')).status, 201);
  assert.equal((await api.post('A', '3', 'picked_up')).status, 409);
  assert.equal((await api.get('A').then(r => r.json())).events.length, 2);
});

test('overlapping retries create one event; another shipment can reuse the same ID', async t => {
  const api = await startApi(t);
  const responses = await Promise.all(Array.from({ length: 6 }, () => api.post('A', 'scan', 'created')));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 200, 200, 200, 201]);
  assert.equal((await api.post('B', 'scan', 'created')).status, 201);
  assert.equal((await api.get('A').then(r => r.json())).events.length, 1);
});

test('rejects malformed inputs at the HTTP boundary', async t => {
  const api = await startApi(t);
  const url = api.url + '/shipments/A/events';
  async function send(body, type = 'application/json') {
    return fetch(url, { method: 'POST', headers: { 'content-type': type }, body });
  }
  assert.equal((await send('{}', 'text/plain')).status, 415);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send('a'.repeat(16385))).status, 413);
  for (const invalid of [null, [], {}, { eventId: '', status: 'created' },
    { eventId: '1', status: 'toString' }, { eventId: '1', status: 'created', typo: true }]) {
    assert.equal((await send(JSON.stringify(invalid))).status, 400);
  }
  const wrongMethod = await fetch(url);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal((await api.get('A')).status, 404);
});
