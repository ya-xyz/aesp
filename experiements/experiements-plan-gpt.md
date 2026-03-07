# AESP Experiements Plan (GPT Draft)

## 1. Goal and Scope

This plan is designed to close the key publication gaps identified in internal review:
- Add a complete, quantitative Evaluation section.
- Turn system claims into measurable evidence.
- Provide reproducible experiment methodology suitable for a formal paper submission.

Focus is strictly on code-backed components in `src/`:
- Policy Engine / Budget
- Crypto (WASM bridge + signing + hashing fallback)
- Privacy (address pool + context tags + consolidation)
- Review queue (human-in-the-loop)
- Negotiation + Commitment pipeline

## 2. Research Questions (RQ)

- `RQ1` Policy Performance: Can the policy engine sustain practical throughput and tail latency under realistic concurrency and policy complexity?
- `RQ2` Crypto Overhead: What are the latency/throughput characteristics of core crypto operations, and what is the penalty of fallback paths?
- `RQ3` Privacy-Cost Tradeoff: How much overhead is introduced by context-isolated addresses and consolidation policies, and what privacy proxy gain is achieved?
- `RQ4` HITL Scalability: How does review queue behavior change as policy violations increase (1%, 5%, 20%)?
- `RQ5` End-to-End Utility: In a realistic agent workflow, what are success rate, cost, and latency tradeoffs with AESP enabled?

## 3. Experiment Matrix

### E1. PolicyEngine Benchmark

### Purpose
Quantify `checkAutoApprove()` + 8-step evaluation performance under load.

### Workload factors
- Concurrency: `1 / 8 / 32 / 128`
- Policy complexity:
  - `P0`: amount limits only
  - `P1`: P0 + allowListAddresses + allowListChains
  - `P2`: P1 + timeWindow + allowListMethods
  - `P3`: P2 + requireReviewBeforeFirstPay + minBalanceAfter
- Request mix:
  - transfer-heavy (70% transfer, 20% send_transaction, 10% sign)
  - balanced mix (33/33/34)

### Metrics
- Throughput (req/s)
- Latency P50/P95/P99 (ms)
- Auto-approve ratio
- Violation breakdown (which rule failed)
- Process RSS memory (optional)

### Expected output figures
- Throughput vs concurrency (line chart)
- P99 latency vs policy complexity (bar chart)
- Rule-violation distribution (stacked bar)

## E2. Crypto + WASM Benchmark

### Purpose
Measure signing/hashing costs and fallback penalty.

### Scenarios
- Operations:
  - `signMessage(ed25519)`
  - `signMessage(secp256k1)`
  - `signTypedData`
  - `sha256` with WASM
  - `sha256` with fallback (disable `sha256_wasm` mock/export)
- Batch size: `1 / 100 / 1000`
- Warm/cold split: first-call latency vs steady-state latency

### Metrics
- Mean/P95 latency per operation
- Ops/sec
- Cold-start overhead
- Fallback slowdown factor (`fallback_latency / wasm_latency`)

### Expected output figures
- Per-op latency comparison
- Throughput comparison (WASM vs fallback)
- Slowdown factor chart

## E3. Privacy Overhead and Linkability Proxies

### Purpose
Evaluate transparent/basic/isolated modes and consolidation strategies.

### Configurations
- Privacy level: `transparent`, `basic`, `isolated`
- Consolidation mode:
  - immediate
  - threshold-triggered
  - jittered batched (`consolidateBatched`)
- Transaction volume: `100 / 1k / 10k` synthetic tx stream

### Metrics
- Addresses generated per 1k tx
- Address reuse ratio
- Consolidation lag (time from funded to consolidated)
- Number of consolidation tx per 1k tx
- Estimated fee/gas overhead (from chain fee model assumptions)
- Context-tag archive delay and backlog size

### Privacy proxy metrics
- Same-address collision rate
- Temporal clustering score before/after jitter batching
- Address entropy proxy (Shannon entropy over address frequency)

### Expected output figures
- Cost vs privacy proxy frontier curve
- Consolidation lag CDF
- Address reuse comparison across levels

## E4. Review Queue Stress Test (HITL)

### Purpose
Test queue stability and SLA behavior when escalation pressure increases.

### Workload generator
- Escalation rates: `1% / 5% / 20%`
- Request arrival: Poisson process with configurable lambda
- Human response delay model:
  - fast reviewer (median 30s)
  - normal reviewer (median 3m)
  - slow reviewer (median 10m)
- Deadline settings: `5m / 30m / 2h`

### Metrics
- Queue length distribution (P50/P95/P99)
- Wait time distribution
- Timeout rate
- Approval/rejection ratio
- Freeze-trigger frequency and impact window

### Expected output figures
- Queue depth over time (time-series)
- Timeout rate vs escalation rate
- SLA violation heatmap (deadline x response model)

## E5. End-to-End Case Study (Primary Evaluation)

### Purpose
Demonstrate complete AESP pipeline in one reproducible scenario (recommended: NFT Hunter or Grocery flow).

### Pipeline
Negotiation -> Acceptance -> Commitment signing -> Policy check -> Privacy address resolve -> Execution or Review fallback -> Consolidation + audit tagging.

### Metrics
- Task success rate
- End-to-end latency (total + per stage)
- Automatic approval ratio
- Human intervention ratio
- Mean cost per successful task
- Failure reason taxonomy

### Expected output figures
- End-to-end waterfall chart
- Success/cost tradeoff bars
- Stage bottleneck breakdown

## 4. Baselines and Ablations (Required for paper quality)

## Baselines
- `B0` Minimal baseline: single address, no privacy isolation, no review queue.
- `B1` Policy-only baseline: policy enabled, privacy disabled.
- `B2` Privacy-only baseline: privacy enabled, no review queue.

## Ablations
Disable one mechanism at a time:
- remove allowList checks
- remove first-pay review
- disable budget daily/weekly/monthly constraints
- disable consolidation jitter batching
- disable context-tag batching

Report delta on latency, cost, and safety proxies.

## 5. Statistical and Reproducibility Protocol

- Run each configuration `>= 5` independent trials.
- Report mean +/- 95% CI.
- For non-normal distributions, also report median and IQR.
- Use fixed random seeds and record seed list.
- Record environment:
  - CPU model
  - memory
  - OS
  - Node version
  - package-lock hash / git commit hash
- Export raw CSV + plotting scripts to `experiements/results/`.

## 6. Deliverables Checklist

- `experiements/bench-policy.ts` (E1 runner)
- `experiements/bench-crypto.ts` (E2 runner)
- `experiements/sim-privacy.ts` (E3 runner)
- `experiements/sim-review-queue.ts` (E4 runner)
- `experiements/case-study-e2e.ts` (E5 runner)
- `experiements/results/*.csv`
- `experiements/plots/*.png`
- `experiements/README.md` (how to run and reproduce)

## 7. Paper Mapping (How to write Evaluation section)

Suggested section structure:
1. Setup and methodology
2. Policy performance (E1)
3. Crypto overhead (E2)
4. Privacy-cost tradeoff (E3)
5. HITL queue scalability (E4)
6. End-to-end case study (E5)
7. Ablation study
8. Discussion of limitations

This mapping directly addresses the current review gap: move from architecture narrative to quantitative evidence.

## 8. Recommended Execution Order (2-Week Sprint)

- Day 1-2: implement E1/E2 runners and data schema
- Day 3-4: run E1/E2 and produce first plots
- Day 5-7: implement E3/E4 simulators
- Day 8-9: run E3/E4 and produce plots
- Day 10-11: implement E5 case-study harness
- Day 12: run E5 + ablations
- Day 13: statistical cleanup + reproducibility pack
- Day 14: draft Evaluation section text with figures

## 9. Risk Notes

- Current tests are strong on correctness but do not measure system-level performance; avoid presenting unit-test results as evaluation evidence.
- Fee/gas numbers are environment-sensitive; clearly state assumptions or run on a fixed testnet snapshot.
- Privacy claims should be phrased as empirical privacy proxies unless a formal game-based proof is provided in appendix.
