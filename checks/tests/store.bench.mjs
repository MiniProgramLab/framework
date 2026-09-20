// SPDX-License-Identifier: Apache-2.0
/** 对比单字段更新的写时复制与整树复制成本；仅为本机基准，不作为不稳定的时间门禁。 */
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { harness, runtime } from './store-test-utils.mjs'

/** 大列表保持不变，以模拟更新加载状态时已有业务数据的成本。 */
const seed = {
  count: 0,
  nested: { count: 0 },
  rows: Array.from({ length: 2000 }, (_, id) => ({
    id,
    label: '已有数据' + id,
    value: id * 2,
  })),
}
/** 每轮次数固定，预热后取多轮中位数，减轻 JIT 和调度噪声。 */
const iterations = 1500

/** 预热后测量同一操作，返回每轮总毫秒数的中位数。 */
function measure(operation) {
  for (let index = 0; index < 100; index += 1) operation()
  const samples = []
  for (let round = 0; round < 5; round += 1) {
    const start = performance.now()
    for (let index = 0; index < iterations; index += 1) operation()
    samples.push(performance.now() - start)
  }
  return samples.sort((a, b) => a - b)[2]
}

/** 对照组同样隔离可变引用并冻结快照，每次复制完整数据树。 */
function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezeTree(item)
    Object.freeze(value)
  }
  return value
}
let copied = freezeTree(structuredClone(seed))
const fullCopy = measure(() => {
  const next = structuredClone(copied)
  next.count += 1
  copied = freezeTree(next)
})
const kernel = runtime.createStoreRoot(() => seed, runtime.storePlugins())
const store = kernel.connectGlobal(() => true).store
let state
store.on(
  (next) => {
    state = next
  },
  { immediate: true },
)
const rows = state.rows
const patch = measure(() => store.update({ count: state.count + 1 }))
const draft = measure(() =>
  store.update((next) => {
    next.nested.count += 1
  }),
)
assert.equal(state.rows, rows)

/** 大量响应者共享每笔提交的同一快照，不按订阅者数量复制状态。 */
const fanoutKernel = runtime.createStoreRoot(() => seed, runtime.storePlugins())
const producer = fanoutKernel.connectGlobal(() => true).store
const references = new Set()
for (let index = 0; index < 200; index += 1)
  fanoutKernel
    .connectGlobal(() => true)
    .store.on((next) => references.add(next))
producer.update({ count: 1 })
assert.equal(references.size, 1)

/** 自动模板推送合并一次同步突发更新，业务响应仍逐笔执行。 */
const env = harness()
const page = env.mount({ globalStore: true }, 'bench', { isPage: true })
let responses = 0
page.instance.$globalStore.on(() => {
  responses += 1
})
await Promise.resolve()
page.instance.writes.length = 0
for (let index = 0; index < 100; index += 1)
  page.instance.$globalStore.update({ theme: index % 2 ? 'light' : 'dark' })
await Promise.resolve()
assert.equal(responses, 100)
// 最终值回到已渲染值时无需跨线程传输。
assert.equal(page.instance.writes.length, 0)
const burstResponses = responses
const burstViewWrites = page.instance.writes.length
page.instance.$globalStore.update({ theme: 'dark' })
await Promise.resolve()
assert.deepEqual(page.instance.writes, [{ '$globalStore.theme': 'dark' }])
console.log(
  JSON.stringify(
    {
      environment: 'Node ' + process.version + '，本机进程基准，不代表真机帧率',
      rows: seed.rows.length,
      iterations,
      medianMs: {
        fullCopy: Number(fullCopy.toFixed(2)),
        patch: Number(patch.toFixed(2)),
        draft: Number(draft.toFixed(2)),
      },
      speedup: {
        patch: Number((fullCopy / patch).toFixed(1)),
        draft: Number((fullCopy / draft).toFixed(1)),
      },
      unchangedRowsReused: state.rows === rows,
      snapshotsFor200Subscribers: references.size,
      burstResponses,
      burstViewWrites,
      subsequentChangeViewWrites: page.instance.writes.length,
    },
    null,
    2,
  ),
)
