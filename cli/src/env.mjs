/** 分层加载小程序编译环境，仅向产物注入明确声明的公开配置。 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'dotenv'

/** 读取不存在时可跳过的环境文件，其他文件错误正常上抛。 */
async function readOptional(filename) {
  try {
    return parse(await readFile(filename))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

/** 优先级：通用文件、通用本机文件、指定环境、指定环境本机文件、系统环境变量。 */
export async function loadEnvironment(root, mode) {
  if (!/^[a-z][a-z0-9-]*$/.test(mode))
    throw new Error('编译环境名称只能包含小写字母、数字和连字符')
  let variables = {}
  for (const name of [
    '.env',
    '.env.local',
    '.env.' + mode,
    '.env.' + mode + '.local',
  ]) {
    variables = { ...variables, ...(await readOptional(path.join(root, name))) }
  }
  for (const key of ['WX_APP_API_BASE_URL', 'WX_APP_TITLE', 'WX_APP_ID']) {
    if (process.env[key] !== undefined) variables[key] = process.env[key]
  }
  const apiBaseUrl = variables.WX_APP_API_BASE_URL || ''
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
    public: {
      mode,
      apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
      title: variables.WX_APP_TITLE || '小程序',
    },
    appid: variables.WX_APP_ID || 'touristappid',
  }
}
