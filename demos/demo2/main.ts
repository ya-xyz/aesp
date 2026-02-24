/**
 * AESP Demo 2 — Autonomous Cloud Resource Optimizer
 *
 * 12 steps showcasing PolicyEngine advanced features:
 * classifyPolicyChange, timeWindow, allowListMethods, freezeAgent,
 * unfreezeAgent, budgetTracker, and 3-level hierarchy.
 *
 * Panels: Cloud Manager | Cloud Provider | Cost Optimizer
 */

import { setupBrowserMockWasm } from './mock-wasm.js';
import { MockStorage } from './mock-storage.js';
import {
  deriveAgentIdentity,
  createAgentCertificate,
  AgentHierarchyManager,
  PolicyEngine,
  NegotiationStateMachine,
  CommitmentBuilder,
  ReviewManager,
  AgentCardBuilder,
} from '../src/index.js';
import type {
  AgentIdentityCertificate,
  NegotiationOffer,
  NegotiationCounterOffer,
  NegotiationAcceptance,
  ReviewResponse,
  CommitmentRecord,
} from '../src/types/index.js';
import type { AgentPolicy } from '../src/types/policy.js';

// ─── Initialize WASM Mock ────────────────────────────────────────────────────

setupBrowserMockWasm();

// ─── Storage Instances ───────────────────────────────────────────────────────

const devopsStorage = new MockStorage();
const providerStorage = new MockStorage();

// ─── Constants ───────────────────────────────────────────────────────────────

const MNEMONIC_DEVOPS = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_PROVIDER = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const PASSPHRASE = '';

// ─── Shared State ────────────────────────────────────────────────────────────

interface DemoState {
  managerAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  optimizerAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  providerAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  managerCert: AgentIdentityCertificate | null;
  optimizerCert: AgentIdentityCertificate | null;
  providerCert: AgentIdentityCertificate | null;
  policyEngine: PolicyEngine | null;
  reviewManager: ReviewManager | null;
  commitmentBuilder: CommitmentBuilder | null;
  commitment: CommitmentRecord | null;
  cloudPolicy: AgentPolicy | null;
  reviewRequestId: string | null;
  timeline: Array<{ agent: string; action: string; time: string }>;
}

const state: DemoState = {
  managerAgent: null, optimizerAgent: null, providerAgent: null,
  managerCert: null, optimizerCert: null, providerCert: null,
  policyEngine: null, reviewManager: null, commitmentBuilder: null,
  commitment: null, cloudPolicy: null, reviewRequestId: null,
  timeline: [],
};

// ─── Panel Types & Helpers ───────────────────────────────────────────────────

type PanelId = 'manager' | 'provider' | 'optimizer';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PANEL_COLORS: Record<PanelId, string> = {
  manager: 'blue',
  provider: 'green',
  optimizer: 'purple',
};

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function truncate(s: string, max = 16): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function addTimeline(agent: string, action: string) {
  state.timeline.push({ agent, action, time: new Date().toLocaleTimeString() });
}

// ─── Panel Rendering ─────────────────────────────────────────────────────────

interface EntryOpts {
  step: number;
  title: string;
  api?: string;
  description?: string;
  html?: string;
  status?: 'running' | 'pass' | 'fail' | 'interactive' | 'frozen';
}

function pushEntry(panel: PanelId, opts: EntryOpts): HTMLElement {
  const body = $(`panel-${panel}-body`);
  body.innerHTML = '';
  const entry = document.createElement('div');
  const statusClass = opts.status ? `entry-${opts.status}` : 'entry-running';
  entry.className = `entry ${statusClass} slide-up`;

  let headerRight = '';
  if (opts.status === 'pass') headerRight = '<span class="entry-check">\u2713</span>';
  else if (opts.status === 'fail' || opts.status === 'frozen') headerRight = '<span class="entry-cross">\u2717</span>';

  entry.innerHTML = `
    <div class="entry-header">
      <span class="entry-step">${opts.step}</span>
      <span class="entry-title">${opts.title}</span>
      ${headerRight}
    </div>
    ${opts.api ? `<div class="entry-api">\u26A1 ${opts.api}</div>` : ''}
    ${opts.description ? `<div class="entry-desc">${opts.description}</div>` : ''}
    ${opts.html ? `<div class="entry-output">${opts.html}</div>` : ''}
  `;

  body.appendChild(entry);
  body.scrollTop = body.scrollHeight;
  return entry;
}

function updateEntry(entry: HTMLElement, opts: Partial<EntryOpts>) {
  if (opts.status) {
    entry.className = entry.className.replace(/entry-(running|pass|fail|interactive|frozen)/g, '');
    entry.classList.add(`entry-${opts.status}`);
    const existing = entry.querySelector('.entry-check, .entry-cross');
    if (existing) existing.remove();
    const header = entry.querySelector('.entry-header');
    if (opts.status === 'pass' && header) {
      header.insertAdjacentHTML('beforeend', '<span class="entry-check">\u2713</span>');
    } else if ((opts.status === 'fail' || opts.status === 'frozen') && header) {
      header.insertAdjacentHTML('beforeend', '<span class="entry-cross">\u2717</span>');
    }
  }
  if (opts.html !== undefined) {
    let output = entry.querySelector('.entry-output') as HTMLElement;
    if (!output) {
      output = document.createElement('div');
      output.className = 'entry-output';
      entry.appendChild(output);
    }
    output.innerHTML = opts.html;
  }
}

// ─── Panel Highlight ─────────────────────────────────────────────────────────

function highlightPanel(panel: PanelId) {
  $(`panel-${panel}`).classList.add(`glow-${PANEL_COLORS[panel]}`);
}

function unhighlightPanel(panel: PanelId) {
  const el = $(`panel-${panel}`);
  el.classList.remove('glow-blue', 'glow-green', 'glow-purple', 'glow-amber', 'glow-red');
}

function highlightPanelColor(panel: PanelId, color: string) {
  $(`panel-${panel}`).classList.add(`glow-${color}`);
}

function unhighlightAll() {
  (['manager', 'provider', 'optimizer'] as PanelId[]).forEach(unhighlightPanel);
}

// ─── SVG Connection Lines ────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  blue: '#58a6ff', green: '#3fb950', purple: '#bc8cff',
  amber: '#d29922', red: '#f85149',
};

function getEdge(panel: PanelId, edge: 'top' | 'bottom' | 'left' | 'right', offset = 0) {
  const el = $(`panel-${panel}`);
  const main = $('main');
  const pr = el.getBoundingClientRect();
  const mr = main.getBoundingClientRect();
  const x = pr.left - mr.left;
  const y = pr.top - mr.top;
  switch (edge) {
    case 'top':    return { x: x + pr.width / 2 + offset, y };
    case 'bottom': return { x: x + pr.width / 2 + offset, y: y + pr.height };
    case 'left':   return { x, y: y + pr.height / 2 + offset };
    case 'right':  return { x: x + pr.width, y: y + pr.height / 2 + offset };
  }
}

function getConnectionPoints(from: PanelId, to: PanelId, offset = 0) {
  if (from === 'manager' && to === 'provider')
    return { p1: getEdge('manager', 'right', offset), p2: getEdge('provider', 'left', offset) };
  if (from === 'provider' && to === 'manager')
    return { p1: getEdge('provider', 'left', offset), p2: getEdge('manager', 'right', offset) };
  if (from === 'manager' && to === 'optimizer')
    return { p1: getEdge('manager', 'bottom', offset), p2: getEdge('optimizer', 'top', offset > 0 ? offset : -15) };
  if (from === 'optimizer' && to === 'manager')
    return { p1: getEdge('optimizer', 'top', offset > 0 ? offset : -15), p2: getEdge('manager', 'bottom', offset) };
  if (from === 'provider' && to === 'optimizer')
    return { p1: getEdge('provider', 'bottom', offset), p2: getEdge('optimizer', 'top', offset > 0 ? offset : 15) };
  if (from === 'optimizer' && to === 'provider')
    return { p1: getEdge('optimizer', 'top', offset > 0 ? offset : 15), p2: getEdge('provider', 'bottom', offset) };
  return { p1: getEdge(from, 'right'), p2: getEdge(to, 'left') };
}

let connectionIndex = 0;

function drawConnection(from: PanelId, to: PanelId, label: string, color: string): void {
  const svg = $('svg-overlay') as unknown as SVGSVGElement;
  const offset = (connectionIndex % 3 - 1) * 14;
  connectionIndex++;
  const { p1, p2 } = getConnectionPoints(from, to, offset);
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(p1.x)); line.setAttribute('y1', String(p1.y));
  line.setAttribute('x2', String(p2.x)); line.setAttribute('y2', String(p2.y));
  line.setAttribute('stroke', COLOR_MAP[color] || COLOR_MAP.blue);
  line.setAttribute('marker-end', `url(#arrow-${color})`);
  line.classList.add('connection-line');
  svg.appendChild(line);
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2 - 8;
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', String(mx)); text.setAttribute('y', String(my));
  text.setAttribute('fill', COLOR_MAP[color] || COLOR_MAP.blue);
  text.textContent = label;
  text.classList.add('connection-label');
  svg.appendChild(text);
}

function fadeConnections() {
  const svg = $('svg-overlay');
  svg.querySelectorAll('.connection-line').forEach((el) => el.classList.add('faded'));
  svg.querySelectorAll('.connection-label').forEach((el) => el.classList.add('faded'));
}

function clearConnections() {
  const svg = $('svg-overlay');
  svg.querySelectorAll('.connection-line, .connection-label').forEach((el) => el.remove());
  connectionIndex = 0;
}

function fsmState(text: string, cls: string): string {
  return `<span class="fsm-state ${cls}">${text}</span>`;
}

function fsmArrow(): string {
  return `<span class="fsm-arrow">\u2192</span>`;
}

function outputBlock(label: string, value: string): string {
  return `<div class="output-block"><div class="output-label">${label}</div><div class="output-value">${value}</div></div>`;
}

// ─── Step Implementations ────────────────────────────────────────────────────

async function step1_identity() {
  highlightPanel('manager'); highlightPanel('provider'); highlightPanel('optimizer');
  fadeConnections();

  state.managerAgent = await deriveAgentIdentity({ mnemonic: MNEMONIC_DEVOPS, passphrase: PASSPHRASE, agentIndex: 0 });
  state.optimizerAgent = await deriveAgentIdentity({ mnemonic: MNEMONIC_DEVOPS, passphrase: PASSPHRASE, agentIndex: 1 });
  state.providerAgent = await deriveAgentIdentity({ mnemonic: MNEMONIC_PROVIDER, passphrase: PASSPHRASE, agentIndex: 0 });

  state.managerCert = await createAgentCertificate({
    mnemonic: MNEMONIC_DEVOPS, passphrase: PASSPHRASE, agentIndex: 0,
    ownerXidentity: btoa('devops_owner_xidentity'),
    capabilities: ['payment', 'negotiation', 'commitment', 'delegation'],
    chains: ['ethereum'], maxAutonomousAmount: 50, policy: { maxPerTx: 50, maxPerDay: 200 }, validDays: 365,
  });
  state.optimizerCert = await createAgentCertificate({
    mnemonic: MNEMONIC_DEVOPS, passphrase: PASSPHRASE, agentIndex: 1,
    ownerXidentity: btoa('devops_owner_xidentity'),
    capabilities: ['negotiation', 'delegation'],
    chains: ['ethereum'], maxAutonomousAmount: 10, policy: { maxPerTx: 10 }, validDays: 365,
  });
  state.providerCert = await createAgentCertificate({
    mnemonic: MNEMONIC_PROVIDER, passphrase: PASSPHRASE, agentIndex: 0,
    ownerXidentity: btoa('cloudscale_owner_xidentity'),
    capabilities: ['payment', 'negotiation', 'commitment'],
    chains: ['ethereum', 'polygon'], maxAutonomousAmount: 10000, policy: { maxPerTx: 10000 }, validDays: 365,
  });

  addTimeline('manager', 'Cloud Manager agent derived');
  addTimeline('optimizer', 'Cost Optimizer sub-agent derived');
  addTimeline('provider', 'Cloud Provider agent derived');

  pushEntry('manager', {
    step: 1, title: 'Cloud Manager Identity',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'I manage cloud infrastructure autonomously. My DevOps owner set me up to handle compute scaling and vendor negotiations.',
    status: 'pass',
    html: `DID: ${truncate(state.managerAgent.did, 30)}<br>Caps: payment, negotiation, commitment, delegation`,
  });
  await delay(1000);
  pushEntry('provider', {
    step: 1, title: 'CloudScale Provider Identity',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'I represent CloudScale Inc. I offer compute, storage, and CDN services with bulk discount plans.',
    status: 'pass',
    html: `DID: ${truncate(state.providerAgent.did, 30)}<br>Caps: payment, negotiation, commitment`,
  });
  await delay(1000);
  pushEntry('optimizer', {
    step: 1, title: 'Cost Optimizer Identity',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'I monitor resource usage and costs in real-time. I can flag anomalies and propose budget adjustments.',
    status: 'pass',
    html: `DID: ${truncate(state.optimizerAgent.did, 30)}<br>Caps: negotiation, delegation`,
  });
  unhighlightAll();
}

async function step2_hierarchy() {
  highlightPanel('manager'); highlightPanel('optimizer');
  clearConnections();

  const hierarchy = new AgentHierarchyManager(devopsStorage);
  hierarchy.addAgent(state.managerAgent!.agentId, 'Cloud Manager Agent');
  hierarchy.addAgent(state.optimizerAgent!.agentId, 'Cost Optimizer', state.managerAgent!.agentId);

  const chain = hierarchy.getEscalationChain(state.optimizerAgent!.agentId);
  const tree = hierarchy.getHierarchy();

  addTimeline('manager', 'Hierarchy: Human \u2192 Cloud Manager \u2192 Cost Optimizer');

  pushEntry('manager', {
    step: 2, title: '3-Level Hierarchy Established',
    api: 'AgentHierarchyManager.addAgent()',
    description: 'My DevOps owner registered me as top-level agent. I then delegated monitoring to the Cost Optimizer sub-agent.',
    status: 'pass',
    html: `Human \u2192 Cloud Manager \u2192 Cost Optimizer<br>Escalation chain: ${chain.length} levels | Total: ${tree.totalAgents} agents`,
  });
  await delay(1000);

  pushEntry('optimizer', {
    step: 2, title: 'Delegation Accepted',
    api: 'AgentHierarchyManager.getEscalationChain()',
    description: 'I am a sub-agent of Cloud Manager. Any issues I detect escalate: me \u2192 Cloud Manager \u2192 DevOps Human.',
    status: 'pass',
    html: `Escalation: ${chain.join(' \u2192 ')}`,
  });

  drawConnection('manager', 'optimizer', 'Delegates to', 'blue');
  unhighlightAll();
}

async function step3_policy() {
  highlightPanel('manager');
  clearConnections();

  state.policyEngine = new PolicyEngine(devopsStorage);
  const now = new Date();
  const expires = new Date(now.getTime() + 365 * 86400000);

  const cloudPolicy: AgentPolicy = {
    id: 'cloud-policy',
    agentId: state.managerAgent!.agentId,
    agentLabel: 'Cloud Manager',
    scope: 'auto_payment',
    conditions: {
      maxAmountPerTx: 50,
      maxAmountPerDay: 200,
      maxAmountPerWeek: 1000,
      maxAmountPerMonth: 3000,
      allowListAddresses: [],
      allowListChains: ['ethereum'],
      allowListMethods: ['scale_up', 'scale_down', 'purchase_compute'],
      minBalanceAfter: 100,
      requireReviewBeforeFirstPay: false,
      timeWindow: { start: '09:00', end: '18:00' },
    },
    escalation: 'ask_human',
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    signature: '',
  };
  state.cloudPolicy = cloudPolicy;
  state.policyEngine.addPolicy(cloudPolicy);

  addTimeline('manager', 'Policy: $50/tx, $200/day, 09:00-18:00, ETH only');

  pushEntry('manager', {
    step: 3, title: 'Spending Policy Configured',
    api: 'PolicyEngine.addPolicy()',
    description: 'My owner set strict guardrails: $50/tx max, $200/day budget, Ethereum only, and operations restricted to business hours (09:00\u201318:00).',
    status: 'pass',
    html: `Max/Tx: $50 | Max/Day: $200 | Time: 09-18h<br>Methods: scale_up, scale_down, purchase_compute<br>Min balance after: $100 | Chain: Ethereum`,
  });
  unhighlightAll();
}

async function step4_a2a() {
  highlightPanel('provider'); highlightPanel('manager');
  clearConnections();

  const builder = new AgentCardBuilder();
  builder.setProvider({ organization: 'CloudScale Inc.', url: 'https://cloudscale.example.com' });
  const card = builder.buildFromCertificate(
    state.providerCert!, 'https://cloudscale.example.com',
    'CloudScale Provider Agent', 10000, 'USDC',
  );

  addTimeline('provider', 'A2A agent card published');
  addTimeline('manager', 'Discovered CloudScale via A2A');

  pushEntry('provider', {
    step: 4, title: 'Service Card Published',
    api: 'AgentCardBuilder.buildFromCertificate()',
    description: 'Publishing my A2A agent card so other agents can discover CloudScale compute offerings and initiate negotiations.',
    status: 'pass',
    html: `Skills: ${card.skills.map((s) => s.name).join(', ')}`,
  });
  await delay(1000);

  drawConnection('provider', 'manager', 'A2A Agent Card', 'green');
  await delay(1000);

  pushEntry('manager', {
    step: 4, title: 'Discovered CloudScale',
    api: 'A2A Discovery Protocol',
    description: 'Found CloudScale\'s agent card. Verified certificate and capabilities. Ready to negotiate compute resources.',
    status: 'pass',
  });
  unhighlightAll();
}

async function step5_negotiation() {
  highlightPanel('manager'); highlightPanel('provider');
  clearConnections();

  const fsm = new NegotiationStateMachine();
  const session = fsm.createSession({
    myAgentId: state.managerAgent!.agentId,
    counterpartyAgentId: state.providerAgent!.agentId,
  });
  const deadline = new Date(Date.now() + 3600000).toISOString();

  const offer: NegotiationOffer = {
    item: 'Annual Cloud Compute Plan (8 vCPU, 32GB RAM)', price: '600', currency: 'USDC',
    terms: ['99.9% uptime SLA', 'Auto-scaling included', 'Priority support'], deadline,
  };
  fsm.sendOffer(session.sessionId, state.managerAgent!.agentId, offer);

  const counter: NegotiationCounterOffer = {
    item: 'Annual Cloud Compute Plan (8 vCPU, 32GB RAM)', counterPrice: '500', currency: 'USDC',
    counterTerms: ['99.9% uptime SLA', 'Auto-scaling included', 'Priority support', 'Bulk discount applied'], deadline,
    reason: '17% annual commitment discount',
  };
  fsm.sendCounter(session.sessionId, state.providerAgent!.agentId, counter);

  const acceptance: NegotiationAcceptance = {
    agreementHash: 'mock_agreement_hash_cloud_plan',
    acceptedPrice: '500',
    acceptedTerms: ['99.9% uptime SLA', 'Auto-scaling included', 'Priority support', 'Bulk discount applied'],
  };
  fsm.accept(session.sessionId, state.managerAgent!.agentId, acceptance);

  addTimeline('manager', 'Offer: $600/year for compute plan');
  addTimeline('provider', 'Counter: $500/year (17% bulk discount)');
  addTimeline('manager', 'Accepted: $500/year');

  pushEntry('manager', {
    step: 5, title: 'Offering $600/yr Compute Plan',
    api: 'NegotiationStateMachine.sendOffer()',
    description: 'Initiating annual contract negotiation with CloudScale for dedicated compute (8 vCPU, 32GB RAM).',
    status: 'pass',
  });
  drawConnection('manager', 'provider', 'Offer $600/yr', 'blue');
  await delay(2500);

  pushEntry('provider', {
    step: 5, title: 'Counter: $500/yr (-17%)',
    api: 'NegotiationStateMachine.sendCounter()',
    description: 'Applying a 17% bulk discount for annual commitment. Counter-offering at $500/year with full SLA.',
    status: 'pass',
  });
  drawConnection('provider', 'manager', 'Counter $500/yr', 'green');
  await delay(2500);

  pushEntry('manager', {
    step: 5, title: 'Deal Accepted at $500/yr',
    api: 'NegotiationStateMachine.accept()',
    description: 'Great savings! Accepting the $500 annual plan. But this exceeds my $50/tx limit \u2014 will need human approval.',
    status: 'pass',
    html: `<div class="fsm-flow">${fsmState('offer', 'done')}${fsmArrow()}${fsmState('counter', 'done')}${fsmArrow()}${fsmState('accepted', 'active')}</div>`,
  });
  drawConnection('manager', 'provider', 'Accept \u2713', 'blue');
  unhighlightAll();
}

async function step6_commitment() {
  highlightPanel('manager'); highlightPanel('provider');
  clearConnections();

  state.commitmentBuilder = new CommitmentBuilder(devopsStorage);
  const record = state.commitmentBuilder.createCommitment({
    buyerAgent: state.managerAgent!.agentId,
    sellerAgent: state.providerAgent!.agentId,
    item: 'Annual Cloud Compute Plan (8 vCPU, 32GB RAM)',
    price: '500', currency: 'USDC',
    deliveryDeadline: Math.floor(Date.now() / 1000) + 365 * 86400,
    arbitrator: 'yault-authority', escrowRequired: true, chainId: 1,
  });

  await state.commitmentBuilder.signAsBuyer(record.id, MNEMONIC_DEVOPS, PASSPHRASE);
  await state.commitmentBuilder.signAsSeller(record.id, MNEMONIC_PROVIDER, PASSPHRASE);
  state.commitment = state.commitmentBuilder.getCommitment(record.id)!;

  addTimeline('manager', 'Signed annual SLA as buyer');
  addTimeline('provider', 'Signed annual SLA as seller');

  pushEntry('manager', {
    step: 6, title: 'Signed Annual SLA Commitment',
    api: 'CommitmentBuilder.signAsBuyer()',
    description: 'Creating an EIP-712 binding commitment for the $500 annual plan. This is a cryptographic SLA agreement.',
    status: 'pass',
    html: `$500 USDC | 1-year term | Escrow: on`,
  });
  drawConnection('manager', 'provider', 'EIP-712 Dual-Sign', 'blue');
  await delay(1000);

  pushEntry('provider', {
    step: 6, title: 'SLA Commitment Co-signed',
    api: 'CommitmentBuilder.signAsSeller()',
    description: 'Co-signing the annual service commitment. Both signatures make this a binding SLA with escrow protection.',
    status: 'pass',
    html: `Status: ${state.commitment.status} | 99.9% uptime guaranteed`,
  });
  unhighlightAll();
}

async function step7_policyCheck() {
  highlightPanel('manager');
  clearConnections();

  const approved = await state.policyEngine!.checkAutoApprove({
    requestId: 'req-scale-45',
    vendorId: state.managerAgent!.agentId,
    action: {
      type: 'transfer',
      payload: { chainId: 'ethereum', token: 'native', toAddress: '0xCloudScale0001', amount: '45' },
    },
  });

  const rejected = await state.policyEngine!.checkAutoApprove({
    requestId: 'req-annual-500',
    vendorId: state.managerAgent!.agentId,
    action: {
      type: 'transfer',
      payload: { chainId: 'ethereum', token: 'native', toAddress: '0xCloudScale0001', amount: '500' },
    },
  });

  addTimeline('manager', `$45 auto-scaling: ${approved ? 'AUTO-APPROVED' : 'REJECTED'}`);
  addTimeline('manager', `$500 annual plan: ${rejected ? 'AUTO-APPROVED' : 'NEEDS REVIEW'}`);

  pushEntry('manager', {
    step: 7, title: '$45 Auto-Scale \u2192 APPROVED',
    api: 'PolicyEngine.checkAutoApprove()',
    description: 'Checking $45 compute scaling request... Under my $50/tx limit. I can execute this autonomously!',
    status: 'pass',
    html: `<span class="tag-pass">AUTO-APPROVED</span> $45 < $50 limit`,
  });
  await delay(2500);

  pushEntry('manager', {
    step: 7, title: '$500 Annual Plan \u2192 BLOCKED',
    api: 'PolicyEngine.checkAutoApprove()',
    description: '$500 exceeds my $50/tx limit by 10x. This requires escalation to my DevOps owner for review.',
    status: 'fail',
    html: `<span class="tag-fail">NEEDS HUMAN REVIEW</span> $500 >> $50/tx limit`,
  });
  unhighlightAll();
}

async function step8_policyChange() {
  highlightPanel('optimizer'); highlightPanel('manager');
  clearConnections();

  const currentPolicy = state.cloudPolicy!;
  const proposedPolicy: AgentPolicy = {
    ...currentPolicy,
    conditions: {
      ...currentPolicy.conditions,
      maxAmountPerDay: 400,
    },
  };

  const classification = state.policyEngine!.classifyPolicyChange(proposedPolicy, 'cloud-policy');

  addTimeline('optimizer', `Proposed daily limit: $200 \u2192 $400`);
  addTimeline('optimizer', `Classification: ${classification.approvalLevel} (${classification.criticalChanges.join(', ')})`);

  pushEntry('optimizer', {
    step: 8, title: 'Proposing Budget Increase',
    api: 'PolicyEngine.classifyPolicyChange()',
    description: 'I detected we frequently hit the $200/day ceiling during peak hours. Proposing to raise the daily limit to $400.',
    status: 'pass',
  });
  drawConnection('optimizer', 'manager', 'Budget Proposal', 'purple');
  await delay(2500);

  pushEntry('manager', {
    step: 8, title: 'Policy Change \u2192 BIOMETRIC',
    api: 'classifyPolicyChange()',
    description: `Budget increase detected! This change requires biometric-level approval from the DevOps owner. Escalation level: ${classification.approvalLevel}.`,
    status: 'fail',
    html: `<span class="tag-fail">${classification.approvalLevel.toUpperCase()}</span> ${classification.reasons.join('<br>')}<br>Critical changes: ${classification.criticalChanges.join(', ')}`,
  });
  unhighlightAll();
}

async function step9_freeze() {
  highlightPanelColor('manager', 'red');
  highlightPanel('optimizer');
  clearConnections();

  state.reviewManager = new ReviewManager(devopsStorage);

  const freezeStatus = state.reviewManager.freezeAgent({
    agentId: state.managerAgent!.agentId,
    reason: 'Unusual spending spike: $180 in the last hour (normal: $40/hr)',
    initiatedBy: 'parent_agent',
    freezeAt: new Date().toISOString(),
  });

  addTimeline('optimizer', 'ALERT: Anomalous spending detected!');
  addTimeline('optimizer', `FREEZE: Cloud Manager frozen`);

  pushEntry('optimizer', {
    step: 9, title: 'Anomaly Detected!',
    api: 'ReviewManager.freezeAgent()',
    description: 'I detected an unusual 4.5x spending spike ($180/hr vs normal $40/hr). Emergency-freezing Cloud Manager to prevent further damage.',
    status: 'frozen',
    html: `<span class="tag-frozen">EMERGENCY FREEZE</span><br>Reason: ${freezeStatus.reason}`,
  });
  drawConnection('optimizer', 'manager', 'FREEZE!', 'red');
  await delay(1500);

  const isFrozen = state.reviewManager.isAgentFrozen(state.managerAgent!.agentId);

  pushEntry('manager', {
    step: 9, title: 'AGENT FROZEN',
    api: 'ReviewManager.isAgentFrozen()',
    description: 'I have been emergency-frozen by my Cost Optimizer sub-agent. All operations are blocked until my DevOps owner intervenes.',
    status: 'frozen',
    html: `<span class="tag-frozen">FROZEN</span> Status: ${isFrozen ? 'BLOCKED' : 'active'}<br>All payments & operations suspended`,
  });
  unhighlightAll();
  highlightPanelColor('manager', 'red');
}

async function step10_review(): Promise<void> {
  highlightPanelColor('manager', 'amber');
  clearConnections();

  // DevOps owner received the freeze alert — temporarily unfreeze to allow review
  state.reviewManager!.unfreezeAgent(state.managerAgent!.agentId);

  const request = state.reviewManager!.createReviewRequestAsync({
    agentId: state.managerAgent!.agentId,
    agentLabel: 'Cloud Manager',
    action: 'transfer',
    summary: 'Approve $500 Annual Cloud Compute Plan + Unfreeze Agent',
    details: {
      chain: 'ethereum', to: '0xCloudScale0001',
      amount: '500', currency: 'USDC',
      context: 'Annual plan from negotiation. Agent currently frozen due to spending anomaly.',
    },
    policyViolation: { rule: 'maxAmountPerTx', actual: '500', limit: '50' },
    urgency: 'high',
    deadlineMs: 300000,
  });

  state.reviewRequestId = request.requestId;
  addTimeline('manager', 'Review request: $500 annual plan + unfreeze');

  const entry = pushEntry('manager', {
    step: 10, title: '\u{1F4F1} DevOps Review Required',
    api: 'ReviewManager.createReviewRequestAsync()',
    description: 'Sending a push notification to my DevOps owner. They need to: (1) approve the $500 annual plan, and (2) unfreeze me.',
    status: 'interactive',
    html: `
      $500 annual plan + agent unfreeze<br>
      <div class="review-actions">
        <button class="btn btn-approve" id="btn-approve">Approve & Unfreeze</button>
        <button class="btn btn-reject" id="btn-reject">Reject</button>
      </div>
    `,
  });

  return new Promise<void>((resolve) => {
    $('btn-approve').addEventListener('click', () => {
      const response: ReviewResponse = {
        requestId: state.reviewRequestId!,
        decision: 'approve',
        respondedAt: new Date().toISOString(),
        respondedVia: 'mobile',
        biometricVerified: true,
      };
      state.reviewManager!.submitResponse(response);
      state.reviewManager!.unfreezeAgent(state.managerAgent!.agentId);
      addTimeline('manager', 'APPROVED: $500 plan | UNFROZEN');

      updateEntry(entry, {
        status: 'pass',
        html: `<span class="tag-pass">APPROVED + UNFROZEN</span><br>Biometric: \u2713 | Via: mobile`,
      });
      unhighlightAll();
      resolve();
    });

    $('btn-reject').addEventListener('click', () => {
      const response: ReviewResponse = {
        requestId: state.reviewRequestId!,
        decision: 'reject',
        respondedAt: new Date().toISOString(),
        respondedVia: 'mobile',
        biometricVerified: false,
      };
      state.reviewManager!.submitResponse(response);
      // Re-freeze the agent since the review was rejected
      state.reviewManager!.freezeAgent({
        agentId: state.managerAgent!.agentId,
        reason: 'Review rejected — agent re-frozen pending further investigation',
        initiatedBy: 'human',
        freezeAt: new Date().toISOString(),
      });
      addTimeline('manager', 'REJECTED: $500 plan. Agent re-frozen.');

      updateEntry(entry, {
        status: 'fail',
        html: `<span class="tag-fail">REJECTED</span> Agent remains frozen`,
      });
      unhighlightAll();
      resolve();
    });
  });
}

async function step11_budget() {
  highlightPanel('manager'); highlightPanel('optimizer');
  clearConnections();

  // Record the approved $45 scaling execution
  await state.policyEngine!.recordExecution(
    'req-scale-45', 'cloud-policy',
    { success: true, txHash: '0xmock_scaling_tx_45', requestId: 'req-scale-45', timestamp: Date.now() },
    {
      requestId: 'req-scale-45',
      vendorId: state.managerAgent!.agentId,
      action: { type: 'transfer', payload: { chainId: 'ethereum', token: 'native', toAddress: '0xCloudScale0001', amount: '45' } },
    },
  );

  // Record a second $30 scaling
  await state.policyEngine!.recordExecution(
    'req-scale-30', 'cloud-policy',
    { success: true, txHash: '0xmock_scaling_tx_30', requestId: 'req-scale-30', timestamp: Date.now() },
    {
      requestId: 'req-scale-30',
      vendorId: state.managerAgent!.agentId,
      action: { type: 'transfer', payload: { chainId: 'ethereum', token: 'native', toAddress: '0xCloudScale0001', amount: '30' } },
    },
  );

  const usage = await state.policyEngine!.getUsageToday('cloud-policy');
  const budget = state.policyEngine!.getBudgetTracker();

  addTimeline('manager', `Daily spend: $${usage.amountByToken.native ?? 0} (${usage.count} txns)`);
  addTimeline('optimizer', 'Budget utilization tracked');

  pushEntry('manager', {
    step: 11, title: 'Daily Budget Tracking',
    api: 'PolicyEngine.getUsageToday() + BudgetTracker',
    description: 'Reviewing my spending for today. Two successful auto-scaling operations were executed within policy limits.',
    status: 'pass',
    html: `Today: $${usage.amountByToken.native ?? 0} of $200 daily limit<br>Transactions: ${usage.count}<br>Remaining: $${200 - Number(usage.amountByToken.native ?? 0)}`,
  });
  await delay(1000);

  pushEntry('optimizer', {
    step: 11, title: 'Utilization Report',
    api: 'PolicyEngine.getUsageToday()',
    description: `Cloud Manager has used ${Math.round(Number(usage.amountByToken.native ?? 0) / 200 * 100)}% of its daily budget. Operating within normal parameters.`,
    status: 'pass',
    html: `<span class="tag-pass">HEALTHY</span> ${Math.round(Number(usage.amountByToken.native ?? 0) / 200 * 100)}% daily utilization`,
  });
  unhighlightAll();
}

async function step12_summary() {
  highlightPanel('manager'); highlightPanel('provider'); highlightPanel('optimizer');
  clearConnections();

  const mgrEvents = state.timeline.filter((t) => t.agent === 'manager');
  const provEvents = state.timeline.filter((t) => t.agent === 'provider');
  const optEvents = state.timeline.filter((t) => t.agent === 'optimizer');

  const renderEntries = (events: typeof state.timeline) =>
    events.map((e) => `<div class="summary-entry"><span class="time">${e.time}</span>${e.action}</div>`).join('');

  const panels = document.querySelector('.panels')!;
  document.querySelector('.summary-section')?.remove();

  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'summary-section slide-up';
  summaryDiv.innerHTML = `
    <h3>\u{1F4CA} Full Three-Party Audit Trail</h3>
    <div class="summary-grid">
      <div class="summary-col manager"><h4>\u2601\uFE0F Cloud Manager</h4>${renderEntries(mgrEvents)}</div>
      <div class="summary-col provider"><h4>\u{1F3ED} Cloud Provider</h4>${renderEntries(provEvents)}</div>
      <div class="summary-col optimizer"><h4>\u26A1 Cost Optimizer</h4>${renderEntries(optEvents)}</div>
    </div>
    ${outputBlock('Audit Summary', `
Total events: ${state.timeline.length}
Commitments: 1 (Annual SLA $500)
Policy checks: 2 (1 approved, 1 escalated)
Policy change classification: 1 (biometric required)
Emergency freezes: 1 (anomaly detection)
Budget tracking: $75 of $200 daily used
Modules exercised: Identity, Hierarchy, Policy (advanced), A2A, Negotiation, Commitment, Review (freeze/unfreeze), Budget`)}
  `;
  panels.after(summaryDiv);

  pushEntry('manager', { step: 12, title: 'Audit Complete', status: 'pass', description: `${mgrEvents.length} events logged` });
  pushEntry('provider', { step: 12, title: 'Audit Complete', status: 'pass', description: `${provEvents.length} events logged` });
  pushEntry('optimizer', { step: 12, title: 'Audit Complete', status: 'pass', description: `${optEvents.length} events logged` });

  drawConnection('manager', 'provider', '$500 SLA', 'blue');
  drawConnection('optimizer', 'manager', 'Monitor', 'purple');
}

// ─── Orchestration ───────────────────────────────────────────────────────────

const steps: Array<() => Promise<void>> = [
  step1_identity, step2_hierarchy, step3_policy, step4_a2a,
  step5_negotiation, step6_commitment, step7_policyCheck, step8_policyChange,
  step9_freeze, step10_review, step11_budget, step12_summary,
];

let running = false;

async function runAllSteps() {
  if (running) return;
  running = true;
  const btn = $('btn-run-all') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running...';

  for (let i = 0; i < steps.length; i++) {
    try {
      await steps[i]();
      await delay(5000);
    } catch (err) {
      console.error(`Step ${i + 1} failed:`, err);
      pushEntry('manager', { step: i + 1, title: `Error: Step ${i + 1}`, status: 'fail', html: `${(err as Error).message}` });
      break;
    }
  }

  running = false;
  btn.disabled = false;
  btn.textContent = '\u25B6 Run Demo';
}

function resetAll() {
  if (running) return;
  (['manager', 'provider', 'optimizer'] as PanelId[]).forEach((p) => {
    $(`panel-${p}-body`).innerHTML = '';
    unhighlightPanel(p);
  });
  clearConnections();
  document.querySelector('.summary-section')?.remove();
  Object.keys(state).forEach((key) => {
    const k = key as keyof DemoState;
    if (k === 'timeline') state.timeline = [];
    else (state as unknown as Record<string, unknown>)[k] = null;
  });
  devopsStorage.clear();
  providerStorage.clear();
  setupBrowserMockWasm();
}

document.addEventListener('DOMContentLoaded', () => {
  $('btn-run-all').addEventListener('click', runAllSteps);
  $('btn-reset').addEventListener('click', resetAll);
});
