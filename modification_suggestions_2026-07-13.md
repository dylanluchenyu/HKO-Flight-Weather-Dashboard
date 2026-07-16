# 2026-07-13 仪表板评审修改意见

## 1. 文档范围

- 来源：`high-resolution wind forecast and flight impact assessment_2026-07-13_11-01-49.pdf`
- 补充参照：原始 Google Doc / brief 中对未来 `6/12/18/24 hours` 内全部出港目的地、入港始发地和天气匹配的需求。
- 目标：将 2026 年 7 月 13 日长页评审稿中的全部批注整理为可讨论、可实施、可验收的修改清单。
- 本文仅整理修改要求，不代表所有统计定义和展示方案已经由评审人最终确认。

## 2. 实施前必须确认的口径

### 2.1 出港航班的 `en route`

评审人将 `en route` 理解为“在当前时刻已经在空中的航班数量”，并询问出港场景中 `Flights estimated en route` 的数值是如何产生的。

需要确认：

1. 顶部卡片是否只统计当前时刻已经从香港起飞、仍在飞行的出港航班；
2. 还是统计所选时间范围内曾经或预计会处于飞行状态的航班；
3. 若数据并非来自实时航迹，必须在名称或说明中明确这是基于计划时刻和估算航程得到的预测值，而不是实时在空航班数。

建议修改：

- 在卡片旁增加定义提示或信息图标；
- 若统计的是当前时刻，建议使用 `Estimated outbound flights currently en route`；
- 若统计的是窗口内航班，名称必须包含 `selected window`，避免被理解为当前快照；
- 在方法说明中列出估算公式、使用的时刻、航程假设和数据限制。

### 2.2 `within 100 km of HK`

评审人询问顶部的 `2 En-route flights within 100km of HK` 是否表示两班航班刚刚从香港起飞、当前仍在香港机场 100 km 范围内。

需要确认并展示：

1. 该数值是否只统计已经起飞的航班；
2. 出港航班是否表示“从香港起飞后，估算位置距香港不超过 100 km”；
3. 入港航班是否表示“正在飞往香港且估算位置距香港不超过 100 km”；
4. `both directions` 时是否合并以上两类；
5. 这是实时位置还是基于计划时刻、航程和距离的估算。

建议把标签改为方向明确的文字，并为数字增加可展开说明。例如出港模式使用：

> Estimated airborne departures within 100 km of HK

### 2.3 `priority airport` 与原始需求的关系

原始 brief 的需求不是只查看少数 priority airports，而是：

1. 在未来 `6/12/18/24 hours` 内，找出所有从香港出发的客运/货运航班目的地机场；
2. 在未来 `6/12/18/24 hours` 内，找出所有飞抵香港的客运/货运航班始发机场；
3. 将这些目的地/始发地机场直接匹配 `report/forecast bad weather`；
4. 展示由以上航班识别出的潜在航迹（en route）。

因此，`priority airport` 不应被写成业务侧只关心部分机场的定义。它更适合解释为当前实现中的天气查询优先级或覆盖范围：在完整航班/机场列表基础上，为了 METAR/TAF 接口性能，按当前方向、当前时间窗口内的航班量排序后优先查询天气。

需要确认并在界面中写清楚：

- 完整航班统计、机场榜单和区域分布必须基于 `ALL passenger/cargo flights` 和全部可识别 route airports；
- `priority airport` 只限制实时天气查询覆盖范围，不应限制航班统计和目的地/始发地列表；
- 排名应随顶部时间范围（如 `+6h`、`+12h`、`+18h`、`+24h`）和方向同步变化；
- 排名依据应为当前方向、航班类型和时间范围内的航班量；
- HKG 是否固定纳入天气查询集合；
- `72` 和 `45` 是 METAR/TAF 查询上限或性能限制，不是原始 brief 的业务需求；
- 顶部的 `Priority airports with reported weather` 数字使用 METAR、TAF，还是两者的并集。

建议修改：

- 把 UI 文案从业务式的 `Priority airports` 改为覆盖范围式的 `Weather queried route airports` 或 `Top route airports checked for weather`；
- 在界面中说明：`Weather is queried for the top N route airports by flight count; all route airports remain included in flight totals and rankings.`
- 将“完整航班/机场统计”和“METAR/TAF 查询覆盖上限”分开显示；
- 如果有机场因查询上限未取到实时天气，应显示为 `Not queried` 或 `Weather not queried due to coverage limit`，避免被误读为 `No reported weather`；
- 如果列表会随时间范围变化，应在切换时间范围后同步重排，并在标题中显示当前窗口。

### 2.4 天气阈值中的单位

评审批注要求重点展示以下 TAF 天气：

1. 阵风超过 30 kt；
2. 雷暴；
3. 阵雨；
4. 能见度低于 `3000 feet`。

其中第 4 项需要先确认。TAF 的水平能见度通常不是用 feet 表示；feet 更常用于云底高度。实施前应向评审人确认其真实意图是：

- 能见度低于 3000 m；还是
- 云底高度低于 3000 ft。

在口径确认前，不应把 `3000 feet` 直接写入天气筛选逻辑。

## 3. 顶部图表与摘要卡片

### 3.1 解释 `reported weather`

评审人询问 `reported weather` 是仅指 METAR 已观测天气，还是也包含 TAF 预报天气。

建议取消单独使用含义不清的 `reported weather`，改为明确区分：

- `METAR observed weather`：当前或最近一次实况观测；
- `TAF forecast weather`：对应有效时段内的预报；
- 若确实需要合并统计，使用 `Airports with METAR observations or TAF forecast weather`，并显示 METAR 数、TAF 数及去重后的机场总数。

所有卡片、表格、标签和说明应使用同一套定义。

### 3.2 时间范围联动

当前顶部选择为 `T(now) to +12`，但目的地榜单标题显示 `next 30h`。评审人要求所有 `next X hours` 与顶部时间范围保持一致。

修改要求：

- 顶部选择 `+12h` 时，榜单、摘要、天气匹配和卡片均显示并计算 `next 12h`；
- 切换到 `+6h`、`+18h`、`+24h` 或 `+30h` 时，所有相关模块同步更新；
- 不得只修改标题而沿用旧的 30 小时数据。

### 3.3 `T(now)` 的时间含义

评审人询问 `T(now)` 是时间桶的开始时刻还是结束时刻，以及该列是否代表“从现在起的 60 分钟”。

建议明确区分两类数据：

- 流量数据：使用区间标题，例如 `Now–+1h`、`+1h–+2h`；
- 状态快照：使用时点标题，例如 `As at now`、`As at +1h`。

如果同一列中同时存在流量和状态快照，应在表头或方法说明中分别解释，不能用一个模糊的 `T(now)` 同时代表区间和时点。

## 4. 目的地分区榜单

### 4.1 机场名称显示方式

评审人建议保留四字母机场代码，并用机场全名或城市名替换三字母代码。例如不再只显示 `TPE`，而显示 `Taipei`，同时保留 `RCTP`。

建议格式：

> `#1 Taipei · RCTP · 55 flights`

如果采用机场全名，应避免同城多机场产生歧义；必要时显示 `Taipei Taoyuan · RCTP`。

### 4.2 各区域默认显示 Top 10

评审人建议所有区域默认显示 `Top 10`，而不是当前的 Top 5 或数量不一致的列表。

修改要求：

- Greater China、Asia、Middle East、Oceania、America、Africa、Europe、Other 使用一致的默认上限；
- 不足 10 个机场时显示全部；
- 如页面高度受限，可默认展示 Top 10，并提供收起、展开或滚动方式；
- 标题中标明 `Top 10` 和当前时间范围。

## 5. Wallace Table

### 5.1 TAF 行的内容与呈现

评审人要求重新设计 TAF 行，使用实时获取的 TAF 信息，并参考 HKO/JMA 的呈现方式。

修改要求：

- TAF 行只展示 TAF 预报，不与当前 METAR 混合；
- 优先突出经确认后的重点条件：阵风超过 30 kt、雷暴、阵雨，以及待确认的低能见度或低云底条件；
- 保留原始天气代码、变化组和有效期，不能只显示二次解释；
- 同时提供简明释义，使用户无需自行解码全部缩写；
- 对没有重点天气、没有数据、数据过期等情况使用清楚且互斥的状态；
- 采用更适合时间轴阅读的布局，避免每个格子堆叠过多机场代码和变化组。

评审人提供的参考资料：

- HKO TAF 解码：<https://www.hko.gov.hk/en/aviat/taf_decode.htm>
- JMA TAF 展示示例：<https://www.data.jma.go.jp/airinfo/data/awfo_taf.html#contents_area2>
- JMA 航空气象资料：<https://www.jma.go.jp/jma/en/Activities/ATMetC_leaflet.pdf>

### 5.2 TAF 时间标签

评审人指出仪表板当前时间可能不是整点，而 TAF 的有效期表达按固定时段组织，因此建议 TAF 行采用 `~ +X` 一类的区间表达，以便大致看出恶劣天气将在何时出现。

建议修改：

- TAF 格子显示明确的起止时间或与时间桶的重叠关系；
- 不只显示单个 `+X` 时点；
- 优先显示真实有效期，例如 `18:00Z–20:00Z`，`~ +2h` 只作为辅助相对时间；
- 当一个预报组跨越多个时间桶时，使用连续条带或合并单元格表达，减少重复文字。

### 5.3 METAR 行

评审人认为当前天气只能由 METAR 表示，并建议在对应位置放置 METAR 信息。

修改要求：

- 当前时刻或最近观测使用独立的 `METAR observed weather` 行；
- 显示观测时间、机场、原始天气代码和简明释义；
- 不用 TAF 内容补充或替代“当前天气”；
- 若 METAR 已过期或缺失，应显示时间和数据状态，不得把缺失解释为无天气。

### 5.4 表格阅读说明

评审人多次询问表格如何解读，说明目前的行名、数字和时间维度不够自解释。

建议在表格上方增加常驻简要说明，并提供可展开的 `How to read this table`，至少解释：

1. 每一列是时间区间还是时间点；
2. 每一个数字代表航班数、机场数还是天气事件数；
3. 各行是当前快照、预测快照还是时间段累计值；
4. 方向筛选如何改变“出发地机场”和“目的地机场”的含义；
5. 数据是实时位置、计划时刻推算还是天气报告匹配；
6. 缺失值、0 和无天气报告分别代表什么。

### 5.5 航班状态行的名称和定义

评审人对以下内容提出疑问：

- `on ground at HKIA to Greater China` 中的上百个数字如何理解；
- `within 100km of HK to Greater China` 是否表示“已在空中、距香港 100 km 内、目的地为大中华区”的出港航班；
- 行名和数值的关系不够直观。

建议修改：

- 出港模式下改成完整、方向明确的标签，例如：
  - `Outbound to Greater China — estimated en route`；
  - `Outbound to Greater China — still on ground at HKIA`；
  - `Outbound to Greater China — estimated airborne within 100 km of HK`；
- 入港模式下使用与出港对应但不混淆的标签；
- `both directions` 模式可拆成 inbound/outbound 子行，或在数字旁分别显示两类构成；
- 在行名旁提供计算口径和一个具体示例；
- 如果数值是每个时点的状态快照，应明确写出 `estimated as at [time]`。

### 5.6 区域之间的视觉区分

评审人希望用更醒目的方式区分不同区域的数据，例如在区域组之间使用更清晰的分隔线。

修改要求：

- 每个区域使用组标题、较粗分隔线或轻微底色区分；
- 同一区域内保持一致，不要给每一行分配过多高饱和颜色；
- 分隔不能只依赖颜色，应同时使用间距、边框或标题，以兼顾可读性和无障碍要求。

## 6. `Flights Matched With Reported Weather` 模块

### 6.1 明确天气对应的机场

评审人询问这里显示的是出港航班出发地机场的天气，还是其他机场的天气。

建议使用方向相关的明确规则和文字：

- 出港：显示目的地机场天气；
- 入港：显示出发地机场天气；
- 双向：每张卡片明确标注 `Origin weather` 或 `Destination weather`；
- 如果 HKG 天气也参与匹配，应作为独立字段展示，不能与航线另一端机场混为一谈。

### 6.2 增加卡片阅读信息

评审人要求进一步说明如何读取该模块。

每张卡片建议至少显示：

- 航班号；
- 航向和相关机场全名/ICAO；
- 计划起飞或到达时间及 HKT/UTC；
- 天气来源：METAR 或 TAF；
- 报告/预报有效时间；
- 原始天气代码；
- 简明释义；
- 匹配原因。

模块标题也建议改为更准确的名称，例如：

> Flights with weather reported or forecast at the route airport

同时提供一句说明，明确这不是严重程度或运行影响评级。

## 7. `Next 6h / 12h / 18h / 24h / 30h` 摘要模块

### 7.1 说明 `reported-weather matches`

评审人询问 `reported-weather matches` 的含义。

需要在模块内明确：

- “match” 是机场存在 METAR 天气代码、TAF 预报天气代码，还是任一来源满足重点天气条件；
- 数字气泡代表航班数还是机场数；
- 同一机场的多个航班如何计数；
- 同一机场同时命中 METAR 和 TAF 时是否去重；
- 每个时间范围是累计窗口还是独立时间段。

建议避免继续使用无定义的 `reported-weather matches`。可按实际逻辑改为：

- `Flights matched to METAR observed weather`；
- `Flights matched to TAF forecast weather`；或
- `Route airports with observed/forecast weather`。

### 7.2 重新讨论摘要模块的呈现方式

评审人认可该模块的信息价值，但明确表示仍需讨论如何呈现。

下一版原型建议至少提供两种方案供确认：

1. 保留 6/12/18/24/30 小时并列卡片，但减少重复信息、加强层级；
2. 只展示顶部当前所选时间范围，其他时间范围通过切换器查看。

两种方案都必须解释机场名、数字、天气标签和时间窗口之间的关系。

## 8. 建议验收清单

- [ ] 顶部所有摘要卡片均有无歧义定义。
- [ ] `en route` 与 `within 100 km` 的方向、时点和估算属性已说明。
- [ ] 原始 brief 的 `ALL passenger/cargo flights` / 全部 route airports 统计口径，与 priority weather query / 72/45 查询上限已分开解释。
- [ ] 所有 `next X hours` 模块与顶部时间范围联动。
- [ ] 机场榜单显示全名或城市名，并保留四字母 ICAO 代码。
- [ ] 所有区域默认显示 Top 10，或经确认采用统一的替代方案。
- [ ] `T(now)`、`+1` 等列明确区分区间数据和时点快照。
- [ ] METAR 当前观测与 TAF 未来预报分行、分来源展示。
- [ ] TAF 重点天气阈值及 `3000` 的单位已经确认。
- [ ] TAF 有效期能在时间轴上直观看到。
- [ ] Wallace Table 提供简明阅读说明和各状态行定义。
- [ ] 不同区域之间有清晰、非纯颜色依赖的视觉分隔。
- [ ] 航班天气卡片明确天气对应出发地、目的地还是 HKG。
- [ ] `reported-weather matches` 已改为有明确定义的名称和计数规则。
- [ ] 6/12/18/24/30 小时摘要模块的最终呈现方案已由评审人确认。
