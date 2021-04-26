import WebSocket from 'ws'
import { Server as HTTPServer } from 'http'
import { Route } from './route'
import Queue from './queue'

export interface ChannelManager {
  post(channel: string, message: string): void
  addListener(client: WebSocket, channel: string): number
  removeListener(client: WebSocket, channel: string): void
}

interface WsContext {
  route: Route
  routeParams: Record<string, string>
  channel: string
  context: unknown
  channelManager: ChannelManager
}

interface Configuration {
  pathPrefix: string
  httpServer: HTTPServer
  channelManager: ChannelManager
}

interface Server {
  use: (route: Route) => void
}

export default function server(configuration: Configuration): Server {
  const wss = new WebSocket.Server({ noServer: true })
  wss.on('connection', async (ws, request) => {
    const { wsContext } = (request as unknown) as {
      wsContext: WsContext
    }
    const stateHandler = {
      commandList: [],
      state: {},
    }
    wsContext.route.initializeFunctions(stateHandler)
    const id = wsContext.channelManager.addListener(ws, wsContext.channel)

    ws.on('close', () => {
      wsContext.channelManager.removeListener(ws, wsContext.channel)
    })

    const queue = new Queue()
    ws.on('message', (data) => {
      queue.post(async () => {
        const [func, args] = Object.entries(JSON.parse(data as string))[0]
        const f = wsContext.route.getFunction(
          // Check route.ts/ClientFuncThis
          {
            params: wsContext.routeParams,
            context: wsContext.context,
            state: stateHandler.state,
          },
          stateHandler,
          func
        )
        if (f) {
          const commands = await f(...(args as unknown[]))
          wsContext.channelManager.post(
            wsContext.channel,
            JSON.stringify({
              c: commands,
              i: id,
            })
          )
        } else {
          console.error('Function', func, 'not found')
          ws.close()
        }
      })
    })

    ws.send(
      JSON.stringify({
        s: await wsContext.route.getInitialState({
          context: wsContext.context,
          params: wsContext.routeParams,
        }),
        i: id,
      })
    )
  })

  const routes: Route[] = []
  configuration.httpServer.on('upgrade', (request, socket, head) => {
    const path = request.url.substring(configuration.pathPrefix.length - 1)
    for (const route of routes) {
      const params = route.matchPath(path)
      if (params) {
        const authResult = route.auth(params, request.headers)
        if (authResult) {
          wss.handleUpgrade(request, socket, head, (ws) => {
            request.wsContext = {
              route,
              routeParams: params,
              ...authResult,
              channelManager: configuration.channelManager,
            }
            wss.emit('connection', ws, request)
          })
        } else {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
          socket.destroy()
        }
        return
      }
    }

    socket.write('HTTP/1.1 404 Not found\r\n\r\n')
    socket.destroy()
  })

  return {
    use(route: Route) {
      routes.push(route)
    },
  }
}
