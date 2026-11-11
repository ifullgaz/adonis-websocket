import {
  type IncomingMessage,
  ServerResponse,
  STATUS_CODES,
  type Server as NodeHttpServer,
} from 'node:http'
import { WebSocketServer as BaseWebSocketServer } from 'ws'
import type { Duplex } from 'node:stream'
import type { HttpContext, Server, Router } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { createId } from '@paralleldrive/cuid2'
import type { ApplicationService } from '@adonisjs/core/types'
import type { MatchedRoute } from '@adonisjs/http-server/types'
import type { WebSocketConfig, WebSocketContext, WsRouteFn } from '../types/types.js'
import { type BusContract } from '../types/types.js'
import type { Serializable } from '@boringnode/bus/types/main'
import { WebSocket } from './websocket.js'

interface WebSocketMessage {
  channel: string
  data: Serializable
  uid: string
  options: { excludeSelf?: boolean }
  [key: string]: Serializable
}

class WebSocketServer {
  private channels = new Map<string, Map<string, WebSocket>>()
  private isRunning = false
  private shutdownPromise: Promise<void> | null = null

  private wss = new BaseWebSocketServer({
    noServer: true,
    WebSocket,
  })

  private nodeServer: NodeHttpServer | undefined
  private httpServer!: Server
  private router!: Router

  constructor(
    private config: WebSocketConfig,
    private app: ApplicationService,
    private bus: BusContract | undefined = undefined
  ) {}

  #publish(message: WebSocketMessage) {
    const { channel, data, uid, options } = message
    const sockets = this.channels.get(channel) || new Map<string, WebSocket>()
    const payload = JSON.stringify(data)
    for (const socket of sockets.values()) {
      if (
        socket.readyState === WebSocket.OPEN &&
        (socket.id !== uid || !options || !options.excludeSelf)
      ) {
        socket.send(payload)
      }
    }
  }

  async #subscribe() {
    if (this.bus) {
      const channel = this.bus.busPrefixedKey(this.config.bus.channel)
      await this.bus.subscribe(channel, async (message) => {
        this.#publish(message as WebSocketMessage)
      })
    }
  }

  async #unsubscribe(): Promise<void> {
    if (this.bus) {
      const channel = this.bus.busPrefixedKey(this.config.bus.channel)
      await this.bus.unsubscribe(channel)
    }
  }

  async #broadcast(channel: string, data: any, uid: string, options: any): Promise<void> {
    const message: WebSocketMessage = { channel, data, uid, options }
    if (this.bus) {
      const topic = this.bus.busPrefixedKey(this.config.bus.channel)
      await this.bus?.publish(topic, message)
    }
    // Always publish locally because the bus will not
    // publish to the instance that sent the message
    this.#publish(message)
  }

  /**
   * Run the route middleware, then resolve the route handler to a
   * function that is invoked after the upgrade with the websocket context.
   * A function handler is used as-is; a controller reference is wrapped
   * so the controller is built from the container at call time.
   */
  async #execute(ctx: HttpContext): Promise<WsRouteFn | undefined> {
    const route = ctx.route!
    const resolver = ctx.containerResolver
    let handler: WsRouteFn | undefined
    await route.middleware
      .runner()
      .finalHandler(async () => {
        const routeHandler = route.handler
        if (typeof routeHandler === 'function') {
          handler = routeHandler as unknown as WsRouteFn
        } else {
          handler = (wsCtx) => routeHandler.handle(resolver, wsCtx as unknown as HttpContext)
        }
      })
      .run((middleware, next) => {
        if (typeof middleware === 'function') {
          return middleware(ctx, next)
        }
        return middleware.handle(resolver, ctx, next, middleware.args)
      })
    return handler
  }

  #handleRequest(ctx: HttpContext, ws: WebSocket, handler: WsRouteFn) {
    const clientId = createId()
    const url = ctx.request.url()
    if (!this.channels.has(url)) {
      this.channels.set(url, new Map())
    }
    this.channels.get(url)!.set(clientId, ws as any)
    ws.id = clientId
    ws.broadcast = async (data: any, options: any) => {
      return await this.#broadcast(url, data, clientId, options)
    }
    ws.on('close', () => {
      this.channels.get(url)!.delete(clientId)
    })
    ws.on('error', (error) => {
      logger.error(`WebSocket ${url}: ${error.message}`)
    })
    Object.assign(ctx, { ws })
    Promise.resolve(handler(ctx as unknown as WebSocketContext)).catch((error) => {
      logger.error(error, `Error processing WebSocket request for ${url}`)
      ws.close(4000 + (error.status ?? 500), error.message)
      this.channels.get(url)!.delete(clientId)
    })
  }

  /**
   * Refuse the upgrade with a plain HTTP response, the same way
   * `ws` aborts a handshake internally (`abortHandshake` is not exported)
   */
  #abortHandshake(sock: Duplex, status: number, message?: string) {
    if (!sock.writable) {
      return sock.destroy()
    }
    // Only a known HTTP status produces a valid status line
    if (!STATUS_CODES[status]) {
      status = 500
    }
    const reason = STATUS_CODES[status]!
    const body = message || reason
    const headers = [
      `HTTP/1.1 ${status} ${reason}`,
      'Connection: close',
      'Content-Type: text/plain',
      `Content-Length: ${Buffer.byteLength(body)}`,
    ]
    sock.once('finish', () => sock.destroy())
    sock.end(headers.join('\r\n') + '\r\n\r\n' + body)
  }

  #createContext(request: IncomingMessage, route: MatchedRoute): HttpContext {
    const resolver = this.app.container.createResolver()
    const serverResponse = new ServerResponse(request)
    const req = this.httpServer.createRequest(request, serverResponse)
    const res = this.httpServer.createResponse(request, serverResponse)
    const ctx = this.httpServer.createHttpContext(req, res, resolver)
    ctx.params = route.params
    ctx.route = route.route
    return ctx
  }

  #upgradeHandler = async (req: IncomingMessage, sock: Duplex, head: Buffer) => {
    // The http server detaches its own listeners before emitting 'upgrade',
    // so an error on the raw socket while we own it must be handled
    sock.on('error', () => {})
    const url = req.url!.split('?')[0]
    const route = this.router.match(url, 'GET', true)
    if (!route) {
      return this.#abortHandshake(sock, 404)
    }
    const ctx = this.#createContext(req, route)
    let handler: WsRouteFn | undefined
    try {
      handler = await this.#execute(ctx)
    } catch (error: any) {
      logger.error(error, `Error processing WebSocket request for ${url}`)
      return this.#abortHandshake(sock, error.status ?? 500, error.message)
    }
    if (!handler) {
      // A middleware responded without calling next(); use its status
      const status = ctx.response.getStatus()
      return this.#abortHandshake(sock, status >= 400 ? status : 403)
    }
    this.wss.handleUpgrade(req, sock, head, (ws: WebSocket) => {
      ws.remotePort = req.socket.remotePort
      ws.userData = {}
      this.#handleRequest(ctx, ws, handler)
    })
  }

  public async run() {
    if (this.isRunning) {
      return
    }
    this.httpServer = await this.app.container.make('server')
    this.router = await this.app.container.make('router')
    this.nodeServer = this.httpServer.getNodeServer()
    if (!this.nodeServer) {
      return
    }
    this.isRunning = true
    await this.#subscribe()
    this.nodeServer.on('upgrade', this.#upgradeHandler)
  }

  public async open(ctx: WebSocketContext) {
    const ws = ctx.ws
    ws.on('message', async (message) => {
      await ws.broadcast(message.toString(), { excludeSelf: true })
    })
  }

  public async broadcast(channel: string, data: any) {
    const path = '/ws/' + channel
    return await this.#broadcast(path, data, '', {})
  }

  public async shutdown() {
    if (!this.isRunning) {
      return
    }
    if (this.shutdownPromise) {
      return this.shutdownPromise
    }
    this.shutdownPromise = (async () => {
      if (this.nodeServer) {
        this.nodeServer.removeListener('upgrade', this.#upgradeHandler)
      }
      await this.#unsubscribe()
      this.wss.clients.forEach((socket) => {
        try {
          socket.terminate()
        } catch {}
      })
      await new Promise<void>((resolve) => {
        this.wss.close(() => resolve())
      })
      this.isRunning = false
      this.shutdownPromise = null
    })()

    return this.shutdownPromise
  }
}

export default WebSocketServer
