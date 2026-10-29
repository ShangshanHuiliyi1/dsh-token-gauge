# 额度 / 上下文余量 (`@local/dsh-token-gauge`)

两处显示，各自独立：

| 位置 | 内容 | 形态 |
| --- | --- | --- |
| 左侧栏「设置」上方（`sidebar.footer.action`） | 上次充值后已用额度 ÷ 上次充值后的总额度；当前峰/谷价与倒计时 | 蓝色进度条卡片 |
| 输入框上方（`conversation.input.dock`） | 当前会话上下文已用量 | 纯文字，无进度条、无占比、不显示剩余 |

## 安装

这是一个 DSH **bundle**（`package.json` 里声明了 `dsh.bundle.patch` 与 `dsh.client`），装进某个 profile 后两端同时生效：Host 半边是空壳，界面全在 Client 半边。

**方式一：从仓库安装（公开仓库，无需凭据）**

在 DSH 的插件页安装这个仓库地址，或让 Agent 用 `install_bundle` 指向它：

```
git+https://github.com/ShangshanHuiliyi1/dsh-token-gauge.git
```

安装动作会同时写两处，缺一不可：profile `package.json` 的 `dependencies`，以及 `dsh.profile.bundles`（只有列进 bundles 才会被组合加载）。

**方式二：本地目录安装**

```bash
git clone https://github.com/ShangshanHuiliyi1/dsh-token-gauge.git
# 然后把这个目录作为安装目标（Plugin Manager 的 install_bundle 支持目录路径）
```

**验证**：装好后侧栏底部「设置」上方应出现额度卡片；若没有，确认 profile 的 `cordis.patch.yml` 里有这一行（bundle 自带的 patch 会插入它）：

```yaml
- insert:
    - id: token-gauge
      name: '@local/dsh-token-gauge'
```

**依赖**：客户端半边声明了 `slots`、`locale`、`remote`、`remote.account`、`remote.session`。后两个是点号 Remote 命名空间，Cordis 对未声明的点号服务会**抛异常**而不是返回 `undefined`，所以缺账户域（`dsh-api-account-controller`）的 profile 里这个插件不会激活。

## 额度进度条（设置上方）

- **分母** = 上一次充值之后账户上的全部剩余额度（余额 + 赠送余额，取账户主币种）。
- **分子** = 上次充值之后到目前为止用掉的额度。
- **充值即重置**：只要账户余额比上次采样值变高（> 0.005），就当成一次充值，把当时的余额直接作为新的分母，进度条重新从 0% 开始。
- 悬停卡片可看到精确数字、占比与充值时间；**把鼠标停在「已用」或「剩余」的金额上**，提示会显示这笔钱相当于多少 tokens（见下）；点击卡片立即刷新余额。
- 填充色用 `--dsw-alias-brand-primary`（蓝色品牌色），到 75% 转警告色、90% 转错误色。
- 侧边栏折叠成 56px 竖条时，卡片自动收窄为「百分比 + 细进度条」；此时若桌面版把折叠态的底部区域整体隐藏，则不会显示。

## 当前价格与峰谷倒计时

卡片底部两行：

```
峰价 输入 ¥2 · 输出 ¥8 /M
2h13m 后转谷价
```

- **当前价**：按**部署默认模型**（从 `session.modelCatalog()` 的 `default.model` 读取，读不到则用 `deepseek-flash`）显示该模型在当前时段的输入/输出单价（每百万 tokens）；缓存命中价、完整价目与来源在悬停提示里。
- **模型名会归一化**：目录给的 id 可能是 `deepseek/deepseek-v4.1-flash`、`DeepSeek-V4.1-Flash-1017` 这类带 provider 前缀或带版本号的写法，卡片会依次按「去前缀 → 统一分隔符 → 精确匹配 → 包含匹配 → flash/pro 家族」映射到价目表的键；真的对不上才显示「价格未知」，且提示里会同时给出目录原名。
- **倒计时**：每秒重算，显示距离下一次峰↔谷切换还有多久；悬停可看到切换的具体时刻。
- **时段规则**（官方文档）：北京时间**周一至周五（不含法定节假日）9:00–12:00、14:00–18:00** 为高峰，其余时段（含周末与节假日全天）为空闲时段，**空闲价 = 高峰价的一半**。

内置价目（每百万 tokens，2026-10-28 取自官方文档）：

| 模型 | 档位 | 缓存命中输入 | 输入（未命中） | 输出 |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | 峰 | ¥0.04 | ¥2 | ¥8 |
| | 谷 | ¥0.02 | ¥1 | ¥4 |
| `deepseek-v4-pro` | 峰 | ¥0.30 | ¥9 | ¥27 |
| | 谷 | ¥0.15 | ¥4.5 | ¥13.5 |

**价格会变，节假日也需要日历**，所以支持不改代码覆盖——写 localStorage 键 `dsh.token-gauge.pricing`（与内置值深合并，`models` 合并、`peakWindows`/`holidays`/`model` 整体替换）：

```js
localStorage.setItem('dsh.token-gauge.pricing', JSON.stringify({
  model: 'deepseek-v4-pro',                 // 强制指定要显示哪个模型的价
  models: {                                 // 覆盖/新增模型（单位：元/百万 tokens）
    'deepseek-flash': { peak: { cacheHit: 0.04, input: 2, output: 8 }, offPeak: { cacheHit: 0.02, input: 1, output: 4 } }
  },
  peakWindows: [[9, 12], [14, 18]],         // 北京时间，[起, 止)
  holidays: ['2026-10-01', '2026-10-02']    // 全天按空闲价计的日期（YYYY-MM-DD，北京时间）
}));
```

注意：**默认 `holidays` 是空的**，即只把周六周日当空闲日；法定节假日需要你自己按当年日历补进去，否则那些天会被当作峰价。`peakWindows` 与 `holidays` 都用绝对时间判定，与本机时区无关（固定按 UTC+8 换算）。

### 为什么它不会压住工作区列表

早期版本把卡片做成「浮在页脚之上」的浮层，会盖住会话/工作区列表的最后几行。现在改成**占真实高度**：

- 注册项是一个**零宽**（但 `min-height` 撑高）的锚点，卡片贴在这段预留空间的底部，位置在 Cordis 徽标与 Settings 行之间；
- 侧栏的 `regionArea`（列表容器）本身是 `flex:1; min-height:0; overflow:hidden`，页脚变高它就让出对应高度，所以**列表只是变短，不会被覆盖**；
- 预留高度可用 CSS 变量调整，不用改代码：`--dsh-token-gauge-reserve`（展开态，默认 176px = Cordis 行 50px + 五行卡片约 118px + 间隙）、`--dsh-token-gauge-reserve-rail`（折叠态，默认 76px）。Cordis 徽标尺寸（`height:42px; margin-top:8px`）如因版本更新变化，调这两个值即可；
- 卡片保持**自然高度**（数字 / 进度条 / 占比·充值时间 / 当前价 / 倒计时）。曾经试过把高度压到 40px 并把占比与充值时间挪进悬停提示，结果进度条被裁掉、时间也不显示，已回退——宁可列表少一些高度，也不牺牲这些读数。

### 「相当于多少 tokens」是怎么算的

没有硬编码价目表，而是**自校准**：分子（本次充值后花掉的钱）÷ 同期观察到的计费 tokens = 账户实际均价，再用它换算「已用」和「剩余」两个数字。

- 计费 tokens 取自系统自带的 `tokenUsage` 投影：`session.list` 的缓存列已经把每个会话的 `uncachedInput + output + cacheRead + cacheWrite` 算好，插件只做求和（跨会话，和账户计费口径一致），不折叠日志。
- 充值会**同时重置价格窗口的两端**（钱和 tokens 都从充值那一刻重新起算）。
- 还没有可测量的消费时，提示会写「暂无法换算成 tokens」，而不是显示 0。
- 因为缓存命中的输入便宜得多，这是一个**账户级均价**，不是某个模型的标价；把它当量级参考即可。
- 旧版本存下的基准（没有 tokens 字段）会在第一次采样时把当前 tokens 总量作为窗口起点：此前的消费无法再对应到 tokens，所以均价从那一刻开始重新积累。

数据来自已完成注册的账户接口 `ctx.remote.account.getBalance`（与「设置 → 账户」页同一个调用）。每 2 分钟轮询一次（页面隐藏时跳过），并在窗口重新获得焦点时刷新。

**基准值存在浏览器 localStorage**（键 `dsh.token-gauge.credit`），所以刷新页面不会丢失基准。

若读不到余额，卡片会缩成一行文字告诉你原因：「额度不可用」（账号未登录 / 平台暂时不可用）或「额度服务不可用」（界面里没有账户服务）；鼠标悬停还能看到具体的失败代码（例如 `gateway/internal: ...`）。

> 实现要点：客户端半边的 `inject` 必须同时声明 `remote` 和点号命名空间 **`remote.account`**。Cordis 对未声明的点号服务是**抛异常**而不是返回 `undefined`，所以只写 `remote` 时 `ctx.remote.account` 会直接失败。官方账户插件同样是 `["slots","locale","remote","remote.account","remote.session", ...]`。

## 上下文一行（输入框上方）

直接读 `contextPressure` 投影的 `projectedTokens`，显示「上下文已用 ~235.7K tokens」，没有进度条、没有占比、也不显示剩余量；数值带 `~` 是因为它含有启发式估算成分。把鼠标停在这一行上，悬停提示里仍能看到窗口总量与占比（`~235.7K tokens / 1.0M (24%)`）。

单位文案走 locale（`context.unit`），中英文都写作 `tokens`。

## 已知边界

- 「已用额度」只能靠**余额差值**推出来：余额下降即视为消费。赠送额度过期等非消费变动也会被算作已用。
- 页面关闭期间的充值：重新打开页面后第一次采样余额变高，会被正确识别为充值（新基准 = 当前余额），但顶部那段时间里已经花掉的部分无法追溯，会从 0 开始重新计。
- 通过 API Key（而非登录账号）计费时账户余额不变，进度条会停在原处。
- 额度单位是账户货币（¥ / $），不是 token 数；token 用量只在上下文那一行体现。
- 卡片固定 216px 宽（侧栏内容宽度 264–420px），在页脚里占真实高度而非浮层，因此不随侧栏拖拽改变宽度、也不会遮住工作区列表。

## License

[MIT](./LICENSE) © shangshanhuiliyi

