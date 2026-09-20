// SPDX-License-Identifier: Apache-2.0
import { errorCode } from './logger.js'
/** 分层加载小程序编译环境，仅向产物注入明确声明的公开配置。 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'dotenv'
import type { PlatformAdapter, PublicEnvironment } from './types.js'
import { resolvePlatform } from './platforms.js'

/** 读取不存在时可跳过的环境文件，其他文件错误正常上抛。 */
async function readOptional(filename: string) {
  try {
    return parse(await readFile(filename))
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return {}
    throw error
  }
}

/** 优先级：通用文件、通用本机文件、指定环境、指定环境本机文件、系统环境变量。 */
export async function loadEnvironment(root: string, mode: string, platform: string | PlatformAdapter = 'wechat') {
  if (!/^[a-z][a-z0-9-]*$/.test(mode))
    throw new Error('编译环境名称只能包含小写字母、数字和连字符')
  let variables: Record<string, string> = {}
  for (const name of [
    '.env',
    '.env.local',
    '.env.' + mode,
    '.env.' + mode + '.local',
  ]) {
    variables = { ...variables, ...(await readOptional(path.join(root, name))) }
  }
  const adapter = resolvePlatform(platform)
  /** 系统变量优先于文件，平台变量优先于同层的通用变量。 */
  function value(name: string) {
    const specific = adapter.envPrefix + '_APP_' + name
    const shared = 'MINIPROGRAM_APP_' + name
    return process.env[specific] ?? process.env[shared] ?? variables[specific] ?? variables[shared]
  }
  const apiBaseUrl = value('API_BASE_URL') || ''
  const parsedUrl = apiBaseUrl ? new URL(apiBaseUrl) : null
  if (
    parsedUrl && (!['http:', 'https:'].includes(parsedUrl.protocol) ||
    parsedUrl.search ||
    parsedUrl.hash)
  ) {
    throw new Error('API 地址必须是无查询参数的 HTTP 或 HTTPS 地址')
  }
  if (parsedUrl && mode !== 'development' && parsedUrl.protocol !== 'https:') {
    throw new Error('非开发环境请配置 HTTPS API 地址')
  }
  return {
    adapter,
    public: {
      mode, platform: adapter.id,
      apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
      title: value('TITLE') || '小程序',
    },
    appid: value('ID') || '',
  }
}

/** 配置文件与运行时脚本共用同一组公开编译常量。 */
export function environmentDefines(environment: PublicEnvironment, platform: string | PlatformAdapter = 'wechat') {
  const adapter = resolvePlatform(platform)
  return {
    __MINIPROGRAM_ENV__: JSON.stringify(environment),
    __MINIPROGRAM_PLATFORM__: JSON.stringify(adapter.id),
    [adapter.envGlobal]: JSON.stringify(environment),
  }
}
