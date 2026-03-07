# AESP 论文实验计划

> 目标：补充 Evaluation 章节，满足正规会议/期刊的审稿要求。
> 基于 review notes 的两个核心短板：(1) 缺少独立 Evaluation 章节；(2) 安全/隐私 Claim 偏非形式化。

---

## Research Questions

每个实验组对应一个明确的 RQ，论文中的 Evaluation 章节围绕这些 RQ 组织。

| RQ | 问题 | 对应实验 |
|----|------|---------|
| **RQ1** | Policy engine 能否在实际并发和策略复杂度下维持可接受的吞吐和尾部延迟？ | E1 |
| **RQ2** | WASM 密码操作的延迟/吞吐特征如何？fallback 路径的性能惩罚有多大？ | E2 |
| **RQ3** | Context-isolated 地址与 consolidation 策略引入多少额外开销？换取了多少隐私增益？ | E3 |
| **RQ4** | 随着策略违规率升高，人在回路的审批队列能否保持稳定？人类审批负担是否可控？ | E4 |
| **RQ5** | 在完整 agent 工作流中，AESP 的成功率、成本和延迟 tradeoff 如何？ | E5 |

---

## 总览

| 编号 | 实验组 | 对应代码模块 | 优先级 | 预估工作量 |
|------|--------|-------------|--------|-----------|
| E1 | PolicyEngine 性能评估 | `src/policy/engine.ts`, `budget.ts` | P0 | 2-3 天 |
| E2 | WASM Crypto 延迟基准 | `src/crypto/` | P0 | 1-2 天 |
| E3 | 隐私模块开销与链接性分析 | `src/privacy/` | P1 | 5-7 天 |
| E4 | Review Queue 负载分析 | `src/review/manager.ts` | P2 | 2 天 |
| E5 | 端到端 Case Study | 全模块 | P2 | 2-3 天 |
| — | Baselines & Ablations | 横跨 E1-E5 | P1 | 含在各实验中 |

总计约 2-3 周可产出完整 Evaluation 章节。

---

## E1: PolicyEngine 性能评估

> **RQ1**: Policy engine 能否在实际并发和策略复杂度下维持可接受的吞吐和尾部延迟？

### 代码基础

- `src/policy/engine.ts` — `PolicyEngine.checkAutoApprove()` 8 步检查链
- `src/policy/budget.ts` — `BudgetTracker` 日/周/月预算追踪

### Workload 因子

**策略复杂度**（4 档）:
- `P0`: 仅 amount limits
- `P1`: P0 + allowListAddresses + allowListChains
- `P2`: P1 + timeWindow + allowListMethods
- `P3`: P2 + requireReviewBeforeFirstPay + minBalanceAfter

**并发度**: `1 / 8 / 32 / 128`

**请求混合**:
- transfer-heavy: 70% transfer, 20% send_transaction, 10% sign
- balanced: 33% / 33% / 34%

### 子实验

#### 1a. 延迟分布

- **自变量**: 策略复杂度 (P0-P3)
- **因变量**: 单次 `checkAutoApprove()` 延迟 (p50 / p95 / p99)
- **方法**: 每组 10,000 次，`performance.now()` 记录
- **图表**: Box plot — X 轴为策略复杂度，Y 轴为延迟 (μs)

#### 1b. 吞吐量

- **自变量**: 并发数 (1 / 8 / 32 / 128) × 请求混合 (transfer-heavy / balanced)
- **因变量**: requests/sec
- **方法**: `Promise.all` 模拟并发批次
- **图表**: 折线图 — X 轴为并发数，Y 轴为吞吐量，两条曲线对应两种 mix

#### 1c. 策略规模扩展性

- **自变量**: 注册策略数量 (10 / 50 / 100 / 500)
- **因变量**: 检查延迟
- **方法**: 多个 provider 注册不同数量的 policy
- **图表**: 折线图 — X 轴为策略数，Y 轴为延迟

#### 1d. Budget Tracking 开销

- **自变量**: 时间周期切换频率
- **因变量**: reset + check 延迟
- **方法**: 模拟跨日/周/月边界的预算重置

#### 1e. 违规分布分析

- **指标**: auto-approve ratio, violation breakdown（哪一步失败）
- **方法**: 在 P3 复杂度下跑 10,000 请求，统计每步的拒绝比例
- **图表**: 堆叠柱状图 — 各步骤的违规占比

### 预期产出

- 延迟分布 box plot
- 吞吐量 vs 并发折线图
- 扩展性折线图
- 违规分布堆叠柱状图

---

## E2: WASM Crypto 延迟基准测试

> **RQ2**: WASM 密码操作的延迟/吞吐特征如何？fallback 路径的性能惩罚有多大？

### 代码基础

- `src/crypto/wasm-bridge.ts` — WASM 模块加载和接口
- `src/crypto/signing.ts` — `signMessage()`, `signWithXidentity()`, `verifyXidentitySignature()`, `signTypedData()`
- `src/crypto/hashing.ts` — SHA-256, policy/commitment hashing

### 子实验

#### 2a. 签名延迟

- **操作**: `signMessage()`
- **维度**: Ed25519 vs secp256k1
- **方法**: 每种曲线 5,000 次，记录 mean / p95 latency 和 ops/sec
- **图表**: Violin plot

#### 2b. 身份派生

- **操作**: `deriveAgentIdentity()`
- **维度**: BIP44 路径 index (0 / 10 / 100 / 1000)
- **方法**: 测量 key derivation + SHA-256(pubkey) 耗时
- **图表**: 折线图

#### 2c. EIP-712 签名

- **操作**: `signTypedData()`
- **维度**: Commitment payload 大小（字段数量递增）
- **方法**: 构造不同复杂度的 commitment
- **图表**: 柱状图

#### 2d. Xidentity 验证

- **操作**: `verifyXidentitySignature()`
- **维度**: 消息长度 (64B / 256B / 1KB / 4KB)
- **图表**: 折线图

#### 2e. 隐私地址派生

- **操作**: `evm_get_address_with_context()` / `solana_get_address_with_context()`
- **维度**: transparent / basic / isolated 模式
- **方法**: 各 1,000 次派生
- **图表**: 分组柱状图

#### 2f. 冷启动 vs 热启动

- **对比**: WASM 模块 `initWasm()` 首次加载 vs 已加载后
- **方法**: 首次签名 vs 后续签名的延迟差异
- **指标**: cold-start overhead, fallback slowdown factor (`fallback_latency / wasm_latency`)
- **图表**: 条形图

### 预期产出

- 多操作延迟对比柱状图
- WASM 冷启动 vs 热启动对比图
- WASM vs WebCrypto (SHA-256) fallback 对比图 + slowdown factor

---

## E3: 隐私模块开销与链接性分析

> **RQ3**: Context-isolated 地址与 consolidation 策略引入多少额外开销？换取了多少隐私增益？

### 代码基础

- `src/privacy/address-pool.ts` — `AddressPoolManager`，context-isolated 地址派生
- `src/privacy/consolidation.ts` — `ConsolidationScheduler`，jitter + 批次归集
- `src/privacy/context-tag.ts` — `ContextTagManager`，审计标签 + batching

### 子实验

#### 3a. 地址管理开销

- **对比项**: transparent vs basic vs isolated
- **指标**: 每笔交易的地址派生延迟、内存占用、地址生成数 / 1k tx
- **方法**: 模拟 1,000 笔交易在三种 privacy level 下的开销
- **图表**: 分组柱状图

#### 3b. Consolidation 模拟

- **自变量**: jitter ratio (0 / 0.15 / 0.3)，consolidation 模式 (immediate / threshold / jittered-batched)
- **因变量**: 归集交易数量、consolidation lag 分布、批次大小
- **方法**: 模拟 100 个 ephemeral 地址在不同策略下的归集行为
- **图表**: Consolidation lag CDF + 时间线散点图

#### 3c. Audit Batching 效率

- **对比项**: immediate vs time_window vs count_threshold
- **因变量**: 存档调用次数、批均大小、context-tag archive delay 和 backlog size
- **方法**: 模拟不同交易频率 (1 / 10 / 100 tx/min)
- **图表**: 分组柱状图

#### 3d. Gas 成本估算

- **对比项**: 单地址模型 vs isolated 模式
- **指标**: 额外 on-chain 交易数、预估 gas 成本
- **方法**: 基于 consolidation tx 数量，按 EVM/Solana gas 价格估算
- **交易量级**: 100 / 1K / 10K tx
- **图表**: 成本对比表 + cost vs privacy proxy frontier 曲线

#### 3e. 不可链接性仿真 ⭐ 核心安全实验

**安全游戏定义**:

```
Transaction Unlinkability Game:
1. Challenger 生成 n 个 agent，每个执行 m 笔交易
2. 每个 agent 使用 isolated 模式，产生 m 个 ephemeral 地址
3. Consolidation 按照配置的 jitter 参数执行
4. Adversary 观察所有 on-chain {address, timestamp, amount}
5. Adversary 输出地址聚类 C（尝试将同一 agent 的地址分到一组）
6. 优势 = |Pr[正确聚类] - 1/n|
```

**攻击者模型**:
- 时序分析：基于 consolidation 时间戳的聚类 (DBSCAN)
- 金额分析：基于交易金额模式的匹配
- 组合攻击：时序 + 金额特征联合

**自变量**:
- jitter ratio: 0 / 0.1 / 0.2 / 0.3
- agent 数量: 10 / 50 / 100
- 每 agent 交易数: 10 / 50 / 100

**因变量（双视角度量）**:

攻击者视角（安全审稿人关注）:
- 聚类 precision / recall / F1

信息论视角（系统审稿人关注）:
- 同地址碰撞率 (same-address collision rate)
- 地址熵 (Shannon entropy over address frequency)
- 时序聚类分数 (temporal clustering score before/after jitter)
- 地址复用率 (address reuse ratio)

**方法**:
1. 用 `ConsolidationScheduler` 的逻辑生成归集时间序列
2. 实现 DBSCAN 聚类攻击者
3. 对比 jitter=0 (baseline) vs 各 jitter 参数

**图表**:
- 热力图 — X: jitter ratio, Y: agent 数量, 色彩: F1
- F1 vs jitter ratio 折线图
- 地址熵 vs privacy level 柱状图

**论文中的形式化声明**:

```
Claim: 在 HKDF 为 PRF 的假设下，isolated 模式中
Adversary 的优势 ≤ negl(λ) + ε_timing
其中 ε_timing 由 consolidation jitter 参数控制。
实验 3e 是该 Claim 的 empirical instantiation。
```

### 预期产出

- 三级隐私开销对比图
- Consolidation lag CDF
- Audit batching 效率对比图
- Gas 成本估算表 + cost-privacy frontier 曲线
- Unlinkability 攻击成功率热力图
- 地址熵 / F1 vs jitter 折线图

---

## E4: Review Queue（人在回路）负载分析

> **RQ4**: 随着策略违规率升高，人在回路的审批队列能否保持稳定？人类审批负担是否可控？

### 代码基础

- `src/review/manager.ts` — `ReviewManager`，queue + deadline + freeze 机制

### Workload 模型

**请求到达**: Poisson 过程，可配置 λ (requests/min)

**违规率**: 1% / 5% / 20%

**人类响应延迟**（三档 reviewer）:
- fast: median 30s
- normal: median 3min
- slow: median 10min

**Deadline**: 5min / 30min / 2h

### 子实验

#### 4a. 队列积压

- **自变量**: 违规率 (1% / 5% / 20%)
- **因变量**: 队列长度分布 (p50 / p95 / p99)、平均等待时间
- **方法**: Poisson arrival, 1,000 tx/h, 跑 simulated 4h
- **图表**: 队列深度 time-series（不同违规率为不同曲线）

#### 4b. SLA 违反热力图

- **自变量**: deadline (5min / 30min / 2h) × reviewer 类型 (fast / normal / slow)
- **因变量**: 超时率、资金锁定时间
- **图表**: 热力图 — X: deadline, Y: reviewer 类型, 色彩: timeout rate

#### 4c. Emergency Freeze 有效性

- **场景**: 模拟突发攻击（短时间大量异常交易）
- **指标**: freeze 触发后被阻断的 tx 数量、freeze → 恢复时间
- **方法**: 模拟攻击序列，测量 `freezeAgent()` 响应

#### 4d. 人类负担评估

- **自变量**: policy 宽松度（per-tx limit 从严到松 5 档）
- **因变量**: 每小时需人工审批次数
- **核心论点**: 合理配置的 policy 可将人工审批降到 <5 次/小时
- **图表**: 柱状图

### 预期产出

- 队列深度 time-series
- SLA violation 热力图 (deadline × reviewer)
- 人类审批负担柱状图
- Emergency freeze 响应时间图

---

## E5: 端到端 Case Study — NFT Hunter 场景

> **RQ5**: 在完整 agent 工作流中，AESP 的成功率、成本和延迟 tradeoff 如何？

### 为什么选 NFT Hunter

同时涉及 negotiation FSM、commitment 签署、policy check、privacy（高价值交易需 isolated 模式），覆盖所有模块。

### 场景流程

```
Agent 发现 NFT → negotiation (offer/counter/accept) → commitment 签署
→ policy check → privacy address resolve → escrow → delivery → completion
           ↘ (超限) → review fallback → human approve/reject
           ↘ (不交付) → dispute → arbitration
```

### 记录指标

| 阶段 | 记录项 |
|------|--------|
| Negotiation | FSM 状态转换延迟、消息签名次数 |
| Policy Check | 检查延迟、auto-approve ratio |
| Commitment | EIP-712 签名延迟、hash 计算时间 |
| Address Derivation | isolated 模式地址派生延迟 |
| Escrow | 状态转换延迟 |
| End-to-end | 总流程耗时、task success rate |
| Cost | mean cost per successful task |

### 变化条件

| 路径 | 条件 | 关注点 |
|------|------|--------|
| 正常路径 | 金额在 policy limit 内 | 全自动完成延迟 |
| Review 路径 | 金额超过 per-tx limit | human intervention ratio |
| Dispute 路径 | 对手方不交付 | dispute → arbitration 流程时间 |

### 预期产出

- 端到端 waterfall chart + 各阶段延迟 breakdown
- Success / cost tradeoff bars
- 正常 vs 异常路径对比表
- Failure reason taxonomy

---

## Baselines & Ablations

> 论文评审必需。没有 baseline 的实验数据等于没有参照系。

### Baselines

| ID | 配置 | 说明 |
|----|------|------|
| `B0` | Minimal | 单地址模型，无 privacy isolation，无 review queue |
| `B1` | Policy-only | 启用 policy，关闭 privacy |
| `B2` | Privacy-only | 启用 privacy，关闭 review queue |
| `Full` | 完整 AESP | 所有模块启用 |

E1-E5 中的每个性能指标均需对照 `B0` 报告相对开销。

### Ablations

逐项关闭机制，观察 latency / cost / safety proxy 的增量变化 (Δ):

| 移除项 | 影响的指标 |
|--------|-----------|
| allowList checks | latency ↓, safety ↓ |
| first-pay review | latency ↓, safety ↓ |
| budget (日/周/月) 约束 | latency ↓, safety ↓ |
| consolidation jitter | cost ↓, privacy ↓ |
| context-tag batching | archive cost ↑, latency ↓ |

每项 ablation 报告 delta 值，汇总为 ablation table。

---

## 统计与可复现协议

- 每个配置至少 **≥ 5 次**独立 trial
- 报告 **mean ± 95% CI**
- 对非正态分布，同时报告 **median + IQR**
- 固定随机种子并记录 seed 列表
- 记录环境信息:
  - CPU 型号、内存、OS
  - Node 版本
  - `package-lock.json` hash / git commit hash
- 导出原始 CSV 与绘图脚本到 `experiements/results/`

---

## 实施路线图

### Phase 1 (Day 1-4): P0 实验

1. 搭建 benchmark 基础设施（计时工具、统计收集、CSV 导出）
2. E1: PolicyEngine benchmark (1a-1e)
3. E2: WASM Crypto benchmark (2a-2f)
4. 产出第一批图表

### Phase 2 (Day 5-9): P1 实验

5. E3 (3a-3d): 隐私模块开销
6. E3 (3e): 不可链接性仿真（含攻击者模拟代码）
7. Baselines (B0/B1/B2) 对照数据

### Phase 3 (Day 10-14): P2 实验 + 论文整合

8. E4: Review Queue 仿真
9. E5: 端到端 Case Study
10. Ablation study
11. 统计清理 + 可复现性打包
12. 撰写 Evaluation 章节 + 插入图表

### 目录结构

```
experiements/
├── EXPERIMENT-PLAN.md              ← 本文档
├── experiements-plan-gpt.md        ← GPT 草案（参考）
├── benchmarks/
│   ├── utils/                      ← 计时、统计、CSV 导出工具
│   ├── bench-policy.ts             ← E1 runner
│   ├── bench-crypto.ts             ← E2 runner
│   ├── sim-privacy.ts              ← E3 runner
│   ├── sim-review-queue.ts         ← E4 runner
│   └── case-study-e2e.ts           ← E5 runner
├── simulations/
│   └── unlinkability/              ← E3e 攻击者仿真
├── results/                        ← 原始 CSV 数据
├── plots/                          ← 生成的图表 (PNG)
└── README.md                       ← 运行与复现说明
```

---

## 论文 Evaluation 章节建议结构

```
7. Evaluation
  7.1 Experimental Setup
      - 硬件/软件环境、统计方法、baselines 定义
  7.2 Policy Engine Performance (RQ1)
      - 延迟分布 (Fig. X)
      - 吞吐量与扩展性 (Fig. Y)
      - 违规分布 (Fig. Z)
  7.3 Cryptographic Operations (RQ2)
      - WASM signing/verification latency (Table A)
      - Cold vs warm start + fallback slowdown (Fig. B)
  7.4 Privacy Cost Analysis (RQ3)
      - Three-tier privacy overhead (Fig. C)
      - Gas cost comparison (Table D)
      - Cost-privacy frontier curve (Fig. E)
  7.5 Transaction Unlinkability (RQ3 cont.)
      - Security game definition
      - Empirical evaluation: F1 heatmap (Fig. F)
      - Address entropy analysis (Fig. G)
      - Discussion of ε_timing bounds
  7.6 Human Review Overhead (RQ4)
      - Queue depth time-series (Fig. H)
      - SLA violation heatmap (Fig. I)
      - Human burden under different configs (Fig. J)
  7.7 End-to-End Case Study (RQ5)
      - NFT Hunter waterfall chart (Fig. K)
      - Success/cost tradeoff (Fig. L)
  7.8 Ablation Study
      - Ablation table (Table M)
  7.9 Threats to Validity
```

---

## Threats to Validity

论文中需包含此段，审稿人会主动寻找。

### Internal Validity

- 当前实验在仿真环境中进行，mock WASM 与真实 WASM 模块的性能特征可能存在差异。需要在论文中明确标注哪些数据来自真实 WASM、哪些来自 mock。
- Policy check 的延迟测量受 Node.js event loop 和 GC 影响，需要充分 warmup 并报告 GC 暂停次数。

### External Validity

- 端到端 case study 仅覆盖 NFT Hunter 场景。虽然该场景涵盖了所有模块，但其他 agent 经济场景（如 Grocery、DeFi lending）的工作负载特征可能不同。
- Gas 成本估算基于特定时间点的链上费率快照，实际成本随网络拥堵波动。

### Construct Validity

- 隐私度量使用 proxy metrics（Shannon entropy、DBSCAN F1），而非形式化密码学证明中的 distinguishing advantage。需在论文中明确说明这些是 empirical privacy proxies。
- 人类 reviewer 响应时间使用参数化分布模拟，真实用户行为可能更复杂（疲劳、注意力切换等）。

---

## Risk Notes

- 当前的单元测试覆盖了正确性，但**不能**作为性能评估的证据。Evaluation 中的数据必须来自独立的 benchmark runner。
- Gas/fee 数字对环境敏感。需要明确标注假设条件，或在固定的 testnet snapshot 上运行。
- 隐私声明应措辞为 "empirical privacy proxies"，除非在附录中提供了基于安全游戏的形式化证明。
