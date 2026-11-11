import { test } from '@japa/runner'
import WebsocketAuthMiddleware from '../src/middleware/auth_middleware.js'

/** Minimal HttpContext double: only the surface the middleware touches. */
function fakeCtx(qs: Record<string, any>) {
  const state = { headers: {} as Record<string, any>, updateQs: [] as any[] }
  const request = {
    qs: () => qs,
    updateQs: (q: Record<string, any>) => state.updateQs.push({ ...q }),
    headers: () => state.headers,
  }
  return { ctx: { request } as any, state }
}

test.group('ws_auth middleware (unit)', () => {
  test('AC-5.1 lifts ?token into a Bearer header and drops it from the query', async ({
    assert,
  }) => {
    const { ctx, state } = fakeCtx({ token: 'abc', foo: 'bar' })
    let nextCalls = 0

    await new WebsocketAuthMiddleware().handle(ctx, (() => {
      nextCalls++
    }) as any)

    assert.equal(nextCalls, 1)
    assert.deepEqual(state.updateQs, [{ foo: 'bar' }]) // token removed, rest kept
    assert.equal(state.headers.authorization, 'Bearer abc')
  })

  test('AC-5.2 no token is a no-op (no header, no query rewrite)', async ({ assert }) => {
    const { ctx, state } = fakeCtx({ foo: 'bar' })
    let nextCalls = 0

    await new WebsocketAuthMiddleware().handle(ctx, (() => {
      nextCalls++
    }) as any)

    assert.equal(nextCalls, 1)
    assert.lengthOf(state.updateQs, 0)
    assert.isUndefined(state.headers.authorization)
  })
})
