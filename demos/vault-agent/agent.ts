#!/usr/bin/env npx tsx
/**
 * AESP Vault Agent Demo
 *
 * An interactive AI agent that manages a Yault testnet vault through the
 * AESP SDK. All vault operations (query, deposit, redeem, send payment)
 * are routed through AESP's MCPServer with PolicyEngine enforcement.
 *
 * This demo exercises the full AESP stack:
 *   - PolicyEngine: client-side spending policy enforcement
 *   - BudgetTracker: per-tx / daily / weekly / monthly limits
 *   - MCPServer: tool validation + policy-gated execution
 *   - Policy violations: detailed error reporting
 *   - Budget queries: remaining spending limits
 *   - Policy simulation: test approval without execution
 *   - Policy modification: update limits, classify changes
 *
 * Architecture:
 *   Claude Agent SDK → createSdkMcpServer() (in-process)
 *     → AESP MCPServer.handleToolCall()
 *       → PolicyEngine.checkAutoApprove() (client-side spending policy)
 *       → HTTP handler → Yault API
 *
 * Usage:
 *   export ANTHROPIC_API_KEY="sk-ant-..."
 *   export YAULT_API_KEY="sk-yault-..."
 *   npx tsx agent.ts
 *
 * Or with a one-shot command:
 *   npx tsx agent.ts "check my balance for 0x1234..."
 */

import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as readline from 'readline';

// Import from AESP SDK (relative path within monorepo)
import {
  MCPServer,
  PolicyEngine,
  generateUUID,
} from '../../src/index.js';
import type {
  StorageAdapter,
  AgentPolicy,
  PolicyConditions,
} from '../../src/index.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const YAULT_API_KEY = process.env.YAULT_API_KEY;
const YAULT_API_URL = process.env.YAULT_API_URL ?? 'https://api.yault.xyz';

if (!YAULT_API_KEY) {
  console.error('Error: YAULT_API_KEY is required. Get one at https://yault.xyz');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY is required. Get one at https://console.anthropic.com');
  process.exit(1);
}

// ─── In-Memory Storage Adapter ───────────────────────────────────────────────

class MemoryStorage implements StorageAdapter {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => !prefix || k.startsWith(prefix));
  }
}

// ─── Yault API Client (thin HTTP wrapper) ────────────────────────────────────

async function yaultPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${YAULT_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(YAULT_API_KEY ? { Authorization: `Bearer ${YAULT_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Yault API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function yaultGet(endpoint: string): Promise<unknown> {
  const res = await fetch(`${YAULT_API_URL}${endpoint}`, {
    method: 'GET',
    headers: {
      ...(YAULT_API_KEY ? { Authorization: `Bearer ${YAULT_API_KEY}` } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Yault API error ${res.status}: ${text}`);
  }

  return res.json();
}

// ─── AESP SDK: PolicyEngine Setup ────────────────────────────────────────────

// Agent identity and policy are fetched from Yault API on startup.
// The API key determines the agent_id (= key_id) and bound spending policy.
// Fallback to local defaults if the API is unreachable or no policy is bound.
let AGENT_ID = 'vault-agent-demo';  // overridden by API response
let POLICY_ID = generateUUID();     // overridden by API response

const storage = new MemoryStorage();
const policyEngine = new PolicyEngine(storage);

// Default policy (used when no server-side policy is bound to the API key)
const DEFAULT_CONDITIONS: PolicyConditions = {
  maxAmountPerTx: '0.5',         // max 0.5 WETH per transaction
  maxAmountPerDay: '2',          // max 2 WETH per day
  maxAmountPerWeek: '5',         // max 5 WETH per week
  maxAmountPerMonth: '10',       // max 10 WETH per month
  allowListAddresses: [],        // any address allowed
  allowListChains: ['evm'],
  allowListMethods: [],
  minBalanceAfter: '0',
  requireReviewBeforeFirstPay: false,
};

/**
 * Initialize agent identity and policy from the Yault API.
 * The API key → key_id mapping gives us the agent_id,
 * and the bound spending_policy gives us server-side limits.
 */
async function initFromApi(): Promise<void> {
  try {
    const auth = await yaultGet('/api/vault/agent-authorization') as Record<string, any>;
    if (auth.agent_id) {
      AGENT_ID = auth.agent_id;
      console.log(`✅ Agent ID from Yault: ${AGENT_ID}`);
    }
    if (auth.wallet_id) {
      console.log(`   Wallet: ${auth.wallet_id}`);
    }

    // Sync server-side spending policy to local PolicyEngine
    let conditions = DEFAULT_CONDITIONS;
    if (auth.spending_policy) {
      const sp = auth.spending_policy;
      POLICY_ID = sp.policy_id ?? POLICY_ID;
      const c = sp.conditions ?? {};
      conditions = {
        maxAmountPerTx: c.max_per_transaction ?? DEFAULT_CONDITIONS.maxAmountPerTx,
        maxAmountPerDay: c.daily_limit ?? DEFAULT_CONDITIONS.maxAmountPerDay,
        maxAmountPerWeek: c.weekly_limit ?? DEFAULT_CONDITIONS.maxAmountPerWeek,
        maxAmountPerMonth: c.monthly_limit ?? DEFAULT_CONDITIONS.maxAmountPerMonth,
        allowListAddresses: c.allowed_addresses ?? [],
        allowListChains: ['evm'],
        allowListMethods: c.allowed_operations ?? [],
        minBalanceAfter: '0',
        requireReviewBeforeFirstPay: false,
      };
      console.log(`   Policy synced: ${sp.label ?? POLICY_ID} (per-tx: ${conditions.maxAmountPerTx}, daily: ${conditions.maxAmountPerDay})`);
    } else {
      console.log('   No server-side policy bound — using local defaults');
    }

    policyEngine.addPolicy({
      id: POLICY_ID,
      agentId: AGENT_ID,
      agentLabel: 'Vault Agent Demo',
      scope: 'auto_payment',
      conditions,
      escalation: 'block',
      createdAt: new Date().toISOString(),
      signature: '',
    });
  } catch (err: any) {
    console.warn(`⚠️  Could not fetch agent identity from API: ${err.message}`);
    console.warn('   Using local defaults for agent ID and policy');
    policyEngine.addPolicy({
      id: POLICY_ID,
      agentId: AGENT_ID,
      agentLabel: 'Vault Agent Demo',
      scope: 'auto_payment',
      conditions: DEFAULT_CONDITIONS,
      escalation: 'block',
      createdAt: new Date().toISOString(),
      signature: '',
    });
  }
}

// ─── AESP SDK: MCPServer + Handler Registration ─────────────────────────────

const mcpServer = new MCPServer({ name: 'yault-aesp', version: '0.2.0' });
mcpServer.setPolicyEngine(policyEngine);

// Register HTTP handlers for each vault tool
mcpServer.registerHandler('yault_check_balance', async (args) => {
  const address = args.address as string;
  const data = await yaultGet(`/api/vault/balance/${encodeURIComponent(address)}`);
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

mcpServer.registerHandler('yault_deposit', async (args) => {
  const data = await yaultPost('/api/vault/deposit', {
    address: args.address,
    amount: args.amount,
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

mcpServer.registerHandler('yault_redeem', async (args) => {
  const data = await yaultPost('/api/vault/redeem', {
    address: args.address,
    shares: args.shares,
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

mcpServer.registerHandler('yault_transfer', async (args) => {
  const data = await yaultPost('/api/vault/transfer', {
    from_address: args.from_address,
    to_address: args.to_address,
    amount: args.amount,
    currency: args.currency,
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

mcpServer.registerHandler('yault_check_authorization', async () => {
  const data = await yaultGet('/api/vault/agent-authorization');
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

mcpServer.registerHandler('yault_get_balances', async (args) => {
  const address = args.address as string;
  const data = await yaultGet(`/api/vault/balances/${encodeURIComponent(address)}`);
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

mcpServer.registerHandler('yault_send_payment', async (args) => {
  const data = await yaultPost('/api/vault/send', {
    from_address: args.from_address,
    to_address: args.to_address,
    amount: args.amount,
    memo: args.memo,
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
});

// ─── Bridge: AESP MCPServer → claude-agent-sdk in-process MCP ───────────────

/**
 * Bridge helper: creates a claude-agent-sdk tool that routes through
 * mcpServer.handleToolCall() for validation + policy enforcement.
 *
 * When PolicyEngine blocks a tool call, the bridge provides detailed
 * violation information by querying the BudgetTracker directly.
 */
function bridgeTool<T extends Record<string, z.ZodTypeAny>>(
  name: string,
  description: string,
  schema: T,
) {
  return tool(name, description, schema, async (args: Record<string, unknown>) => {
    const result = await mcpServer.handleToolCall({
      name: name as any,
      arguments: args,
    });

    // If policy blocked, enrich error with budget details
    if (result.isError) {
      const text = result.content[0]?.text ?? '';
      if (text.includes('blocked by policy engine')) {
        const amount = (args.amount ?? args.shares ?? '0') as string;
        const policy = policyEngine.getPolicy(POLICY_ID);
        if (policy) {
          const budgetCheck = await policyEngine.getBudgetTracker().checkBudget(
            AGENT_ID,
            amount,
            policy.conditions,
          );
          let detail: string;
          if (!budgetCheck.allowed) {
            detail = `Budget violation: ${budgetCheck.violatedRule} (attempted: ${budgetCheck.violatedActual}, limit: ${budgetCheck.violatedLimit}). Remaining: daily=${budgetCheck.remainingDaily}, weekly=${budgetCheck.remainingWeekly}, monthly=${budgetCheck.remainingMonthly}`;
          } else if (parseFloat(amount) > parseFloat(String(policy.conditions.maxAmountPerTx))) {
            detail = `Per-transaction limit exceeded: ${amount} > ${policy.conditions.maxAmountPerTx} WETH`;
          } else {
            detail = `Policy check failed (no matching policy found for this agent/vendor, or policy expired). Amount: ${amount} WETH`;
          }
          return {
            content: [{ type: 'text' as const, text: `AESP PolicyEngine BLOCKED this operation.\n${detail}` }],
            isError: true,
          };
        }
      }
    }

    // Convert AESP MCPToolResult → MCP SDK CallToolResult
    return {
      content: result.content.map((c) => ({
        type: 'text' as const,
        text: c.type === 'json' ? JSON.stringify(c.json, null, 2) : (c.text ?? ''),
      })),
      isError: result.isError,
    };
  });
}

// ─── Local AESP Tools (no API call — query PolicyEngine/BudgetTracker) ──────

/**
 * aesp_check_budget: Query the remaining spending limits from BudgetTracker
 */
const aespCheckBudgetTool = tool(
  'aesp_check_budget',
  'Query remaining AESP spending limits (daily/weekly/monthly) and recent transaction history',
  {},
  async () => {
    const policy = policyEngine.getPolicy(POLICY_ID);
    if (!policy) {
      return { content: [{ type: 'text' as const, text: 'No policy found' }], isError: true };
    }

    const budgetTracker = policyEngine.getBudgetTracker();
    const budget = budgetTracker.getBudget(AGENT_ID);
    const recentTxs = budgetTracker.getRecentTransactions(AGENT_ID, 10);

    // Check budget for a $0 amount to get current remaining without side effects
    const remaining = await budgetTracker.checkBudget(AGENT_ID, '0', policy.conditions);

    const result = {
      policy_id: POLICY_ID,
      agent_id: AGENT_ID,
      scope: policy.scope,
      limits: {
        per_tx: policy.conditions.maxAmountPerTx,
        daily: policy.conditions.maxAmountPerDay,
        weekly: policy.conditions.maxAmountPerWeek,
        monthly: policy.conditions.maxAmountPerMonth,
      },
      spent: budget ? {
        daily: budget.dailySpent,
        weekly: budget.weeklySpent,
        monthly: budget.monthlySpent,
      } : { daily: '0', weekly: '0', monthly: '0' },
      remaining: {
        daily: remaining.remainingDaily,
        weekly: remaining.remainingWeekly,
        monthly: remaining.remainingMonthly,
      },
      recent_transactions: recentTxs.map((tx) => ({
        amount: tx.amount,
        timestamp: tx.timestamp,
        txHash: tx.txHash,
      })),
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

/**
 * aesp_get_policy: Show current policy configuration
 */
const aespGetPolicyTool = tool(
  'aesp_get_policy',
  'Show the current AESP spending policy configuration (limits, scope, escalation rules)',
  {},
  async () => {
    const policies = policyEngine.getPoliciesForAgent(AGENT_ID);
    const result = policies.map((p) => ({
      id: p.id,
      agent_id: p.agentId,
      label: p.agentLabel,
      scope: p.scope,
      escalation: p.escalation,
      conditions: p.conditions,
      created_at: p.createdAt,
      expires_at: p.expiresAt ?? 'never',
    }));

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

/**
 * aesp_simulate_approval: Test if an amount would be approved without executing
 */
const aespSimulateApprovalTool = tool(
  'aesp_simulate_approval',
  'Simulate whether a transfer amount would be approved by the AESP PolicyEngine (dry run, no execution)',
  {
    amount: z.string().describe('Amount to simulate (e.g., "0.3" WETH)'),
    to_address: z.string().optional().describe('Optional recipient address to check against allowlist'),
  },
  async (args) => {
    const policy = policyEngine.getPolicy(POLICY_ID);
    if (!policy) {
      return { content: [{ type: 'text' as const, text: 'No policy found' }], isError: true };
    }

    // Use checkAutoApprove to test (this does NOT record the spend)
    const request = {
      requestId: generateUUID(),
      vendorId: AGENT_ID,
      action: {
        type: 'transfer' as const,
        payload: {
          chainId: 'evm',
          token: 'WETH',
          toAddress: (args.to_address as string) || '0x0000000000000000000000000000000000000000',
          amount: args.amount as string,
        },
      },
    };

    const approvedPolicyId = await policyEngine.checkAutoApprove(request);

    // Also get detailed budget info
    const budgetCheck = await policyEngine.getBudgetTracker().checkBudget(
      AGENT_ID,
      args.amount as string,
      policy.conditions,
    );

    const result = {
      amount: args.amount,
      approved: !!approvedPolicyId,
      policy_id: approvedPolicyId ?? 'DENIED',
      budget_check: {
        allowed: budgetCheck.allowed,
        violated_rule: budgetCheck.violatedRule ?? null,
        violated_actual: budgetCheck.violatedActual ?? null,
        violated_limit: budgetCheck.violatedLimit ?? null,
        remaining_daily: budgetCheck.remainingDaily,
        remaining_weekly: budgetCheck.remainingWeekly,
        remaining_monthly: budgetCheck.remainingMonthly,
      },
      per_tx_check: {
        amount: args.amount,
        limit: policy.conditions.maxAmountPerTx,
        within_limit: parseFloat(args.amount as string) <= parseFloat(String(policy.conditions.maxAmountPerTx)),
      },
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

/**
 * aesp_update_policy: Modify the spending policy and show change classification
 */
const aespUpdatePolicyTool = tool(
  'aesp_update_policy',
  'Update the AESP spending policy limits. Returns change classification showing required approval level (auto/review/biometric)',
  {
    max_per_tx: z.string().optional().describe('New per-transaction limit in WETH'),
    max_daily: z.string().optional().describe('New daily limit in WETH'),
    max_weekly: z.string().optional().describe('New weekly limit in WETH'),
    max_monthly: z.string().optional().describe('New monthly limit in WETH'),
    require_first_pay_review: z.boolean().optional().describe('Require human review for first payment'),
  },
  async (args) => {
    const currentPolicy = policyEngine.getPolicy(POLICY_ID);
    if (!currentPolicy) {
      return { content: [{ type: 'text' as const, text: 'No policy found' }], isError: true };
    }

    // Build the proposed new policy
    const newConditions: PolicyConditions = { ...currentPolicy.conditions };
    if (args.max_per_tx !== undefined) newConditions.maxAmountPerTx = args.max_per_tx as string;
    if (args.max_daily !== undefined) newConditions.maxAmountPerDay = args.max_daily as string;
    if (args.max_weekly !== undefined) newConditions.maxAmountPerWeek = args.max_weekly as string;
    if (args.max_monthly !== undefined) newConditions.maxAmountPerMonth = args.max_monthly as string;
    if (args.require_first_pay_review !== undefined) {
      newConditions.requireReviewBeforeFirstPay = args.require_first_pay_review as boolean;
    }

    const newPolicy: AgentPolicy = {
      ...currentPolicy,
      id: generateUUID(), // New policy ID
      conditions: newConditions,
      createdAt: new Date().toISOString(),
    };

    // Classify the change (before applying)
    const classification = policyEngine.classifyPolicyChange(newPolicy, POLICY_ID);

    // Apply the change: remove old, add new
    const oldPolicyId = POLICY_ID;
    policyEngine.removePolicy(POLICY_ID);
    policyEngine.addPolicy(newPolicy);

    // Update the module-level reference so subsequent tool calls use the new policy
    POLICY_ID = newPolicy.id;
    const newPolicyId = newPolicy.id;

    const result = {
      status: 'updated',
      old_policy_id: oldPolicyId,
      new_policy_id: newPolicyId,
      change_classification: {
        requires_escalation: classification.requiresEscalation,
        approval_level: classification.approvalLevel,
        critical_changes: classification.criticalChanges,
        reasons: classification.reasons,
      },
      new_conditions: {
        max_per_tx: newConditions.maxAmountPerTx,
        max_daily: newConditions.maxAmountPerDay,
        max_weekly: newConditions.maxAmountPerWeek,
        max_monthly: newConditions.maxAmountPerMonth,
        require_first_pay_review: newConditions.requireReviewBeforeFirstPay,
      },
      note: classification.requiresEscalation
        ? `⚠️ This change would require ${classification.approvalLevel} approval in production (${classification.reasons.join('; ')})`
        : '✅ Change classified as non-critical (auto-approval)',
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

/**
 * aesp_get_audit_log: Show recent execution history
 */
const aespGetAuditLogTool = tool(
  'aesp_get_audit_log',
  'Show the AESP audit log of recent policy-checked executions',
  {
    hours: z.number().optional().describe('Hours of history to query (default: 24)'),
  },
  async (args) => {
    const hours = (args.hours as number) ?? 24;
    const toTs = Date.now();
    const fromTs = toTs - hours * 3600 * 1000;

    // Get all policies to query audit (deduplicate by ID to avoid double-counting after policy updates)
    const policies = policyEngine.getPoliciesForAgent(AGENT_ID);
    const queriedIds = new Set<string>();
    const allEntries: any[] = [];

    for (const policy of policies) {
      if (queriedIds.has(policy.id)) continue;
      queriedIds.add(policy.id);
      const entries = await policyEngine.getExecutions(policy.id, fromTs, toTs);
      allEntries.push(...entries.map((e) => ({
        ...e,
        policy_id: policy.id,
      })));
    }

    // Also try POLICY_ID in case it differs from getPoliciesForAgent results
    if (!queriedIds.has(POLICY_ID)) {
      try {
        const entries = await policyEngine.getExecutions(POLICY_ID, fromTs, toTs);
        allEntries.push(...entries.map((e) => ({
          ...e,
          policy_id: POLICY_ID,
        })));
      } catch {
        // Policy may have been replaced
      }
    }

    // Sort by timestamp descending
    allEntries.sort((a, b) => b.timestamp - a.timestamp);

    const result = {
      query: { from: new Date(fromTs).toISOString(), to: new Date(toTs).toISOString() },
      total_entries: allEntries.length,
      entries: allEntries.slice(0, 50),
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  },
);

// ─── Assemble all tools into the in-process MCP server ──────────────────────

const sdkMcp = createSdkMcpServer({
  name: 'yault',
  version: '0.2.0',
  tools: [
    // ── Vault operations (via Yault API, policy-enforced) ──
    bridgeTool('yault_check_balance', 'Check the vault balance for a wallet address', {
      address: z.string().describe('Wallet address (hex, with or without 0x prefix)'),
    }),
    bridgeTool('yault_deposit', 'Deposit assets into a Yault ERC-4626 vault for yield generation', {
      address: z.string().describe('Agent wallet address (must match the API key owner)'),
      amount: z.string().describe('Amount to deposit in underlying asset units (e.g., "0.01" WETH)'),
    }),
    bridgeTool('yault_redeem', 'Redeem shares from a Yault vault to get underlying assets back', {
      address: z.string().describe('Agent wallet address (must match the API key owner)'),
      shares: z.string().describe('Number of vault shares to redeem (use "max" to redeem all)'),
    }),
    bridgeTool('yault_transfer', 'Transfer vault shares from one account to another (must be parent→sub-account)', {
      from_address: z.string().describe('Sender wallet address (must match API key owner)'),
      to_address: z.string().describe('Recipient wallet address (must be an active sub-account)'),
      amount: z.string().describe('Amount to transfer in underlying asset units'),
      currency: z.string().optional().describe('Currency (default: "USDC")'),
    }),
    bridgeTool('yault_check_authorization', 'Check agent authorization status: operator address, on-chain allowances, and chain config', {}),
    bridgeTool('yault_get_balances', 'Get comprehensive balance breakdown including vault shares, underlying assets, and yield', {
      address: z.string().describe('Wallet address'),
    }),
    bridgeTool('yault_send_payment', 'Send tokens from your wallet to any recipient address (direct ERC-20 transfer)', {
      from_address: z.string().describe('Sender wallet address (must match API key owner)'),
      to_address: z.string().describe('Recipient wallet address'),
      amount: z.string().describe('Amount to send in WETH (e.g., "0.05")'),
      memo: z.string().optional().describe('Optional memo/note for the payment'),
    }),

    // ── AESP local tools (no API call — query PolicyEngine directly) ──
    aespCheckBudgetTool,
    aespGetPolicyTool,
    aespSimulateApprovalTool,
    aespUpdatePolicyTool,
    aespGetAuditLogTool,
  ],
});

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const policy = policyEngine.getPolicy(POLICY_ID);
  const cond = policy?.conditions ?? DEFAULT_CONDITIONS;

  return `You are a Vault Manager agent powered by AESP (Agent Economic Sovereignty Protocol).

You manage a Yault vault on testnet. You have 12 tools: 7 vault operations (via Yault API) and 5 AESP policy tools (local, no API call).

## Vault tools (policy-enforced, calls Yault API)
- **yault_check_balance** / **yault_get_balances**: Query vault balance or detailed breakdown
- **yault_deposit**: Deposit WETH into an ERC-4626 vault for yield generation
- **yault_redeem**: Redeem vault shares back to underlying WETH
- **yault_transfer**: Transfer vault allocations between parent and sub-accounts
- **yault_send_payment**: Send WETH directly to any wallet address
- **yault_check_authorization**: View on-chain operator status and allowances

## AESP policy tools (local, no API call)
- **aesp_check_budget**: Query remaining spending limits and recent transactions
- **aesp_get_policy**: Show current policy configuration (limits, scope, escalation)
- **aesp_simulate_approval**: Dry-run: test if an amount would be approved (no execution)
- **aesp_update_policy**: Modify spending limits; returns change classification (auto/review/biometric)
- **aesp_get_audit_log**: Show recent execution audit trail

## Policy enforcement (AESP auto_payment scope)
All state-changing vault operations (deposit, redeem, transfer, send) are enforced by the AESP PolicyEngine client-side:
- Max ${cond.maxAmountPerTx} WETH per transaction
- Max ${cond.maxAmountPerDay} WETH per day, ${cond.maxAmountPerWeek} per week, ${cond.maxAmountPerMonth} per month
- Operations exceeding limits are BLOCKED with detailed violation info
- Use aesp_simulate_approval to test before executing
- Use aesp_update_policy to modify limits (shows required approval level)

## Critical safety rules
- **NEVER substitute, modify, or correct wallet addresses.** If the user provides address X, you MUST use address X exactly. If the API rejects it (e.g. 403 "not your address"), report the error to the user — do NOT silently retry with a different address.
- **NEVER retry a failed operation with altered parameters** unless the user explicitly asks you to.
- If an operation fails, clearly state: (1) what you tried, (2) the exact error, (3) ask the user what to do next.

## Important context
- This is a TESTNET environment — all tokens are test tokens
- The underlying vault asset is WETH (Wrapped ETH) on Sepolia
- Agent ID: ${AGENT_ID}
- The Yault API is at ${YAULT_API_URL}
- Always confirm the result of operations clearly
- If a policy blocks an operation, explain which limit was hit and show remaining budget

## Interaction style
- Be concise and direct
- Show relevant numbers (balances, amounts, shares, remaining limits)
- When an operation is blocked, explain WHY and suggest alternatives
`;
}

// ─── Agent Runner ────────────────────────────────────────────────────────────

async function runAgent(userMessage: string): Promise<void> {
  console.log('\n🤖 Agent thinking...\n');

  for await (const message of query({
    prompt: userMessage,
    options: {
      systemPrompt: buildSystemPrompt(),
      maxTurns: 10,

      // In-process MCP server — routes through AESP MCPServer + PolicyEngine
      mcpServers: { yault: sdkMcp },

      // Allow all yault + aesp MCP tools
      allowedTools: ['mcp__yault__*'],
    },
  })) {
    // ── MCP server init ──
    if (message.type === 'system' && message.subtype === 'init') {
      const servers = (message as any).mcp_servers;
      if (servers) {
        for (const [name, info] of Object.entries(servers) as [string, any][]) {
          const status = info.status === 'connected' ? '✅' : '❌';
          console.log(`  MCP ${status} ${name} (${info.tools?.length ?? 0} tools)`);
        }
      }
    }

    // ── Tool calls ──
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use' && block.name.startsWith('mcp__yault__')) {
          const toolName = block.name.replace('mcp__yault__', '');
          console.log(`  🔧 ${toolName}(${JSON.stringify(block.input)})`);
        }
      }
    }

    // ── Tool results ──
    if (message.type === 'tool') {
      // Tool results are handled internally by the SDK
    }

    // ── Final result ──
    if (message.type === 'result') {
      if (message.subtype === 'success') {
        console.log(message.result);
        console.log(`\n  💰 Cost: $${(message as any).total_cost_usd?.toFixed(4) ?? '?'}`);
      } else {
        console.error(`\n❌ Agent error: ${message.subtype}`);
        if ((message as any).error) {
          console.error(`   ${(message as any).error}`);
        }
      }
    }
  }
}

// ─── Interactive REPL ────────────────────────────────────────────────────────

async function repl(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  AESP Vault Agent — Testnet Demo (v0.2)                 ║');
  console.log('║  Powered by AESP SDK: PolicyEngine + MCPServer          ║');
  console.log('║  Type a command or question. Ctrl+C to exit.            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Vault Operations:');
  console.log('    "Check balance for 0xABC..."');
  console.log('    "Deposit 0.01 WETH from 0xABC..."');
  console.log('    "Send 0.05 WETH from 0xABC to 0xDEF"');
  console.log('    "Redeem all shares for 0xABC..."');
  console.log('');
  console.log('  AESP Policy (test failure scenarios):');
  console.log('    "Show my spending budget"');
  console.log('    "Can I send 1 WETH?"              ← exceeds per-tx limit');
  console.log('    "Try to deposit 0.6 WETH"          ← will be BLOCKED');
  console.log('    "Increase my per-tx limit to 1.0"  ← shows approval level');
  console.log('    "Show audit log"');
  console.log('');
  const pol = policyEngine.getPolicy(POLICY_ID)?.conditions ?? DEFAULT_CONDITIONS;
  console.log(`  Policy: max ${pol.maxAmountPerTx}/tx, ${pol.maxAmountPerDay}/day, ${pol.maxAmountPerWeek}/week, ${pol.maxAmountPerMonth}/month (WETH)`);
  console.log('');

  const ask = (): void => {
    rl.question('You: ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        ask();
        return;
      }

      try {
        await runAgent(trimmed);
      } catch (err: any) {
        console.error(`\n❌ Error: ${err.message}`);
      }

      console.log('');
      ask();
    });
  };

  ask();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Fetch agent identity + spending policy from Yault API
  await initFromApi();

  // 2. Configure MCPServer with the resolved agent ID
  mcpServer.setAgentId(AGENT_ID);

  // 3. Run in one-shot or interactive mode
  const oneShotMessage = process.argv.slice(2).join(' ');
  if (oneShotMessage) {
    await runAgent(oneShotMessage);
  } else {
    await repl();
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
