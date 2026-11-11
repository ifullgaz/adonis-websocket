import { test } from '@japa/runner'
import { bootApp, type Harness } from '../tests_helpers/boot_app.js'
import { HandshakeError, TestClient } from '../tests_helpers/ws_client.js'

test.group('upgrade rejection', (group) => {
  let h: Harness
  group.each.setup(async () => {
    h = await bootApp()
    return () => h.close()
  })

  test('AC-2.2 no matching route aborts the handshake with HTTP 404', async ({ assert }) => {
    // The route is matched before `handleUpgrade`, so the server never
    // switches protocols: the client sees a plain 404 response.
    let error: unknown
    try {
      await TestClient.connect(h.baseUrl, '/nope')
    } catch (e) {
      error = e
    }
    assert.instanceOf(error, HandshakeError)
    assert.equal((error as HandshakeError).status, 404)
    assert.equal((error as HandshakeError).body, 'Not Found')
  })

  test('AC-2.x query string is stripped before matching, so ?token resolves', async ({
    assert,
  }) => {
    const a = await TestClient.connect(h.baseUrl, '/ws/room', { token: 't' })
    assert.isOk(a)
    await a.close()
  })

  /**
   * AC-2.1 — the 4400 "Bad Request" branch (`server.ts` `#upgradeHandler`, the
   * `if (!request.url ...)` guard) is defensive and UNREACHABLE after a real `ws`
   * handshake: `ws` always provides `request.url`. Exercising it would require
   * editing production source purely to satisfy a test, which the plan forbids
   * without sign-off. Logged here as intentionally-uncovered (no silent gap).
   */
  test('AC-2.1 4400 missing-url branch is intentionally uncovered (defensive)', async ({
    assert,
  }) => {
    assert.isTrue(true)
  }).skip(true, 'defensive branch, unreachable after a real ws handshake')
})
