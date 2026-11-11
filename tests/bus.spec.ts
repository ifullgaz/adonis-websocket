import { test } from '@japa/runner'
import { busPrefixedKey } from '@ifullgaz/adonis-bus'
import { bootApp, type Harness } from '../tests_helpers/boot_app.js'
import { MockBusBroker } from '../tests_helpers/mock_bus.js'
import { TestClient } from '../tests_helpers/ws_client.js'

const SHORT = 150
const CHANNEL = 'ws:test'
const BUS = { channel: CHANNEL }

// busPrefixedKey reads the booted app's `bus` config, so it can only run AFTER a
// boot (not at module top). Call it inside tests.
const expectedTopic = () => busPrefixedKey(CHANNEL)

test.group('with a bus', (group) => {
  let h: Harness
  group.each.setup(async () => {
    h = await bootApp({ bus: BUS })
    return () => h.close()
  })

  test('the configured factory is installed', ({ assert }) => {
    const cfg = h.app.config.get('websocket') as { bus: { factory?: unknown } }
    assert.isFunction(cfg.bus.factory)
  })

  test('AC-8.x broadcast publishes to the bus AND echoes locally', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')

    await h.webSocketServer.broadcast('room', { hello: 'world' })

    // local echo to both clients
    assert.deepEqual(await a.nextJson(), { hello: 'world' })
    assert.deepEqual(await b.nextJson(), { hello: 'world' })

    // exactly one publish, on the prefixed topic, with the wire message shape
    assert.lengthOf(h.bus.published, 1)
    const { topic, message } = h.bus.published[0]
    assert.equal(topic, expectedTopic())
    assert.equal(message.channel, '/ws/room')
    assert.deepEqual(message.data, { hello: 'world' })
    await a.close()
    await b.close()
  })

  test('AC-8.x single instance does not double-deliver (bus never echoes to sender)', async ({
    assert,
  }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')

    await h.webSocketServer.broadcast('room', { n: 1 })

    assert.deepEqual(await a.nextJson(), { n: 1 })
    await assert.rejects(() => a.nextMessage(SHORT)) // no second copy from the bus
    await a.close()
  })

  test('AC-8.x run() subscribes on the prefixed topic', async ({ assert }) => {
    assert.equal(h.broker.subscriptionsFor(expectedTopic()), 1)
  })

  test('AC-10.x bus-enabled shutdown() unsubscribes', async ({ assert }) => {
    assert.equal(h.broker.subscriptionsFor(expectedTopic()), 1)
    await h.webSocketServer.shutdown()
    assert.equal(h.broker.subscriptionsFor(expectedTopic()), 0)
  })
})

test.group('without a bus', (group) => {
  let h: Harness
  group.each.setup(async () => {
    h = await bootApp()
    return () => h.close()
  })

  test('no factory is configured', ({ assert }) => {
    const cfg = h.app.config.get('websocket') as { bus: { factory?: unknown } }
    assert.isUndefined(cfg.bus.factory)
  })

  test('AC-9.x broadcast delivers locally with no bus publish', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    await h.webSocketServer.broadcast('room', { hello: 'world' })
    assert.deepEqual(await a.nextJson(), { hello: 'world' })
    assert.lengthOf(h.bus.published, 0)
    await a.close()
  })

  test('AC-9.x no subscription is registered when bus is disabled', async ({ assert }) => {
    assert.equal(h.broker.subscriptionsFor(busPrefixedKey('websocket:broadcast')), 0)
  })
})

test.group('with a bus, multi-instance', () => {
  test('AC-8.x a broadcast on A reaches a client on B exactly once', async ({ assert }) => {
    const broker = new MockBusBroker()
    const a = await bootApp({ broker, bus: BUS })
    const b = await bootApp({ broker, bus: BUS })
    try {
      const clientB = await TestClient.connect(b.baseUrl, '/ws/room')

      await a.webSocketServer.broadcast('room', { from: 'A' })

      assert.deepEqual(await clientB.nextJson(), { from: 'A' })
      await assert.rejects(() => clientB.nextMessage(SHORT)) // exactly once
      await clientB.close()
    } finally {
      await a.close()
      await b.close()
    }
  })

  test('AC-8.x the originating instance is not double-served', async ({ assert }) => {
    const broker = new MockBusBroker()
    const a = await bootApp({ broker, bus: BUS })
    const b = await bootApp({ broker, bus: BUS })
    try {
      const clientA = await TestClient.connect(a.baseUrl, '/ws/room')

      await a.webSocketServer.broadcast('room', { from: 'A' })

      // A's client gets it once via the local echo; the bus does not echo back to A.
      assert.deepEqual(await clientA.nextJson(), { from: 'A' })
      await assert.rejects(() => clientA.nextMessage(SHORT))
      await clientA.close()
    } finally {
      await a.close()
      await b.close()
    }
  })

  test('AC-8.x both instances share one subscription per instance on the topic', async ({
    assert,
  }) => {
    const broker = new MockBusBroker()
    const a = await bootApp({ broker, bus: BUS })
    const b = await bootApp({ broker, bus: BUS })
    try {
      assert.equal(broker.subscriptionsFor(expectedTopic()), 2)
      await a.webSocketServer.shutdown()
      assert.equal(broker.subscriptionsFor(expectedTopic()), 1)
    } finally {
      await a.close()
      await b.close()
    }
  })
})
