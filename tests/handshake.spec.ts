import { test } from '@japa/runner'
import { bootApp, type Harness } from '../tests_helpers/boot_app.js'
import { TestClient } from '../tests_helpers/ws_client.js'
import { spyLogger } from '../tests_helpers/logger_spy.js'

const SHORT = 150

/** White-box view of the private channel map: path -> Map<clientId, ws>. */
function channels(h: Harness): Map<string, Map<string, any>> {
  return (h.webSocketServer as any).channels
}

test.group('handshake & routing', (group) => {
  let h: Harness
  group.each.setup(async () => {
    h = await bootApp()
    return () => h.close()
  })

  test('AC-1.1 valid url + matching route opens and registers the socket', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    assert.equal(channels(h).get('/ws/room')?.size, 1)
    await a.close()
  })

  test('AC-1.3 two clients on the same channel register under one key', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')
    assert.equal(channels(h).get('/ws/room')?.size, 2)
    await a.close()
    await b.close()
  })

  test('GUARD-OQ-A default route stays OPEN and A.send echoes to B', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')

    a.send('hello')

    // B (a peer) receives it; A (the sender) does not — open() echoes with excludeSelf.
    assert.equal(await b.nextJson(), 'hello')
    await assert.rejects(() => a.nextMessage(SHORT))

    // The sender's socket is still OPEN after the handshake + echo (locks OQ-A refutation).
    assert.equal(channels(h).get('/ws/room')?.size, 2)
    await a.close()
    await b.close()
  })

  test('GUARD-OQ-4 ?token connection keys under the query-less path', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room', { token: 'abc' })
    assert.deepEqual([...channels(h).keys()], ['/ws/room'])
    assert.equal(channels(h).get('/ws/room')?.size, 1)
    await a.close()
  })

  test('ECHO-SHAPE inbound echo forwards the decoded string, not a Buffer', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')

    a.send('hello')

    // Regression for OQ-2: the peer gets JSON of the string ('"hello"'), never
    // `{"type":"Buffer","data":[...]}`.
    const raw = await b.nextMessage()
    assert.equal(raw, '"hello"')
    assert.notInclude(raw, 'Buffer')

    await a.close()
    await b.close()
  })

  test('error-handler logs socket errors with the channel url', async ({ assert }) => {
    const spy = await spyLogger(['error'])
    try {
      await TestClient.connect(h.baseUrl, '/ws/room')
      const socket = [...channels(h).get('/ws/room')!.values()][0]

      socket.emit('error', new Error('boom'))

      const hits = spy.matching('WebSocket /ws/room')
      assert.isAbove(hits.length, 0)
      assert.isTrue(
        hits.some((r) => r.args.some((x) => typeof x === 'string' && x.includes('boom')))
      )
    } finally {
      spy.restore()
    }
  })
})
