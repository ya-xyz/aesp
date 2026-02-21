/**
 * AESP — Agent Hierarchy
 *
 * Manages the tree structure of human → parent agents → sub-agents.
 * Supports delegation, escalation chains, and permission inheritance.
 *
 * Example hierarchy:
 *   Human (Yault main account)
 *   ├── Shopping Agent (monthly budget $500)
 *   │   ├── Price-comparison Sub-Agent (read-only)
 *   │   └── Order Sub-Agent (single tx <= $100)
 *   ├── Research Agent (monthly budget $200)
 *   │   └── Data Collection Sub-Agent (daily budget $20)
 *   └── Finance Agent (monthly budget $1,000)
 */

import type { StorageAdapter } from '../types/index.js';
import type { AgentHierarchyNode, AgentHierarchy } from '../types/identity.js';
// ─── Constants ───────────────────────────────────────────────────────────────

const HIERARCHY_STORAGE_KEY = 'aesp:agent_hierarchy';
const MAX_HIERARCHY_DEPTH = 5;

// ─── Hierarchy Manager ───────────────────────────────────────────────────────

export class AgentHierarchyManager {
  private nodes: Map<string, AgentHierarchyNode> = new Map();

  constructor(private readonly storage: StorageAdapter) {}

  /**
   * Load hierarchy from storage.
   */
  async load(): Promise<void> {
    const stored = await this.storage.get<SerializedHierarchy>(HIERARCHY_STORAGE_KEY);
    if (stored) {
      this.nodes.clear();
      for (const node of stored.nodes) {
        this.nodes.set(node.agentId, { ...node, children: [] });
      }
      // Rebuild parent-child links
      for (const node of this.nodes.values()) {
        if (node.parentAgentId) {
          const parent = this.nodes.get(node.parentAgentId);
          if (parent) {
            parent.children.push(node);
          }
        }
      }
    }
  }

  /**
   * Save hierarchy to storage.
   */
  async save(): Promise<void> {
    const nodes = Array.from(this.nodes.values()).map((n) => ({
      agentId: n.agentId,
      label: n.label,
      parentAgentId: n.parentAgentId,
      depth: n.depth,
      maxDepth: n.maxDepth,
    }));
    await this.storage.set<SerializedHierarchy>(HIERARCHY_STORAGE_KEY, {
      nodes,
      totalAgents: nodes.length,
    });
  }

  /**
   * Add an agent to the hierarchy.
   */
  addAgent(
    agentId: string,
    label: string,
    parentAgentId?: string,
  ): AgentHierarchyNode {
    if (this.nodes.has(agentId)) {
      throw new Error(`Agent '${agentId}' already exists in hierarchy`);
    }
    if (parentAgentId && parentAgentId === agentId) {
      throw new Error('An agent cannot be its own parent');
    }

    const parentNode = parentAgentId ? this.nodes.get(parentAgentId) : undefined;
    if (parentAgentId && !parentNode) {
      throw new Error(`Parent agent '${parentAgentId}' not found`);
    }
    const depth = parentNode ? parentNode.depth + 1 : 0;

    if (depth >= MAX_HIERARCHY_DEPTH) {
      throw new Error(
        `Maximum hierarchy depth (${MAX_HIERARCHY_DEPTH}) exceeded`,
      );
    }

    const node: AgentHierarchyNode = {
      agentId,
      label,
      parentAgentId,
      children: [],
      depth,
      maxDepth: MAX_HIERARCHY_DEPTH,
    };

    this.nodes.set(agentId, node);

    if (parentNode) {
      parentNode.children.push(node);
    }

    return node;
  }

  /**
   * Remove an agent and all its sub-agents from the hierarchy.
   */
  removeAgent(agentId: string): string[] {
    const removed: string[] = [];
    const node = this.nodes.get(agentId);
    if (!node) return removed;

    // Recursively remove children
    const removeRecursive = (n: AgentHierarchyNode) => {
      for (const child of n.children) {
        removeRecursive(child);
      }
      this.nodes.delete(n.agentId);
      removed.push(n.agentId);
    };

    removeRecursive(node);

    // Remove from parent's children array
    if (node.parentAgentId) {
      const parent = this.nodes.get(node.parentAgentId);
      if (parent) {
        parent.children = parent.children.filter((c) => c.agentId !== agentId);
      }
    }

    return removed;
  }

  /**
   * Get the full hierarchy tree.
   */
  getHierarchy(): AgentHierarchy {
    const roots = Array.from(this.nodes.values()).filter((n) => !n.parentAgentId);

    // Create a virtual root if there are multiple top-level agents
    const root: AgentHierarchyNode = {
      agentId: 'human',
      label: 'Human Owner',
      children: roots,
      depth: -1,
      maxDepth: MAX_HIERARCHY_DEPTH,
    };

    return {
      root,
      totalAgents: this.nodes.size,
      maxDepth: MAX_HIERARCHY_DEPTH,
    };
  }

  /**
   * Get the escalation chain for an agent (agent → parent → ... → human).
   */
  getEscalationChain(agentId: string): string[] {
    const chain: string[] = [agentId];
    let current = this.nodes.get(agentId);

    while (current?.parentAgentId) {
      chain.push(current.parentAgentId);
      current = this.nodes.get(current.parentAgentId);
    }

    chain.push('human');
    return chain;
  }

  /**
   * Check if one agent is an ancestor of another.
   */
  isAncestor(ancestorId: string, descendantId: string): boolean {
    let current = this.nodes.get(descendantId);
    while (current?.parentAgentId) {
      if (current.parentAgentId === ancestorId) return true;
      current = this.nodes.get(current.parentAgentId);
    }
    return false;
  }

  /**
   * Get all descendants of an agent.
   */
  getDescendants(agentId: string): string[] {
    const descendants: string[] = [];
    const node = this.nodes.get(agentId);
    if (!node) return descendants;

    const collect = (n: AgentHierarchyNode) => {
      for (const child of n.children) {
        descendants.push(child.agentId);
        collect(child);
      }
    };

    collect(node);
    return descendants;
  }

  /**
   * Get an agent node by ID.
   */
  getAgent(agentId: string): AgentHierarchyNode | undefined {
    return this.nodes.get(agentId);
  }

  /**
   * Get all agent IDs in the hierarchy.
   */
  getAllAgentIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  /**
   * Get the number of agents in the hierarchy.
   */
  get size(): number {
    return this.nodes.size;
  }
}

// ─── Serialization ───────────────────────────────────────────────────────────

interface SerializedHierarchy {
  nodes: Array<{
    agentId: string;
    label: string;
    parentAgentId?: string;
    depth: number;
    maxDepth: number;
  }>;
  totalAgents: number;
}
