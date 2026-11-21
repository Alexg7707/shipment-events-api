# Shipment Events API

A small HTTP service for tracking a shipment through its delivery lifecycle. A scanner can send the same event twice if its connection drops after a successful request. This API lets it retry without adding a second event to the shipment history.

Built with **TypeScript in strict mode** and the **Node.js HTTP server**. There are no runtime package dependencies.

[TypeScript event model](src/shipments.ts) · [HTTP handler](src/api.ts) · [Integration tests](test/api.test.js) · [CI results](https://github.com/Alexg7707/shipment-events-api/actions/workflows/ci.yml)

## Run and test

Clone this repository, open its directory, and use Node.js 22 or later.

```sh
npm ci
npm test
npm start
```

The service listens at `http://127.0.0.1:3000` by default. Set `PORT` to use a different port. Tests exercise the API over HTTP.

## Try a retry

Run this command twice while the server is running:

```sh
curl -i http://127.0.0.1:3000/shipments/demo-42/events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"scan-1","status":"created"}'
```

The first request returns **201 Created**. Replaying it returns **200 OK** with the original event and sequence number. Read the shipment to verify that its history still contains one event:

```sh
curl http://127.0.0.1:3000/shipments/demo-42
```

Next, post `{"eventId":"scan-2","status":"picked_up"}` to the same events endpoint. Reusing `scan-1` with a different status returns **409 Conflict**. So does attempting to jump straight from `picked_up` to `delivered` without an `in_transit` event.

## Status transitions

| Current status | Allowed next status |
| --- | --- |
| No events | `created` |
| `created` | `picked_up`, `cancelled` |
| `picked_up` | `in_transit`, `cancelled` |
| `in_transit` | `delivered` |
| `delivered` or `cancelled` | Final status |

## Scope

This portfolio project keeps events in memory in a single Node.js process. Restarting it clears the history. A deployment with multiple server instances would need shared durable storage and a uniqueness constraint on the shipment and event IDs.
