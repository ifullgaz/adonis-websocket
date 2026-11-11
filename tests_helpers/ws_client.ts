/*
|--------------------------------------------------------------------------
| WebSocket test client
|--------------------------------------------------------------------------
|
| A thin promise-based wrapper over the `ws` client used to drive real
| connections against a booted test app. Designed for DETERMINISTIC tests:
| every wait is awaited on an event, never on a sleep.
|
|   const client = await TestClient.connect(baseUrl, '/ws/room', { token })
|   client.send('hello')
|   const msg = await client.nextMessage()        // resolves on next frame
|   const { code, reason } = await client.waitClose()
|   await client.close()
*/

import { WebSocket } from 'ws'

export interface ConnectOptions {
  /** Appended as `?token=...` so the `ws_auth` middleware can rewrite it to a Bearer header. */
  token?: string
  /** How long `connect` waits for the socket to open before rejecting. */
  timeout?: number
}

const DEFAULT_TIMEOUT = 2000

/**
 * Thrown by `TestClient.connect` when the server refuses the upgrade with a
 * plain HTTP response (e.g. 401/404) instead of completing the handshake.
 */
export class HandshakeError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Handshake rejected with ${status}: ${body}`)
  }
}

export class TestClient {
  private buffered: string[] = []
  private waiters: Array<(msg: string) => void> = []
  private closeInfo: { code: number; reason: string } | null = null
  private closeWaiters: Array<(info: { code: number; reason: string }) => void> = []

  private constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = data.toString()
      const waiter = this.waiters.shift()
      if (waiter) waiter(msg)
      else this.buffered.push(msg)
    })
    ws.on('close', (code, reasonBuf) => {
      this.closeInfo = { code, reason: reasonBuf.toString() }
      this.closeWaiters.splice(0).forEach((w) => w(this.closeInfo!))
    })
  }

  /** Open a connection and resolve once the handshake completes (or reject on close/error/timeout). */
  static connect(baseUrl: string, path: string, options: ConnectOptions = {}): Promise<TestClient> {
    const url = new URL(path, baseUrl)
    url.protocol = url.protocol.replace(/^http/, 'ws')
    if (options.token) url.searchParams.set('token', options.token)

    const ws = new WebSocket(url)
    const client = new TestClient(ws)

    return new Promise<TestClient>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out connecting to ${url}`)),
        options.timeout ?? DEFAULT_TIMEOUT
      )
      ws.once('open', () => {
        clearTimeout(timer)
        resolve(client)
      })
      ws.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      // A non-101 response means the server aborted the handshake. When this
      // listener exists `ws` emits it instead of `error`, letting us read the body.
      ws.once('unexpected-response', (req, res) => {
        clearTimeout(timer)
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => {
          req.destroy()
          reject(new HandshakeError(res.statusCode ?? 0, body))
        })
      })
      // A server-side reject closes the socket before 'open' fires.
      ws.once('close', (code, reasonBuf) => {
        clearTimeout(timer)
        reject(new Error(`Closed before open: ${code} ${reasonBuf.toString()}`))
      })
    })
  }

  send(data: string | object): void {
    this.ws.send(typeof data === 'string' ? data : JSON.stringify(data))
  }

  /**
   * Resolve with the next inbound message (or a buffered one). Rejects after
   * `timeout` ms — use a short timeout to assert that NOTHING arrives.
   */
  nextMessage(timeout = DEFAULT_TIMEOUT): Promise<string> {
    const buffered = this.buffered.shift()
    if (buffered !== undefined) return Promise.resolve(buffered)
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(onMessage)
        if (idx >= 0) this.waiters.splice(idx, 1)
        reject(new Error('Timed out waiting for message'))
      }, timeout)
      const onMessage = (msg: string) => {
        clearTimeout(timer)
        resolve(msg)
      }
      this.waiters.push(onMessage)
    })
  }

  /** Parsed convenience over `nextMessage`. */
  async nextJson<T = any>(timeout = DEFAULT_TIMEOUT): Promise<T> {
    return JSON.parse(await this.nextMessage(timeout)) as T
  }

  /** Resolve with the close `{ code, reason }` (immediately if already closed). */
  waitClose(timeout = DEFAULT_TIMEOUT): Promise<{ code: number; reason: string }> {
    if (this.closeInfo) return Promise.resolve(this.closeInfo)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeout)
      this.closeWaiters.push((info) => {
        clearTimeout(timer)
        resolve(info)
      })
    })
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve())
      this.ws.close()
    })
  }
}
