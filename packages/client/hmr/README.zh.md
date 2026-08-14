# @deepseek-ai/dsh-client-hmr

[English](README.md) | 中文

为通过脚本加载的客户端插件提供热重载。Web 与 desktop 组合包都会无条件挂载该行；没有重建 watcher 改写客户端 bundle 时，轮询观察不到变化，链路保持空闲。`pnpm dev:desktop` 会自行启动该 watcher；单独启动的 Web 应用则使用 `pnpm dev:web`。

Web 浏览器侧订阅系统 SSE（Server-Sent Events）通道（`GET /plugins/events`）；Electron 侧通过 preload manifest 方法轮询同一份可变客户端模块图。两个载体都会把发生变化的插件逐个提交到同一条串行重载队列。每次变更的顺序是：`invalidate`、`prefetch`（旧 fiber 仍在服务时加载并注册新组合包）、`registry.delete`（在 fiber dispose（资源释放）之前执行：仅 dispose fiber 会触发 vendored Loader 的 self-dispose 分支，把配置项标为禁用）、排空旧 fiber、删除 `entry.fiber`、移除自身拥有的 `<style data-plugin>` 标签、通过 `entry.refresh()` 重新导入并挂载、通过 `fiber.await()` 直接重新抛出启动失败。依赖方由 Cordis 自身重载：fiber 的激活 epoch 会串联其服务提供方的 uid，因此替换提供方 fiber 会级联所有依赖方，无需客户端图分析。node 侧使用一个 interval 检测重建：从同步基线开始 stat-poll 每个图组合包；新增一行后立即重新计算 hash；缺失行保持 dirty；只发布真实 rev 变更。因此，任何生成组合包的 tsdown watch 进程都能触发 HMR（热模块替换），无需 builder→host 通道。

## 模型体验

无。重载驱动器属于浏览器侧机制；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **重载有意保持粗粒度**：会创建全新的 fiber 和组件；重载插件中的 React 状态会丢失，数据层（连接 fiber、运行时 fiber 和 Session 对象）不受影响。react-refresh 级状态保留与「重新执行组合包会重新运行 factory」冲突，因此有意排除。
- **失败时不回滚**：失败的重载会使配置项处于 FAILED 状态，并在 loader 状态投影中显示；系统不会自动恢复先前组合包。
- **重载期间启动图中的 row 保持固定**：其中陈旧的 rev query 是缓存键，而不是 bundle 字节版本锁；Web 与 Electron bundle 载体都会以 `no-cache` 提供当前已注册的 bundle。重新连接或 renderer 再次启动时会读取当前图。
- **会话输入区恢复仍不完整**：重载 `ui-conversation` 会更新其渲染内容，但可能使 Hero 输入区缺失。该行为属于 Web／Electron 共用的 fiber 交换路径；重启 renderer 可以恢复。
