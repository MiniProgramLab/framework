#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/** 先准备本地 CLI，再动态加载编译入口，支持没有 dist 的首次启动。 */
import './register.mjs'

await import('../dist/bin/miniprogram.js')
