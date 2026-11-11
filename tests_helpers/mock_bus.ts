/*
|--------------------------------------------------------------------------
| Mock bus (test double for @ifullgaz/adonis-bus)
|--------------------------------------------------------------------------
|
| An in-memory pub/sub broker used to test the bus-backed broadcast paths of
| `WebSocketServer` without standing up Redis/MQTT.
|
| The real bus does NOT echo a published message back to the instance that
| sent it (see the comment in src/core/server.ts #broadcast). We model that
| here: each `WebSocketServer` gets its own `MockBus` from a shared
| `MockBusBroker`, and the broker delivers a published message to every
| subscriber EXCEPT the one that published it. This makes both shapes testable:
|
|   - single instance, bus enabled  -> publisher does not receive its own bus
|     message (it relies on the local echo in #broadcast), so no double delivery
|   - two instances sharing one broker -> a broadcast on A reaches B exactly once
|
| Each MockBus records its `publish` calls in `published` so tests can assert
| the bus was (or was not) used.
*/

export interface BusMessage {
  topic: string
  message: any
}

type Handler = (message: any) => void | Promise<void>

/**
 * Shared broker. Create one per test, then derive one `MockBus` per
 * `WebSocketServer` instance under test via `broker.createBus()`.
 */
export class MockBusBroker {
  /** All live buses, keyed by their id, with their channel->handler map. */
  private buses = new Map<string, Map<string, Handler>>()
  private nextId = 0

  createBus(): MockBus {
    const id = `bus-${this.nextId++}`
    this.buses.set(id, new Map())
    return new MockBus(this, id)
  }

  /** @internal */
  _subscribe(busId: string, channel: string, handler: Handler) {
    this.buses.get(busId)?.set(channel, handler)
  }

  /** @internal */
  _unsubscribe(busId: string, channel: string) {
    this.buses.get(busId)?.delete(channel)
  }

  /** How many live buses currently hold a subscription on `topic` (test introspection). */
  subscriptionsFor(topic: string): number {
    let count = 0
    for (const channels of this.buses.values()) {
      if (channels.has(topic)) count++
    }
    return count
  }

  /** @internal — deliver to every subscriber on `channel` except the publisher. */
  async _publish(fromBusId: string, channel: string, message: any) {
    for (const [busId, channels] of this.buses) {
      if (busId === fromBusId) continue
      const handler = channels.get(channel)
      if (handler) {
        await handler(message)
      }
    }
  }
}

/**
 * Per-instance bus handed to a `WebSocketServer`. Implements the subset of the
 * `@razgal-services/bus` `Bus` surface the package actually calls:
 * `publish`, `subscribe`, `unsubscribe`.
 */
export class MockBus {
  /** Spy log of everything this bus published, in order. */
  public readonly published: BusMessage[] = []

  constructor(
    private broker: MockBusBroker,
    private id: string
  ) {}

  async publish(topic: string, message: any): Promise<void> {
    this.published.push({ topic, message })
    await this.broker._publish(this.id, topic, message)
  }

  async subscribe(channel: string, handler: Handler): Promise<void> {
    this.broker._subscribe(this.id, channel, handler)
  }

  async unsubscribe(channel: string): Promise<void> {
    this.broker._unsubscribe(this.id, channel)
  }
}
