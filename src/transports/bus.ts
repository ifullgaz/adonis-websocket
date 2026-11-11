import app from '@adonisjs/core/services/app'
import { busPrefixedKey } from '@ifullgaz/adonis-bus'
import type { BusManager } from '@boringnode/bus'
import type { KnownTransports } from '@ifullgaz/adonis-bus/types'
import type { BusContract, Serializable, SubscribeHandler } from '../types/types.js'

export function bus(transport?: string) {
  return async () => {
    const driver = await app.container.make('bus')
    return new BusTransport(driver, transport)
  }
}

class BusTransport implements BusContract {
  constructor(
    private driver: BusManager<KnownTransports>,
    private transport?: keyof KnownTransports
  ) {}

  busPrefixedKey(key: string, connectionName?: string): string {
    return busPrefixedKey(key, connectionName)
  }

  async publish(channel: string, message: Serializable): Promise<boolean> {
    return await this.driver.use(this.transport).publish(channel, message)
  }

  async subscribe<T extends Serializable>(
    channel: string,
    handler: SubscribeHandler<T>
  ): Promise<void> {
    return await this.driver.use(this.transport).subscribe(channel, handler)
  }

  async unsubscribe(channel: string): Promise<void> {
    return await this.driver.use(this.transport).unsubscribe(channel)
  }
}
