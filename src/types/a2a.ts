/**
 * AESP — A2A Types
 *
 * Agent-to-Agent protocol (Google A2A) Agent Card and skill definitions.
 */

// ─── A2A Agent Card ──────────────────────────────────────────────────────────

export interface A2AProvider {
  organization: string;
  url: string;
}

export interface A2ACapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory?: boolean;
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  inputModes: string[];
  outputModes: string[];
  tags?: string[];
}

export interface A2AAuthentication {
  schemes: string[];
  credentials?: string;
}

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  provider: A2AProvider;
  version: string;
  capabilities: A2ACapabilities;
  skills: A2ASkill[];
  authentication: A2AAuthentication;
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

// ─── A2A Task ────────────────────────────────────────────────────────────────

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface A2ATask {
  id: string;
  sessionId?: string;
  status: {
    state: A2ATaskState;
    message?: A2AMessage;
    timestamp: string;
  };
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
}

export type A2APart =
  | { type: 'text'; text: string }
  | { type: 'data'; data: Record<string, unknown>; mimeType?: string }
  | { type: 'file'; file: { name: string; mimeType: string; bytes?: string; uri?: string } };

export interface A2AArtifact {
  name: string;
  description?: string;
  parts: A2APart[];
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
}

// ─── A2A Card Builder Config ─────────────────────────────────────────────────

export interface AgentCardConfig {
  agentId: string;
  agentLabel: string;
  baseUrl: string;
  capabilities: string[];
  maxAutonomousAmount: number;
  chains: string[];
  monthlyBudget: number;
  currency: string;
}
