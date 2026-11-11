import { test } from '@japa/runner'
import { bootApp, type Harness } from '../tests_helpers/boot_app.js'
import { TestClient } from '../tests_helpers/ws_client.js'

function sockets(h: Harness, path: string): any[] {
  return [...((h.webSocketServer as any).channels.get(path)?.values() ?? [])]
}

test.group('lifecycle: run & shutdown', (group) => {
  let h: Harness
  group.each.setup(async () => {
    h = await bootApp()
    return () => h.close()
  })

  test('AC-10.x run() is idempotent — no second upgrade listener', async ({ assert }) => {
    assert.equal(h.nodeServer.listenerCount('upgrade'), 1)
    await h.webSocketServer.run()
    assert.equal(h.nodeServer.listenerCount('upgrade'), 1)
  })

  test('AC-10.x shutdown() removes the upgrade listener and rejects later connects', async ({
    assert,
  }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')

    await h.webSocketServer.shutdown()

    assert.equal(h.nodeServer.listenerCount('upgrade'), 0)
    // the live socket was terminated
    await a.waitClose()
    // a fresh connect no longer upgrades
    await assert.rejects(() => TestClient.connect(h.baseUrl, '/ws/room', { timeout: 500 }))
  })

  test('AC-10.x shutdown() is safe under concurrent re-entrancy', async ({ assert }) => {
    const p1 = h.webSocketServer.shutdown()
    const p2 = h.webSocketServer.shutdown() // hits the cached shutdownPromise branch
    await assert.doesNotReject(() => Promise.all([p1, p2]))
    assert.equal(h.nodeServer.listenerCount('upgrade'), 0)
    // a third call after completion returns via the not-running guard
    await assert.doesNotReject(() => h.webSocketServer.shutdown())
  })

  test('AC-10.x a throwing socket.terminate() does not break shutdown()', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const socket = sockets(h, '/ws/room')[0]
    socket.terminate = () => {
      throw new Error('terminate boom')
    }
    // shutdown() swallows the throw in its forEach, then awaits wss.close(), which
    // (clientTracking on) only completes once the client disconnects. Since we broke
    // terminate, close the client from its side concurrently to let shutdown finish.
    const shutdownP = h.webSocketServer.shutdown()
    await a.close()
    await assert.doesNotReject(() => shutdownP)
  })

  test('AC-10.x bare server that never ran resolves shutdown() immediately', async ({ assert }) => {
    // Dynamic import: server.ts pulls the logger service, whose module needs a
    // booted app — safe here because a boot already happened in setup.
    const { default: WebSocketServer } = await import('../src/core/server.js')
    const bare = new WebSocketServer(
      { bus: { enabled: false, channel: 'x' } } as any,
      undefined as any
    )
    await assert.doesNotReject(() => bare.shutdown())
  })

  /**
   * run()'s `getNodeServer()` null early-return (server.ts:177-180) is defensive:
   * in a booted app the node server is always set before `ready()` runs `run()`.
   * Forcing it null would mean editing production source. Intentionally uncovered.
   */
  test('run() null-node-server early return is intentionally uncovered', async ({ assert }) => {
    assert.isTrue(true)
  }).skip(true, 'defensive: node server always set before run() in a booted app')
})
