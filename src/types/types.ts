import type { HttpContext } from '@adonisjs/core/http'
import type { WebSocket } from '../core/websocket.js'
import type { Constructor, LazyImport } from '@adonisjs/core/types/common'

export type WebSocketContext = {
  ws: WebSocket
} & Omit<HttpContext, 'response'>

export type WsRouteFn = (ctx: WebSocketContext) => void

export type GetWsControllerHandlers<Controller extends Constructor<any>> = {
  [K in keyof InstanceType<Controller>]: InstanceType<Controller>[K] extends (
    ctx: WebSocketContext,
    ...args: any[]
  ) => any
    ? K
    : never
}[keyof InstanceType<Controller>]

export type WsRouteHandler<T extends Constructor<any>> =
  string | WsRouteFn | [LazyImport<T> | T, GetWsControllerHandlers<T>?]

export type BusFactory = (transport?: string) => Promise<BusContract>

export type WebSocketConfig = {
  bus: {
    factory?: BusFactory
    enabled: boolean
    channel: string
  }
}

export interface WebSocketServerContract {
  run(): Promise<void>
  open(ctx: WebSocketContext): Promise<void>
  broadcast(channel: string, data: any): Promise<void>
  shutdown(): Promise<void>
}

export type SubscribeHandler<T extends Serializable> = (payload: T) => void | Promise<void>

export type Serializable =
  string | number | boolean | null | Serializable[] | { [key: string]: Serializable }

export interface BusContract {
  busPrefixedKey(key: string, connectionName?: string): string
  publish(channel: string, message: Serializable): Promise<boolean>
  subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>): Promise<void>
  unsubscribe(channel: string): Promise<void>
}
