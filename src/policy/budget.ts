/**
 * AESP — Budget Tracker
 *
 * Tracks per-agent spending across daily/weekly/monthly windows.
 * Used by PolicyEngine to enforce spending limits.
 */

import type { StorageAdapter } from '../types/index.js';
import type {
  AgentBudgetTracker,
  BudgetTransaction,
  BudgetCheckResult,
  PolicyConditions,
} from '../types/policy.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const BUDGET_STORAGE_KEY = 'aesp:budgets';
const MAX_TRANSACTIONS_KEPT = 1000;
const AMOUNT_SCALE = 18n;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

type AmountInput = PolicyConditions['maxAmountPerDay'] | BudgetTransaction['amount'];

function toBigIntAmount(value: AmountInput | undefined | null): bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return 0n;
    return BigInt(value) * (10n ** AMOUNT_SCALE);
  }
  const s = String(value).trim();
  if (!AMOUNT_PATTERN.test(s)) return 0n;
  const [intPart, fracPart = ''] = s.split('.');
  if (fracPart.length > Number(AMOUNT_SCALE)) return 0n;
  const normalized = `${intPart}${fracPart.padEnd(Number(AMOUNT_SCALE), '0')}`;
  return BigInt(normalized);
}

function toAmountString(value: bigint): string {
  if (value <= 0n) return '0';
  const factor = 10n ** AMOUNT_SCALE;
  const integer = value / factor;
  let fraction = (value % factor).toString().padStart(Number(AMOUNT_SCALE), '0');
  // Trim trailing zeros for compactness.
  fraction = fraction.replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer.toString();
}

// ─── Budget Tracker ──────────────────────────────────────────────────────────

export class BudgetTracker {
  private budgets: Map<string, AgentBudgetTracker> = new Map();

  constructor(private readonly storage: StorageAdapter) {}

  // ─── Budget Check ──────────────────────────────────────────────────────

  /**
   * Check if a proposed spend amount is within budget limits.
   */
  async checkBudget(
    agentId: string,
    amount: AmountInput,
    conditions: PolicyConditions,
  ): Promise<BudgetCheckResult> {
    const budget = this.getOrCreateBudget(agentId);
    this.resetExpiredPeriods(budget);

    const amountBI = toBigIntAmount(amount);
    const maxDaily = toBigIntAmount(conditions.maxAmountPerDay);
    const maxWeekly = toBigIntAmount(conditions.maxAmountPerWeek);
    const maxMonthly = toBigIntAmount(conditions.maxAmountPerMonth);
    const spentDaily = toBigIntAmount(budget.dailySpent);
    const spentWeekly = toBigIntAmount(budget.weeklySpent);
    const spentMonthly = toBigIntAmount(budget.monthlySpent);

    const projectedDaily = spentDaily + amountBI;
    const projectedWeekly = spentWeekly + amountBI;
    const projectedMonthly = spentMonthly + amountBI;

    // Check daily limit
    if (projectedDaily > maxDaily) {
      return {
        allowed: false,
        remainingDaily: toAmountString(maxDaily > spentDaily ? maxDaily - spentDaily : 0n),
        remainingWeekly: toAmountString(maxWeekly > spentWeekly ? maxWeekly - spentWeekly : 0n),
        remainingMonthly: toAmountString(maxMonthly > spentMonthly ? maxMonthly - spentMonthly : 0n),
        violatedRule: 'maxAmountPerDay',
        violatedActual: toAmountString(projectedDaily),
        violatedLimit: toAmountString(maxDaily),
      };
    }

    // Check weekly limit
    if (projectedWeekly > maxWeekly) {
      return {
        allowed: false,
        remainingDaily: toAmountString(maxDaily > spentDaily ? maxDaily - spentDaily : 0n),
        remainingWeekly: toAmountString(maxWeekly > spentWeekly ? maxWeekly - spentWeekly : 0n),
        remainingMonthly: toAmountString(maxMonthly > spentMonthly ? maxMonthly - spentMonthly : 0n),
        violatedRule: 'maxAmountPerWeek',
        violatedActual: toAmountString(projectedWeekly),
        violatedLimit: toAmountString(maxWeekly),
      };
    }

    // Check monthly limit
    if (projectedMonthly > maxMonthly) {
      return {
        allowed: false,
        remainingDaily: toAmountString(maxDaily > spentDaily ? maxDaily - spentDaily : 0n),
        remainingWeekly: toAmountString(maxWeekly > spentWeekly ? maxWeekly - spentWeekly : 0n),
        remainingMonthly: toAmountString(maxMonthly > spentMonthly ? maxMonthly - spentMonthly : 0n),
        violatedRule: 'maxAmountPerMonth',
        violatedActual: toAmountString(projectedMonthly),
        violatedLimit: toAmountString(maxMonthly),
      };
    }

    return {
      allowed: true,
      remainingDaily: toAmountString(maxDaily > projectedDaily ? maxDaily - projectedDaily : 0n),
      remainingWeekly: toAmountString(maxWeekly > projectedWeekly ? maxWeekly - projectedWeekly : 0n),
      remainingMonthly: toAmountString(maxMonthly > projectedMonthly ? maxMonthly - projectedMonthly : 0n),
    };
  }

  // ─── Record Spending ───────────────────────────────────────────────────

  /**
   * Record a spend transaction against an agent's budget.
   */
  async recordSpend(agentId: string, tx: BudgetTransaction): Promise<void> {
    const budget = this.getOrCreateBudget(agentId);
    this.resetExpiredPeriods(budget);

    const normalizedAmount = toAmountString(toBigIntAmount(tx.amount));
    budget.dailySpent = toAmountString(toBigIntAmount(budget.dailySpent) + toBigIntAmount(normalizedAmount));
    budget.weeklySpent = toAmountString(toBigIntAmount(budget.weeklySpent) + toBigIntAmount(normalizedAmount));
    budget.monthlySpent = toAmountString(
      toBigIntAmount(budget.monthlySpent) + toBigIntAmount(normalizedAmount),
    );

    budget.transactions.push({
      ...tx,
      amount: normalizedAmount,
    });

    // Trim old transactions to prevent unbounded growth
    if (budget.transactions.length > MAX_TRANSACTIONS_KEPT) {
      budget.transactions = budget.transactions.slice(-MAX_TRANSACTIONS_KEPT);
    }

    this.budgets.set(agentId, budget);
  }

  // ─── Query ─────────────────────────────────────────────────────────────

  /**
   * Get the current budget state for an agent.
   */
  getBudget(agentId: string): AgentBudgetTracker | null {
    const budget = this.budgets.get(agentId);
    if (!budget) return null;
    this.resetExpiredPeriods(budget);
    return { ...budget, transactions: [...budget.transactions] };
  }

  /**
   * Get recent transactions for an agent.
   */
  getRecentTransactions(agentId: string, limit: number = 50): BudgetTransaction[] {
    const budget = this.budgets.get(agentId);
    if (!budget) return [];
    return budget.transactions.slice(-limit);
  }

  /**
   * Reset budget for an agent (e.g., after policy change).
   */
  resetBudget(agentId: string): void {
    const now = new Date().toISOString();
    this.budgets.set(agentId, {
      agentId,
      dailySpent: '0',
      weeklySpent: '0',
      monthlySpent: '0',
      lastResetDaily: now,
      lastResetWeekly: now,
      lastResetMonthly: now,
      transactions: [],
    });
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  async load(): Promise<void> {
    const stored = await this.storage.get<Record<string, AgentBudgetTracker>>(BUDGET_STORAGE_KEY);
    if (stored) {
      this.budgets.clear();
      for (const [key, value] of Object.entries(stored)) {
        this.budgets.set(key, value);
      }
    }
  }

  async save(): Promise<void> {
    const data: Record<string, AgentBudgetTracker> = {};
    for (const [key, value] of this.budgets) {
      data[key] = value;
    }
    await this.storage.set(BUDGET_STORAGE_KEY, data);
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private getOrCreateBudget(agentId: string): AgentBudgetTracker {
    let budget = this.budgets.get(agentId);
    if (!budget) {
      const now = new Date().toISOString();
      budget = {
        agentId,
        dailySpent: '0',
        weeklySpent: '0',
        monthlySpent: '0',
        lastResetDaily: now,
        lastResetWeekly: now,
        lastResetMonthly: now,
        transactions: [],
      };
      this.budgets.set(agentId, budget);
    }
    return budget;
  }

  private resetExpiredPeriods(budget: AgentBudgetTracker): void {
    const now = new Date();

    // Daily reset: if last reset was before today midnight
    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);
    if (new Date(budget.lastResetDaily) < todayMidnight) {
      budget.dailySpent = '0';
      budget.lastResetDaily = now.toISOString();
    }

    // Weekly reset: if last reset was more than 7 days ago
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (new Date(budget.lastResetWeekly) < weekAgo) {
      budget.weeklySpent = '0';
      budget.lastResetWeekly = now.toISOString();
    }

    // Monthly reset: if last reset was in a different month
    const lastResetMonth = new Date(budget.lastResetMonthly);
    if (
      lastResetMonth.getMonth() !== now.getMonth() ||
      lastResetMonth.getFullYear() !== now.getFullYear()
    ) {
      budget.monthlySpent = '0';
      budget.lastResetMonthly = now.toISOString();
    }
  }
}
