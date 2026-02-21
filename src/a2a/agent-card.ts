/**
 * AESP — A2A Agent Card Builder
 *
 * Generates Google A2A-compatible Agent Cards from Yallet agent configuration.
 * Agent Cards allow other AI agents to discover and interact with Yault agents.
 */

import type {
  A2AAgentCard,
  A2ASkill,
  A2AProvider,
  AgentCardConfig,
} from '../types/a2a.js';
import type { AgentIdentityCertificate } from '../types/identity.js';

// ─── Skill Templates ─────────────────────────────────────────────────────────

const SKILL_TEMPLATES: Record<string, Omit<A2ASkill, 'description'>> = {
  payment: {
    id: 'payment',
    name: 'Make payments',
    inputModes: ['application/json'],
    outputModes: ['application/json'],
    tags: ['payment', 'transfer', 'defi'],
  },
  negotiation: {
    id: 'negotiation',
    name: 'Negotiate prices',
    inputModes: ['application/json'],
    outputModes: ['application/json'],
    tags: ['negotiation', 'commerce', 'e2ee'],
  },
  data_query: {
    id: 'data_query',
    name: 'Query financial data',
    inputModes: ['application/json'],
    outputModes: ['application/json'],
    tags: ['data', 'balance', 'budget', 'analytics'],
  },
  commitment: {
    id: 'commitment',
    name: 'Create commitments',
    inputModes: ['application/json'],
    outputModes: ['application/json'],
    tags: ['commitment', 'escrow', 'eip712'],
  },
  delegation: {
    id: 'delegation',
    name: 'Delegate tasks',
    inputModes: ['application/json'],
    outputModes: ['application/json'],
    tags: ['delegation', 'hierarchy', 'sub-agent'],
  },
  arbitration: {
    id: 'arbitration',
    name: 'File disputes',
    inputModes: ['application/json'],
    outputModes: ['application/json'],
    tags: ['dispute', 'arbitration', 'authority'],
  },
};

// ─── Agent Card Builder ──────────────────────────────────────────────────────

export class AgentCardBuilder {
  private provider: A2AProvider = {
    organization: 'Yault',
    url: 'https://yault.app',
  };

  /**
   * Set the provider information.
   */
  setProvider(provider: A2AProvider): this {
    this.provider = provider;
    return this;
  }

  /**
   * Build an A2A Agent Card from agent configuration.
   */
  buildFromConfig(config: AgentCardConfig): A2AAgentCard {
    const skills = this.buildSkills(config);

    return {
      name: config.agentLabel,
      description: this.generateDescription(config),
      url: `${config.baseUrl}/a2a/agent/${config.agentId}`,
      provider: this.provider,
      version: '1.0.0',
      capabilities: {
        streaming: false,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      skills,
      authentication: {
        schemes: ['ed25519'],
      },
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
    };
  }

  /**
   * Build an A2A Agent Card from an Agent Identity Certificate.
   */
  buildFromCertificate(
    cert: AgentIdentityCertificate,
    baseUrl: string,
    label: string,
    monthlyBudget: number = 0,
    currency: string = 'USDC',
  ): A2AAgentCard {
    return this.buildFromConfig({
      agentId: cert.agentId,
      agentLabel: label,
      baseUrl,
      capabilities: cert.capabilities,
      maxAutonomousAmount: cert.maxAutonomousAmount,
      chains: cert.chains,
      monthlyBudget,
      currency,
    });
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private buildSkills(config: AgentCardConfig): A2ASkill[] {
    return config.capabilities
      .map((capability) => {
        const template = SKILL_TEMPLATES[capability];
        if (!template) return null;

        const description = this.generateSkillDescription(
          capability,
          config,
        );

        return {
          ...template,
          description,
        } as A2ASkill;
      })
      .filter((s): s is A2ASkill => s !== null);
  }

  private generateDescription(config: AgentCardConfig): string {
    const parts = [
      `Autonomous ${config.capabilities.join('/')} agent`,
    ];

    if (config.maxAutonomousAmount > 0) {
      parts.push(`up to $${config.maxAutonomousAmount}/tx`);
    }

    if (config.monthlyBudget > 0) {
      parts.push(`$${config.monthlyBudget}/month budget`);
    }

    parts.push(`on Yault (${config.chains.join(', ')})`);

    return parts.join(', ');
  }

  private generateSkillDescription(
    capability: string,
    config: AgentCardConfig,
  ): string {
    switch (capability) {
      case 'payment':
        return `Can make payments up to $${config.maxAutonomousAmount}/transaction, $${config.monthlyBudget}/month total on ${config.chains.join(', ')}`;
      case 'negotiation':
        return `Can negotiate with vendor agents via E2EE channel, max negotiation amount $${config.maxAutonomousAmount}`;
      case 'data_query':
        return `Can query balances, budgets, and transaction history across ${config.chains.join(', ')}`;
      case 'commitment':
        return `Can create and sign EIP-712 structured commitments with escrow support`;
      case 'delegation':
        return `Can delegate sub-tasks to child agents within the hierarchy`;
      case 'arbitration':
        return `Can file and manage disputes through the Yault authority judgment system`;
      default:
        return `Agent capability: ${capability}`;
    }
  }
}

// ─── Convenience ─────────────────────────────────────────────────────────────

/**
 * Quick function to generate an Agent Card from config.
 */
export function generateAgentCard(config: AgentCardConfig): A2AAgentCard {
  return new AgentCardBuilder().buildFromConfig(config);
}
