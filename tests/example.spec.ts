import { test } from '@japa/runner'
import { bootApp, type Harness } from '../tests_helpers/boot_app.js'
import { TestClient } from '../tests_helpers/ws_client.js'

/**
 * Smoke test: proves the harness boots a real app + listening server and that a
 * round-trip broadcast works end-to-end. The full scenario suite (derived from
 * the websocket-business-analyst spec) builds on this rig — see the
 * `websocket-tester` skill for the behavior/branch checklist.
 */
test.group('smoke', (group) => {
  let h: Harness
  group.each.setup(async () => {
    h = await bootApp()
    return () => h.close()
  })

  test('a broadcast on a channel reaches another client on that channel', async ({ assert }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room')
    const b = await TestClient.connect(h.baseUrl, '/ws/room')

    await h.webSocketServer.broadcast('room', { hello: 'world' })

    assert.deepEqual(await a.nextJson(), { hello: 'world' })
    assert.deepEqual(await b.nextJson(), { hello: 'world' })

    await a.close()
    await b.close()
  })
})
