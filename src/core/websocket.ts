import { WebSocket as WebSocketBase } from 'ws'

export class WebSocket extends WebSocketBase {
  declare id: string
  declare remotePort: number | undefined
  declare broadcast: (data: any, options?: { excludeSelf?: boolean }) => Promise<void>
  declare userData: any
}
