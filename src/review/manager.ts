/**
 * AESP — Review Request Manager
 *
 * Manages the ReviewRequest protocol for human-in-the-loop approval.
 * Handles creating, queuing, responding to, and escalating review requests.
 *
 * Flow: Agent exceeds policy → ReviewRequest created → pushed to mobile/extension
 *       → Human reviews → approve/reject/modify → Agent receives response
 */

import type { StorageAdapter, UrgencyLevel } from '../types/index.js';
import { AESPError } from '../types/index.js';
import type {
  ReviewRequest,
  ReviewResponse,
  ReviewAction,
  ReviewRequestDetails,
  PolicyViolation,
  EmergencyFreezeRequest,
  EmergencyFreezeStatus,
  ReviewQueueItem,
} from '../types/review.js';
import { generateUUID } from '../crypto/hashing.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const REVIEW_QUEUE_KEY = 'aesp:review_queue';
const FREEZE_STATUS_KEY = 'aesp:freeze_status';
const DEFAULT_DEADLINE_MS = 30 * 60 * 1000; // 30 minutes

// ─── Event Types ─────────────────────────────────────────────────────────────

export type ReviewEventType =
  | 'review:created'
  | 'review:responded'
  | 'review:expired'
  | 'review:escalated'
  | 'freeze:activated'
  | 'freeze:deactivated';

export type ReviewEventHandler = (type: ReviewEventType, data: unknown) => void;

// ─── Review Manager ──────────────────────────────────────────────────────────

export class ReviewManager {
  private queue: Map<string, ReviewQueueItem> = new Map();
  private freezeStatuses: Map<string, EmergencyFreezeStatus> = new Map();
  private eventHandlers: ReviewEventHandler[] = [];
  private pendingCallbacks: Map<string, {
    resolve: (response: ReviewResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(private readonly storage: StorageAdapter) {}

  // ─── Event System ──────────────────────────────────────────────────────

  /**
   * Register an event handler.
   */
  onEvent(handler: ReviewEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  private emit(type: ReviewEventType, data: unknown): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(type, data);
      } catch {
        // Don't let handler errors break the flow
      }
    }
  }

  // ─── Review Request Creation ───────────────────────────────────────────

  /**
   * Create a review request and add to queue.
   * Returns a promise that resolves when the human responds.
   */
  async createReviewRequest(params: {
    agentId: string;
    agentLabel: string;
    action: ReviewAction;
    summary: string;
    details: ReviewRequestDetails;
    policyViolation: PolicyViolation;
    urgency?: UrgencyLevel;
    deadlineMs?: number;
    escalatedFrom?: string;
  }): Promise<ReviewResponse> {
    // Check if agent is frozen
    const freezeStatus = this.freezeStatuses.get(params.agentId);
    if (freezeStatus?.frozen) {
      throw new AESPError(
        `Agent ${params.agentId} is frozen: ${freezeStatus.reason}`,
        'AGENT_FROZEN',
      );
    }

    const now = new Date();
    const deadlineMs = params.deadlineMs ?? DEFAULT_DEADLINE_MS;

    const request: ReviewRequest = {
      requestId: generateUUID(),
      agentId: params.agentId,
      agentLabel: params.agentLabel,
      action: params.action,
      summary: params.summary,
      details: params.details,
      policyViolation: params.policyViolation,
      urgency: params.urgency ?? 'normal',
      deadline: new Date(now.getTime() + deadlineMs).toISOString(),
      escalatedFrom: params.escalatedFrom,
      createdAt: now.toISOString(),
    };

    const queueItem: ReviewQueueItem = {
      request,
      status: 'pending',
      queuedAt: now.toISOString(),
    };

    this.queue.set(request.requestId, queueItem);
    this.emit('review:created', request);
    this.save().catch((e) => console.error('ReviewManager.save after createReviewRequest:', e));

    // Return a promise that resolves when response is received
    return new Promise<ReviewResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCallbacks.delete(request.requestId);
        const item = this.queue.get(request.requestId);
        if (item) {
          item.status = 'expired';
          this.save().catch((e) => console.error('ReviewManager.save after expire:', e));
        }
        this.emit('review:expired', request);
        reject(new AESPError(
          `Review request ${request.requestId} expired`,
          'REVIEW_EXPIRED',
        ));
      }, deadlineMs);

      this.pendingCallbacks.set(request.requestId, { resolve, reject, timer });
    });
  }

  /**
   * Create a review request without waiting (fire-and-forget).
   */
  createReviewRequestAsync(params: {
    agentId: string;
    agentLabel: string;
    action: ReviewAction;
    summary: string;
    details: ReviewRequestDetails;
    policyViolation: PolicyViolation;
    urgency?: UrgencyLevel;
    deadlineMs?: number;
    escalatedFrom?: string;
  }): ReviewRequest {
    // Check if agent is frozen
    const freezeStatus = this.freezeStatuses.get(params.agentId);
    if (freezeStatus?.frozen) {
      throw new AESPError(
        `Agent ${params.agentId} is frozen: ${freezeStatus.reason}`,
        'AGENT_FROZEN',
      );
    }

    const now = new Date();
    const deadlineMs = params.deadlineMs ?? DEFAULT_DEADLINE_MS;

    const request: ReviewRequest = {
      requestId: generateUUID(),
      agentId: params.agentId,
      agentLabel: params.agentLabel,
      action: params.action,
      summary: params.summary,
      details: params.details,
      policyViolation: params.policyViolation,
      urgency: params.urgency ?? 'normal',
      deadline: new Date(now.getTime() + deadlineMs).toISOString(),
      escalatedFrom: params.escalatedFrom,
      createdAt: now.toISOString(),
    };

    const queueItem: ReviewQueueItem = {
      request,
      status: 'pending',
      queuedAt: now.toISOString(),
    };

    this.queue.set(request.requestId, queueItem);
    this.emit('review:created', request);
    this.save().catch((e) => console.error('ReviewManager.save after createReviewRequestAsync:', e));

    return request;
  }

  // ─── Response Handling ─────────────────────────────────────────────────

  /**
   * Submit a response to a review request (called from mobile/extension).
   */
  submitResponse(response: ReviewResponse): void {
    const item = this.queue.get(response.requestId);
    if (!item) {
      throw new AESPError(
        `Review request ${response.requestId} not found`,
        'REVIEW_NOT_FOUND',
      );
    }

    if (item.status !== 'pending') {
      throw new AESPError(
        `Review request ${response.requestId} is already ${item.status}`,
        'REVIEW_ALREADY_RESOLVED',
      );
    }

    item.response = response;
    item.status = 'responded';

    // Resolve pending callback
    const callback = this.pendingCallbacks.get(response.requestId);
    if (callback) {
      clearTimeout(callback.timer);
      callback.resolve(response);
      this.pendingCallbacks.delete(response.requestId);
    }

    this.emit('review:responded', { request: item.request, response });
    this.save().catch((e) => console.error('ReviewManager.save after submitResponse:', e));
  }

  // ─── Emergency Freeze ──────────────────────────────────────────────────

  /**
   * Freeze an agent (block all operations).
   */
  freezeAgent(request: EmergencyFreezeRequest): EmergencyFreezeStatus {
    const status: EmergencyFreezeStatus = {
      agentId: request.agentId,
      frozen: true,
      reason: request.reason,
      frozenAt: request.freezeAt,
      frozenBy: request.initiatedBy,
    };

    this.freezeStatuses.set(request.agentId, status);
    this.emit('freeze:activated', status);

    // Reject all pending reviews for this agent
    for (const [requestId, item] of this.queue) {
      if (item.request.agentId === request.agentId && item.status === 'pending') {
        item.status = 'expired';
        const callback = this.pendingCallbacks.get(requestId);
        if (callback) {
          clearTimeout(callback.timer);
          callback.reject(new AESPError('Agent frozen', 'AGENT_FROZEN'));
          this.pendingCallbacks.delete(requestId);
        }
      }
    }

    this.save().catch((e) => console.error('ReviewManager.save after freezeAgent:', e));
    return status;
  }

  /**
   * Unfreeze an agent.
   */
  unfreezeAgent(agentId: string): EmergencyFreezeStatus {
    const status: EmergencyFreezeStatus = {
      agentId,
      frozen: false,
    };

    this.freezeStatuses.set(agentId, status);
    this.emit('freeze:deactivated', status);
    this.save().catch((e) => console.error('ReviewManager.save after unfreezeAgent:', e));

    return status;
  }

  /**
   * Check if an agent is frozen.
   */
  isAgentFrozen(agentId: string): boolean {
    return this.freezeStatuses.get(agentId)?.frozen ?? false;
  }

  /**
   * Get freeze status for an agent.
   */
  getFreezeStatus(agentId: string): EmergencyFreezeStatus | undefined {
    return this.freezeStatuses.get(agentId);
  }

  // ─── Query ─────────────────────────────────────────────────────────────

  getPendingRequests(): ReviewQueueItem[] {
    return Array.from(this.queue.values()).filter((i) => i.status === 'pending');
  }

  getRequestsByAgent(agentId: string): ReviewQueueItem[] {
    return Array.from(this.queue.values()).filter(
      (i) => i.request.agentId === agentId,
    );
  }

  getRequest(requestId: string): ReviewQueueItem | undefined {
    return this.queue.get(requestId);
  }

  // ─── Persistence ───────────────────────────────────────────────────────

  /**
   * Load queue and freeze status from storage.
   * Note: Pending callbacks (createReviewRequest promises) are not restored after load;
   * any in-flight await will never resolve. Call load() before creating review requests
   * or handle re-display of pending items in the UI after load.
   */
  async load(): Promise<void> {
    const queue = await this.storage.get<ReviewQueueItem[]>(REVIEW_QUEUE_KEY);
    if (queue) {
      this.queue.clear();
      for (const item of queue) {
        this.queue.set(item.request.requestId, item);
      }
    }

    const freezes = await this.storage.get<Record<string, EmergencyFreezeStatus>>(FREEZE_STATUS_KEY);
    if (freezes) {
      this.freezeStatuses.clear();
      for (const [key, value] of Object.entries(freezes)) {
        this.freezeStatuses.set(key, value);
      }
    }
  }

  async save(): Promise<void> {
    await this.storage.set(
      REVIEW_QUEUE_KEY,
      Array.from(this.queue.values()),
    );

    const freezes: Record<string, EmergencyFreezeStatus> = {};
    for (const [key, value] of this.freezeStatuses) {
      freezes[key] = value;
    }
    await this.storage.set(FREEZE_STATUS_KEY, freezes);
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  /**
   * Clear all pending callbacks (for shutdown).
   */
  dispose(): void {
    for (const [, callback] of this.pendingCallbacks) {
      clearTimeout(callback.timer);
      callback.reject(new AESPError('ReviewManager disposed', 'DISPOSED'));
    }
    this.pendingCallbacks.clear();
  }
}
