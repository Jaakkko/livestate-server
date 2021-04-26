import WebSocket from 'ws'
import { ChannelManager } from './server'

const channels = new Map<string, Set<WebSocket>>()
const channelManager: ChannelManager = {
  post(channel: string, message: string) {
    channels.get(channel)?.forEach((client) => {
      client.send(message)
    })
  },
  addListener(client: WebSocket, channel: string) {
    let set = channels.get(channel)
    if (!set) {
      set = new Set()
      channels.set(channel, set)
    }
    set.add(client)
    return set.size
  },
  removeListener(client: WebSocket, channel: string) {
    const set = channels.get(channel)
    if (!set) {
      return
    }

    set.delete(client)
    if (set.size === 0) {
      channels.delete(channel)
    }
  },
}

export default channelManager
