// SPDX-License-Identifier: Apache-2.0
import type {
  NavigationBackBuilder, NavigationBackResult, NavigationBackSuccessHandler,
  NavigationBuilder, NavigationCallbackExecution, NavigationFailHandler, NavigationResult, NavigationSuccessHandler, NavigationUrlBuilder,
  RouteDefinition, RoutePath, RouteTable,
} from './types.js'

/** 链式外观只保存配置，具体路由校验和平台动作仍交给 Router。 */
export type NavigationAction = 'go' | 'replace' | 'reLaunch'

/** 使用无效的等待签名同时阻止 TypeScript 等待与运行时 Promise 同化。 */
const callbackExecution: NavigationCallbackExecution = Object.freeze({
  /** JavaScript 或类型断言绕过检查时，明确拒绝混用回调和 await。 */
  then(_onfulfilled: never): never {
    throw new TypeError('已注册 success 或 fail 的导航不能使用 await；请移除回调后等待执行结果')
  },
})

/** 回调模式内部消费异步任务，只向调用方提供不可等待的执行标记。 */
function executeNavigation<Result>(
  withCallbacks: boolean,
  run: () => Promise<Result>,
  logError: (error: unknown) => void,
): Promise<Result> | NavigationCallbackExecution {
  const pending = run()
  if (!withCallbacks) return pending
  void pending.catch(logError)
  return callbackExecution
}

/** 单条导航链持有独立参数和回调，派生分支不会修改父链。 */
interface NavigationState {
  /** 已复制的参数快照，运行时非法输入仍交给 Router 拒绝。 */
  params?: unknown
  /** 区分未配置参数与显式传入非法空值。 */
  hasParams: boolean
  /** 注册过任意回调后，当前分支不再返回可等待结果。 */
  withCallbacks: boolean
  /** 本条链的成功回调。 */
  success?: NavigationSuccessHandler
  /** 本条链的失败回调。 */
  fail?: NavigationFailHandler
}

/** 内部结构与实际暴露能力一致，公共泛型在出口按路由契约收窄。 */
interface RuntimeNavigationBuilder {
  /** 派生带成功回调的新链。 */
  success(handler: NavigationSuccessHandler): RuntimeNavigationBuilder
  /** 派生带失败回调的新链。 */
  fail(handler: NavigationFailHandler): RuntimeNavigationBuilder
  /** 仅有参数的普通页面提供此方法。 */
  params?(values: unknown): RuntimeNavigationBuilder
  /** 参数就绪后打开目标页。 */
  go?(): Promise<NavigationResult> | NavigationCallbackExecution
  /** 参数就绪后替换当前页。 */
  replace?(): Promise<NavigationResult> | NavigationCallbackExecution
  /** 参数就绪后重建页面栈。 */
  reLaunch?(): Promise<NavigationResult> | NavigationCallbackExecution
}

/** 路径与完整 URL 共用不可变链和回调执行规则，构建阶段不访问平台。 */
function createNavigationChain(
  route: RouteDefinition | undefined,
  navigate: (params: unknown, action: NavigationAction) => Promise<NavigationResult>,
  logError: (error: unknown) => void,
): RuntimeNavigationBuilder {
  /** 根据参数就绪状态组装可用方法，所有方法均可解构调用。 */
  function build(state: NavigationState): RuntimeNavigationBuilder {
    /** 导航与业务回调分别捕获错误，成功回调失败时不触发 fail。 */
    async function run(action: NavigationAction): Promise<NavigationResult> {
      const result = await navigate(state.params, action)
      try {
        if (result.ok) await state.success?.(result)
        else await state.fail?.(result.error)
      } catch (cause) { logError(cause) }
      return result
    }

    /** 必填参数未设置时不暴露执行方法，未知路径在执行阶段统一报告。 */
    const ready = state.hasParams || !route || !Object.values(route.params).some((rule) => rule.required)
    return Object.freeze({
      /** 回调只影响派生链，可先注册回调再设置参数。 */
      success(handler: NavigationSuccessHandler) { return build({ ...state, success: handler, withCallbacks: true }) },
      /** 重复注册同类回调时替换当前链的旧回调。 */
      fail(handler: NavigationFailHandler) { return build({ ...state, fail: handler, withCallbacks: true }) },
      ...(route?.kind === 'page' && Object.keys(route.params).length ? {
        /** 当前契约只接受标量，浅复制即可隔离调用方后续修改。 */
        params(values: unknown) {
          const snapshot = values && typeof values === 'object' && !Array.isArray(values)
            ? Object.freeze({ ...values }) : values
          return build({ ...state, params: snapshot, hasParams: true })
        },
      } : {}),
      ...(ready ? {
        /** 每次执行都发起一次独立导航。 */
        go() { return executeNavigation(state.withCallbacks, () => run('go'), logError) },
        /** 普通页面替换当前页，Tab 行为由 Router 统一选择。 */
        replace() { return executeNavigation(state.withCallbacks, () => run('replace'), logError) },
        /** 重建页面栈，Tab 行为仍由 Router 统一选择。 */
        reLaunch() { return executeNavigation(state.withCallbacks, () => run('reLaunch'), logError) },
      } : {}),
    })
  }

  return build({ hasParams: false, withCallbacks: false })
}

/** 按页面种类与必填参数裁剪方法，公共泛型与运行时能力保持一致。 */
export function createNavigationBuilder<R extends RouteTable, P extends RoutePath<R>>(
  path: P,
  route: RouteDefinition | undefined,
  navigate: (path: string, params: unknown, action: NavigationAction) => Promise<NavigationResult>,
  logError: (error: unknown) => void,
): NavigationBuilder<R, P> {
  return createNavigationChain(route, (params, action) => navigate(path, params, action), logError) as NavigationBuilder<R, P>
}

/** URL 在执行时解析，因此始终提供终结方法，但不开放参数配置。 */
export function createNavigationUrlBuilder(
  navigate: (action: NavigationAction) => Promise<NavigationResult>,
  logError: (error: unknown) => void,
): NavigationUrlBuilder {
  return createNavigationChain(undefined, (_params, action) => navigate(action), logError) as NavigationUrlBuilder
}

/** 返回操作独立于页面契约，沿用不可变回调配置和显式执行语义。 */
export function createNavigationBackBuilder(
  navigate: () => Promise<NavigationBackResult>,
  logError: (error: unknown) => void,
): NavigationBackBuilder {
  /** 每次注册回调都返回独立分支，不改变既有返回链。 */
  function build<WithCallbacks extends boolean>(
    withCallbacks: WithCallbacks,
    success?: NavigationBackSuccessHandler,
    fail?: NavigationFailHandler,
  ): NavigationBackBuilder<WithCallbacks> {
    /** 回调异常只记录诊断，不改变已经完成的原生返回结果。 */
    async function run(): Promise<NavigationBackResult> {
      const result = await navigate()
      try {
        if (result.ok) await success?.(result)
        else await fail?.(result.error)
      } catch (cause) { logError(cause) }
      return result
    }
    return Object.freeze({
      /** 替换当前分支的成功回调。 */
      success(handler: NavigationBackSuccessHandler) { return build(true, handler, fail) },
      /** 替换当前分支的失败回调。 */
      fail(handler: NavigationFailHandler) { return build(true, success, handler) },
      /** 执行时按当前分支的回调模式选择返回类型。 */
      go() { return executeNavigation(withCallbacks, run, logError) },
    }) as NavigationBackBuilder<WithCallbacks>
  }
  return build(false)
}
