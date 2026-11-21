export type Status = 'created' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
export interface EventInput {
  eventId: string;
  status: Status;
}
interface ShipmentEvent extends EventInput {
  sequence: number;
}

const transitions: Record<Status, readonly Status[]> = {
  created: ['picked_up', 'cancelled'],
  picked_up: ['in_transit', 'cancelled'],
  in_transit: ['delivered'],
  delivered: [],
  cancelled: [],
};

export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function validEvent(value: unknown): value is EventInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.keys(value).length === 2
    && 'eventId' in value && validId(value.eventId)
    && 'status' in value && typeof value.status === 'string'
    && Object.hasOwn(transitions, value.status);
}

type AppendResult =
  | { kind: 'created' | 'replayed'; event: ShipmentEvent }
  | { kind: 'conflict'; reason: 'event_id_conflict' | 'invalid_transition' };

interface Shipment {
  status: Status;
  events: Map<string, ShipmentEvent>;
}

export class ShipmentLedger {
  private readonly shipments = new Map<string, Shipment>();

  append(shipmentId: string, input: EventInput): AppendResult {
    const shipment = this.shipments.get(shipmentId);
    // A retry can arrive after newer events. Resolve its identity before checking the transition.
    const previous = shipment?.events.get(input.eventId);
    if (previous) {
      if (previous.status !== input.status) return { kind: 'conflict', reason: 'event_id_conflict' };
      return { kind: 'replayed', event: previous };
    }

    const allowed = shipment ? transitions[shipment.status].includes(input.status) : input.status === 'created';
    if (!allowed) return { kind: 'conflict', reason: 'invalid_transition' };

    const events = shipment?.events ?? new Map<string, ShipmentEvent>();
    const event = { ...input, sequence: events.size + 1 };
    events.set(input.eventId, event);
    this.shipments.set(shipmentId, { status: input.status, events });
    return { kind: 'created', event };
  }

  find(shipmentId: string) {
    const shipment = this.shipments.get(shipmentId);
    if (!shipment) return undefined;
    return { shipmentId, status: shipment.status, events: [...shipment.events.values()] };
  }
}
