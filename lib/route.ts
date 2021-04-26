import { match } from 'path-to-regexp'

type NonFunctionPropertyNames<T> = {
  // eslint-disable-next-line
  [K in keyof T]: T[K] extends Function ? never : K
}[keyof T]
type NonFunctionProperties<T> = Pick<T, NonFunctionPropertyNames<T>>
type FunctionPropertyNames<T> = {
  // eslint-disable-next-line
  [K in keyof T]: T[K] extends Function ? K : never
}[keyof T]
type FunctionProperties<T> = Pick<T, FunctionPropertyNames<T>>

type RouteHeaders = Record<string, string>
type AuthFunction<T, Context> = (
  params: T,
  headers: RouteHeaders
) => Context | null
type State<Interface> = NonFunctionProperties<Interface>
type GetInitialState<RouteParams, Context, Interface> = (arg: {
  params: RouteParams
  context: Context
}) => Promise<State<Interface>>

type ClientFuncThis<RouteParams, Context, Interface> = ThisType<{
  params: RouteParams
  context: Context
  state: NonFunctionProperties<Interface>
}>
type ClientFunctions<
  RouteParams,
  Context,
  Interface
> = FunctionProperties<Interface> &
  ClientFuncThis<RouteParams, Context, Interface>

interface StateHandler {
  commandList: unknown[]
  state: Record<string, unknown>
}
type ServerSideFunc = (...args: unknown[]) => Promise<unknown[]>

export interface Route<
  // eslint-disable-next-line
  Context = any,
  // eslint-disable-next-line
  RouteParams = any,
  Interface = unknown
> {
  matchPath(path: string): RouteParams | null
  auth(
    params: RouteParams,
    headers: RouteHeaders
  ): null | {
    channel: string | undefined
    context: Context
  }
  initializeFunctions(stateHandler: StateHandler): void
  getInitialState: GetInitialState<RouteParams, Context, Interface>
  getFunction(
    thisArg: ClientFuncThis<RouteParams, Context, Interface>,
    stateHandler: StateHandler,
    functionName: string
  ): ServerSideFunc | undefined
}

export type RouteCreator<Interface, RouteParams> = <Context>(
  auth: AuthFunction<RouteParams, Context>,
  getInitialState: GetInitialState<RouteParams, Context, Interface>,
  clientFunctions: ClientFunctions<RouteParams, Context, Interface>
) => Route<Context, RouteParams>

export default function createRoute<Interface, RouteParams>(
  pathSkeleton: string,
  getChannel: (params: RouteParams) => string | undefined,
  stateTemplate: State<Interface>
): RouteCreator<Interface, RouteParams> {
  return <Context>(
    auth: AuthFunction<RouteParams, Context>,
    getInitialState: GetInitialState<RouteParams, Context, Interface>,
    clientFunctions: ClientFunctions<RouteParams, Context, Interface>
  ) => {
    return {
      matchPath(path: string) {
        const fn = match(pathSkeleton, { decode: decodeURIComponent })
        const result = fn(path)
        if (result) {
          const params = (result.params as unknown) as RouteParams
          return params
        } else {
          return null
        }
      },
      auth(params: RouteParams, headers: RouteHeaders) {
        let context
        try {
          context = auth(params, headers)
          if (!context) {
            return null
          }
        } catch (error) {
          console.error('Auth failed', error)
          return null
        }

        const channel = getChannel(params)
        return {
          channel,
          context,
        }
      },
      initializeFunctions(stateHandler: StateHandler) {
        function parseKey(
          getStructure: () => {
            command: Record<string, unknown>
            parent: Record<string, unknown>
          },
          objectName: string,
          object: Record<string, unknown>
        ) {
          const getFunction = (funcName: string) => {
            return function (...args: unknown[]) {
              const { command, parent } = getStructure()
              parent[objectName] = [funcName, args]
              stateHandler.commandList.push(command)
            }
          }

          Object.getOwnPropertyNames(Object.getPrototypeOf(object)).forEach(
            (funcName) => {
              if (typeof object[funcName] === 'function') {
                object[funcName] = getFunction(funcName)
              }
            }
          )
          Object.keys(object).forEach((key) => {
            const property = object[key]
            if (typeof property === 'function') {
              object[key] = getFunction(key)
            } else if (typeof property === 'object') {
              parseKey(
                () => {
                  const { command, parent } = getStructure()
                  const newParent = {}
                  parent[objectName] = newParent
                  return { command, parent: newParent }
                },
                key,
                object[key] as Record<string, unknown>
              )
            } else {
              console.warn('unknown property', typeof property)
            }
          })
        }

        const state = JSON.parse(JSON.stringify(stateTemplate))
        Object.entries(state).forEach(([key, value]) => {
          parseKey(
            () => {
              const obj = {}
              return {
                command: obj,
                parent: obj,
              }
            },
            key,
            value as Record<string, unknown>
          )
        })

        stateHandler.state = state
      },
      getInitialState,
      getFunction(
        thisArg: ClientFuncThis<RouteParams, Context, Interface>,
        stateHandler: StateHandler,
        functionName: string
      ): ServerSideFunc | undefined {
        const fNullable = (clientFunctions as Record<string, ServerSideFunc>)[
          functionName
        ]
        if (!fNullable) {
          return undefined
        }
        const f = fNullable

        async function fWithContext(...args: unknown[]): Promise<unknown[]> {
          await f.apply(thisArg, args)
          const { commandList } = stateHandler
          stateHandler.commandList = []
          return commandList
        }

        return fWithContext
      },
    }
  }
}
