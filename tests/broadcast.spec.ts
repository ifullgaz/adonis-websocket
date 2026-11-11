import { test } from '@japa/runner'
import { bootApp, type Harness } from '../tests_helpers/boot_app.js'
import { TestClient } from '../tests_helpers/ws_client.js'

const SHORT = 150

function channels(h: Harness): Map<string, Map<string, any>> {
  return (h.webSocketServer as any).channels
}

/** The single server-side socket on a channel (white-box, for excludeSelf branches). */
function onlySocket(h: Harness, path: string): any {
  return [...channels(h).get(path)!.values()][0]
}

/** Poll a predicate until true (bounded) — for the async server-side close prune. */
async function until(fn: () => boolean, timeout = 1000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('until: timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

test.group('broadcast & channels', (group) => {
  let h: Harness
  group.each.setup(async () => {
    h = await bootApp() // bus disabled
    return () => h.close()
  })

  test('AC-4.1 server.broadcast reaches every client on the channel', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')

    await h.webSocketServer.broadcast('room', { hello: 'world' })

    assert.deepEqual(await a.nextJson(), { hello: 'world' })
    assert.deepEqual(await b.nextJson(), { hello: 'world' })
    await a.close()
    await b.close()
  })

  test('AC-3.2 sockets on a different channel never receive the message', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/other')

    await h.webSocketServer.broadcast('room', { only: 'room' })

    assert.deepEqual(await a.nextJson(), { only: 'room' })
    await assert.rejects(() => b.nextMessage(SHORT))
    await a.close()
    await b.close()
  })

  test('AC-4.x broadcast to a channel with no subscribers resolves', async ({ assert }) => {
    await assert.doesNotReject(() => h.webSocketServer.broadcast('ghost', { x: 1 }))
  })

  test('AC-3.x excludeSelf:true skips the sender, peer still receives', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const socketA = onlySocket(h, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')

    await socketA.broadcast({ v: 1 }, { excludeSelf: true })

    assert.deepEqual(await b.nextJson(), { v: 1 })
    await assert.rejects(() => a.nextMessage(SHORT))
    await a.close()
    await b.close()
  })

  test('AC-3.x excludeSelf falsy includes the sender', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const socketA = onlySocket(h, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')

    await socketA.broadcast({ v: 2 }, {})

    assert.deepEqual(await a.nextJson(), { v: 2 })
    assert.deepEqual(await b.nextJson(), { v: 2 })
    await a.close()
    await b.close()
  })

  test('AC-3.x closed socket is pruned and no longer delivered to', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')
    assert.equal(channels(h).get('/ws/room')?.size, 2)

    await a.close()
    await until(() => channels(h).get('/ws/room')?.size === 1)

    await h.webSocketServer.broadcast('room', { after: 'close' })
    assert.deepEqual(await b.nextJson(), { after: 'close' })
    assert.equal(channels(h).get('/ws/room')?.size, 1)
    await b.close()
  })

  test('AC-4.x payload is JSON-serialized once', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    await h.webSocketServer.broadcast('room', { a: 1 })
    assert.equal(await a.nextMessage(), '{"a":1}')
    await a.close()
  })
})
