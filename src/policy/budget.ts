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
    amount: number,
    conditions: PolicyConditions,
  ): Promise<BudgetCheckResult> {
    const budget = this.getOrCreateBudget(agentId);
    this.resetExpiredPeriods(budget);

    const projectedDaily = budget.dailySpent + amount;
    const projectedWeekly = budget.weeklySpent + amount;
    const projectedMonthly = budget.monthlySpent + amount;

    // Check daily limit
    if (projectedDaily > conditions.maxAmountPerDay) {
      return {
        allowed: false,
        remainingDaily: Math.max(0, conditions.maxAmountPerDay - budget.dailySpent),
        remainingWeekly: Math.max(0, conditions.maxAmountPerWeek - budget.weeklySpent),
        remainingMonthly: Math.max(0, conditions.maxAmountPerMonth - budget.monthlySpent),
        violatedRule: 'maxAmountPerDay',
        violatedActual: String(projectedDaily),
        violatedLimit: String(conditions.maxAmountPerDay),
      };
    }

    // Check weekly limit
    if (projectedWeekly > conditions.maxAmountPerWeek) {
      return {
        allowed: false,
        remainingDaily: Math.max(0, conditions.maxAmountPerDay - budget.dailySpent),
        remainingWeekly: Math.max(0, conditions.maxAmountPerWeek - budget.weeklySpent),
        remainingMonthly: Math.max(0, conditions.maxAmountPerMonth - budget.monthlySpent),
        violatedRule: 'maxAmountPerWeek',
        violatedActual: String(projectedWeekly),
        violatedLimit: String(conditions.maxAmountPerWeek),
      };
    }

    // Check monthly limit
    if (projectedMonthly > conditions.maxAmountPerMonth) {
      return {
        allowed: false,
        remainingDaily: Math.max(0, conditions.maxAmountPerDay - budget.dailySpent),
        remainingWeekly: Math.max(0, conditions.maxAmountPerWeek - budget.weeklySpent),
        remainingMonthly: Math.max(0, conditions.maxAmountPerMonth - budget.monthlySpent),
        violatedRule: 'maxAmountPerMonth',
        violatedActual: String(projectedMonthly),
        violatedLimit: String(conditions.maxAmountPerMonth),
      };
    }

    return {
      allowed: true,
      remainingDaily: conditions.maxAmountPerDay - projectedDaily,
      remainingWeekly: conditions.maxAmountPerWeek - projectedWeekly,
      remainingMonthly: conditions.maxAmountPerMonth - projectedMonthly,
    };
  }

  // ─── Record Spending ───────────────────────────────────────────────────

  /**
   * Record a spend transaction against an agent's budget.
   */
  async recordSpend(agentId: string, tx: BudgetTransaction): Promise<void> {
    const budget = this.getOrCreateBudget(agentId);
    this.resetExpiredPeriods(budget);

    budget.dailySpent += tx.amount;
    budget.weeklySpent += tx.amount;
    budget.monthlySpent += tx.amount;

    budget.transactions.push(tx);

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
      dailySpent: 0,
      weeklySpent: 0,
      monthlySpent: 0,
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
        dailySpent: 0,
        weeklySpent: 0,
        monthlySpent: 0,
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
      budget.dailySpent = 0;
      budget.lastResetDaily = now.toISOString();
    }

    // Weekly reset: if last reset was more than 7 days ago
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (new Date(budget.lastResetWeekly) < weekAgo) {
      budget.weeklySpent = 0;
      budget.lastResetWeekly = now.toISOString();
    }

    // Monthly reset: if last reset was in a different month
    const lastResetMonth = new Date(budget.lastResetMonthly);
    if (
      lastResetMonth.getMonth() !== now.getMonth() ||
      lastResetMonth.getFullYear() !== now.getFullYear()
    ) {
      budget.monthlySpent = 0;
      budget.lastResetMonthly = now.toISOString();
    }
  }
}
