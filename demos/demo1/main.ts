/**
 * AESP Demo — Three-Party Grocery Delivery (Panel Layout)
 *
 * 14 steps across 3 phases, rendered into 3 agent panels with
 * animated SVG connection lines and slide-up entries.
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
  AddressPoolManager,
  ContextTagManager,
} from '../src/index.js';
import type {
  AgentIdentityCertificate,
  NegotiationOffer,
  NegotiationCounterOffer,
  NegotiationAcceptance,
  ReviewResponse,
  CommitmentRecord,
} from '../src/types/index.js';

// ─── Initialize WASM Mock ────────────────────────────────────────────────────

setupBrowserMockWasm();

// ─── Storage Instances ───────────────────────────────────────────────────────

const userStorage = new MockStorage();
const supermarketStorage = new MockStorage();

// ─── Constants ───────────────────────────────────────────────────────────────

const MNEMONIC_USER = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_SUPERMARKET = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const PASSPHRASE = '';

// ─── Shared State ────────────────────────────────────────────────────────────

interface DemoState {
  userAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  supermarketAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  robotAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  userCert: AgentIdentityCertificate | null;
  supermarketCert: AgentIdentityCertificate | null;
  robotCert: AgentIdentityCertificate | null;
  policyEngine: PolicyEngine | null;
  reviewManager: ReviewManager | null;
  commitmentBuilder: CommitmentBuilder | null;
  commitmentBuilderSM: CommitmentBuilder | null;
  addressPool: AddressPoolManager | null;
  contextTagManager: ContextTagManager | null;
  commitment1: CommitmentRecord | null;
  commitment2: CommitmentRecord | null;
  reviewRequestId: string | null;
  timeline: Array<{ agent: string; action: string; time: string }>;
}

const state: DemoState = {
  userAgent: null, supermarketAgent: null, robotAgent: null,
  userCert: null, supermarketCert: null, robotCert: null,
  policyEngine: null, reviewManager: null, commitmentBuilder: null,
  commitmentBuilderSM: null, addressPool: null, contextTagManager: null,
  commitment1: null, commitment2: null, reviewRequestId: null,
  timeline: [],
};

// ─── Panel Types & Helpers ───────────────────────────────────────────────────

type PanelId = 'user' | 'supermarket' | 'robot';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PANEL_COLORS: Record<PanelId, string> = {
  user: 'blue',
  supermarket: 'green',
  robot: 'purple',
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
  status?: 'running' | 'pass' | 'fail' | 'interactive';
}

function pushEntry(panel: PanelId, opts: EntryOpts): HTMLElement {
  const body = $(`panel-${panel}-body`);
  // Only show the current step — clear previous entries
  body.innerHTML = '';
  const entry = document.createElement('div');
  const statusClass = opts.status ? `entry-${opts.status}` : 'entry-running';
  entry.className = `entry ${statusClass} slide-up`;

  let headerRight = '';
  if (opts.status === 'pass') headerRight = '<span class="entry-check">\u2713</span>';
  else if (opts.status === 'fail') headerRight = '<span class="entry-cross">\u2717</span>';

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
    entry.className = entry.className.replace(/entry-(running|pass|fail|interactive)/g, '');
    entry.classList.add(`entry-${opts.status}`);
    // Update header icon
    const existing = entry.querySelector('.entry-check, .entry-cross');
    if (existing) existing.remove();
    const header = entry.querySelector('.entry-header');
    if (opts.status === 'pass' && header) {
      header.insertAdjacentHTML('beforeend', '<span class="entry-check">\u2713</span>');
    } else if (opts.status === 'fail' && header) {
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
  const el = $(`panel-${panel}`);
  el.classList.add(`glow-${PANEL_COLORS[panel]}`);
}

function unhighlightPanel(panel: PanelId) {
  const el = $(`panel-${panel}`);
  el.classList.remove('glow-blue', 'glow-green', 'glow-purple', 'glow-amber');
}

function highlightPanelAmber(panel: PanelId) {
  const el = $(`panel-${panel}`);
  el.classList.add('glow-amber');
}

function unhighlightAll() {
  (['user', 'supermarket', 'robot'] as PanelId[]).forEach(unhighlightPanel);
}

// ─── SVG Connection Lines ────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  blue: '#58a6ff',
  green: '#3fb950',
  purple: '#bc8cff',
  amber: '#d29922',
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
  if (from === 'user' && to === 'supermarket')
    return { p1: getEdge('user', 'right', offset), p2: getEdge('supermarket', 'left', offset) };
  if (from === 'supermarket' && to === 'user')
    return { p1: getEdge('supermarket', 'left', offset), p2: getEdge('user', 'right', offset) };
  if (from === 'supermarket' && to === 'robot')
    return { p1: getEdge('supermarket', 'bottom', offset), p2: getEdge('robot', 'top', offset > 0 ? offset : 15) };
  if (from === 'robot' && to === 'supermarket')
    return { p1: getEdge('robot', 'top', offset > 0 ? offset : 15), p2: getEdge('supermarket', 'bottom', offset) };
  if (from === 'user' && to === 'robot')
    return { p1: getEdge('user', 'bottom', offset), p2: getEdge('robot', 'top', offset > 0 ? offset : -15) };
  if (from === 'robot' && to === 'user')
    return { p1: getEdge('robot', 'top', offset > 0 ? offset : -15), p2: getEdge('user', 'bottom', offset) };
  // fallback
  return { p1: getEdge(from, 'right'), p2: getEdge(to, 'left') };
}

let connectionIndex = 0;

function drawConnection(from: PanelId, to: PanelId, label: string, color: string): void {
  const svg = $('svg-overlay') as unknown as SVGSVGElement;
  const offset = (connectionIndex % 3 - 1) * 14;
  connectionIndex++;

  const { p1, p2 } = getConnectionPoints(from, to, offset);

  // Draw line
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(p1.x));
  line.setAttribute('y1', String(p1.y));
  line.setAttribute('x2', String(p2.x));
  line.setAttribute('y2', String(p2.y));
  line.setAttribute('stroke', COLOR_MAP[color] || COLOR_MAP.blue);
  line.setAttribute('marker-end', `url(#arrow-${color})`);
  line.classList.add('connection-line');
  svg.appendChild(line);

  // Draw label at midpoint
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2 - 8;
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', String(mx));
  text.setAttribute('y', String(my));
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

// ─── Small Output Helpers ────────────────────────────────────────────────────

function outputBlock(label: string, value: string): string {
  return `<div class="output-block"><div class="output-label">${label}</div><div class="output-value">${value}</div></div>`;
}

function fsmState(text: string, cls: string): string {
  return `<span class="fsm-state ${cls}">${text}</span>`;
}

function fsmArrow(): string {
  return `<span class="fsm-arrow">\u2192</span>`;
}

// ─── Step Implementations ────────────────────────────────────────────────────

async function step1_identity() {
  highlightPanel('user');
  highlightPanel('supermarket');
  highlightPanel('robot');
  fadeConnections();

  // === SDK Calls ===
  state.userAgent = await deriveAgentIdentity({
    mnemonic: MNEMONIC_USER, passphrase: PASSPHRASE, agentIndex: 0,
  });
  state.supermarketAgent = await deriveAgentIdentity({
    mnemonic: MNEMONIC_SUPERMARKET, passphrase: PASSPHRASE, agentIndex: 1,
  });
  state.robotAgent = await deriveAgentIdentity({
    mnemonic: MNEMONIC_SUPERMARKET, passphrase: PASSPHRASE, agentIndex: 2,
  });

  const policy = { maxPerTx: 20, maxPerDay: 100 };
  state.userCert = await createAgentCertificate({
    mnemonic: MNEMONIC_USER, passphrase: PASSPHRASE, agentIndex: 0,
    ownerXidentity: btoa('user_owner_xidentity'),
    capabilities: ['payment', 'negotiation', 'commitment'],
    chains: ['solana'], maxAutonomousAmount: 20, policy, validDays: 365,
  });
  state.supermarketCert = await createAgentCertificate({
    mnemonic: MNEMONIC_SUPERMARKET, passphrase: PASSPHRASE, agentIndex: 1,
    ownerXidentity: btoa('supermarket_owner_xidentity'),
    capabilities: ['payment', 'negotiation', 'commitment', 'delegation'],
    chains: ['solana', 'ethereum'], maxAutonomousAmount: 500, policy: { maxPerTx: 500 }, validDays: 365,
  });
  state.robotCert = await createAgentCertificate({
    mnemonic: MNEMONIC_SUPERMARKET, passphrase: PASSPHRASE, agentIndex: 2,
    ownerXidentity: btoa('supermarket_owner_xidentity'),
    capabilities: ['payment', 'delegation'],
    chains: ['solana'], maxAutonomousAmount: 50, policy: { maxPerTx: 50 }, validDays: 365,
  });

  addTimeline('user', 'Agent shopper-agent derived');
  addTimeline('supermarket', 'Agent supermarket-agent derived');
  addTimeline('robot', 'Agent delivery-robot derived');

  // === Render ===
  pushEntry('user', {
    step: 1, title: 'Shopper Identity Created',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'Generating a unique DID and certificate so I can shop and pay autonomously on behalf of my human owner.',
    status: 'pass',
    html: `DID: ${truncate(state.userAgent.did, 30)}<br>Caps: payment, negotiation, commitment`,
  });
  await delay(1000);
  pushEntry('supermarket', {
    step: 1, title: 'Store Agent Identity Created',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'Creating my identity to list products, negotiate prices, and manage delivery robots.',
    status: 'pass',
    html: `DID: ${truncate(state.supermarketAgent.did, 30)}<br>Caps: payment, negotiation, delegation`,
  });
  await delay(1000);
  pushEntry('robot', {
    step: 1, title: 'Delivery Bot Identity Created',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'Initializing my identity. I handle last-mile delivery and payment collection.',
    status: 'pass',
    html: `DID: ${truncate(state.robotAgent.did, 30)}<br>Caps: payment, delegation`,
  });

  unhighlightAll();
}

async function step2_hierarchy() {
  highlightPanel('user');
  highlightPanel('supermarket');
  clearConnections();

  // === SDK Calls ===
  const userHierarchy = new AgentHierarchyManager(userStorage);
  userHierarchy.addAgent(state.userAgent!.agentId, 'Shopper Agent');

  const smHierarchy = new AgentHierarchyManager(supermarketStorage);
  smHierarchy.addAgent(state.supermarketAgent!.agentId, 'Supermarket Agent');
  smHierarchy.addAgent(state.robotAgent!.agentId, 'Delivery Robot', state.supermarketAgent!.agentId);

  const userTree = userHierarchy.getHierarchy();
  const smTree = smHierarchy.getHierarchy();

  addTimeline('user', 'Hierarchy: Human \u2192 Shopper');
  addTimeline('supermarket', 'Hierarchy: Supermarket \u2192 Robot');

  // === Render ===
  pushEntry('user', {
    step: 2, title: 'Ownership Registered',
    api: 'AgentHierarchyManager.addAgent()',
    description: 'My human owner registered me as their shopping agent. I escalate big decisions to them.',
    status: 'pass',
    html: `Human Owner \u2192 Shopper Agent`,
  });
  pushEntry('supermarket', {
    step: 2, title: 'Delegation Chain Set',
    api: 'AgentHierarchyManager.addAgent()',
    description: 'I registered the delivery robot as my sub-agent. It handles physical delivery under my authority.',
    status: 'pass',
    html: `Store \u2192 Delivery Robot (${smTree.totalAgents} agents)`,
  });

  drawConnection('supermarket', 'robot', 'Owns', 'green');

  unhighlightAll();
}

async function step3_policy() {
  highlightPanel('user');
  clearConnections();

  // === SDK Calls ===
  state.policyEngine = new PolicyEngine(userStorage);
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 86400000);

  state.policyEngine.addPolicy({
    id: 'grocery-policy',
    agentId: state.userAgent!.agentId,
    agentLabel: 'Shopper Agent',
    scope: 'auto_payment',
    conditions: {
      maxAmountPerTx: 20, maxAmountPerDay: 100, maxAmountPerWeek: 500,
      maxAmountPerMonth: 2000, allowListAddresses: [], allowListChains: ['solana'],
      allowListMethods: [], minBalanceAfter: 0, requireReviewBeforeFirstPay: false,
    },
    escalation: 'ask_human',
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    signature: '',
  });

  addTimeline('user', 'Policy: $20/tx, $100/day, Solana only');

  // === Render ===
  pushEntry('user', {
    step: 3, title: 'Spending Policy Set',
    api: 'PolicyEngine.addPolicy()',
    description: 'My owner set spending guardrails: I can auto-approve up to $20/tx on Solana. Anything larger requires human review.',
    status: 'pass',
    html: `Max/Tx: $20 | Max/Day: $100 | Escalation: ask_human`,
  });

  unhighlightAll();
}

async function step4_a2a() {
  highlightPanel('supermarket');
  highlightPanel('user');
  clearConnections();

  // === SDK Calls ===
  const builder = new AgentCardBuilder();
  builder.setProvider({ organization: 'FreshMart Supermarket', url: 'https://freshmart.example.com' });
  const card = builder.buildFromCertificate(
    state.supermarketCert!, 'https://freshmart.example.com',
    'FreshMart Shopping Agent', 5000, 'USDC',
  );

  addTimeline('supermarket', 'A2A agent card published');
  addTimeline('user', 'Discovered FreshMart agent via A2A');

  // === Render ===
  pushEntry('supermarket', {
    step: 4, title: 'Agent Card Published',
    api: 'AgentCardBuilder.buildFromCertificate()',
    description: 'Publishing my capabilities so other agents can discover me and initiate transactions.',
    status: 'pass',
    html: `Skills: ${card.skills.map((s) => s.name).join(', ')}`,
  });
  await delay(1000);

  drawConnection('supermarket', 'user', 'A2A Agent Card', 'green');
  await delay(1000);

  pushEntry('user', {
    step: 4, title: 'Discovered FreshMart',
    api: 'A2A Discovery Protocol',
    description: 'Found FreshMart\'s agent card via A2A protocol. Verified its certificate and capabilities before engaging.',
    status: 'pass',
  });

  unhighlightAll();
}

async function step5_negotiation1() {
  highlightPanel('user');
  highlightPanel('supermarket');
  clearConnections();

  // === SDK Calls (all at once) ===
  const fsm = new NegotiationStateMachine();
  const session = fsm.createSession({
    myAgentId: state.userAgent!.agentId,
    counterpartyAgentId: state.supermarketAgent!.agentId,
  });
  const deadline = new Date(Date.now() + 3600000).toISOString();

  const offer: NegotiationOffer = {
    item: 'Organic Vegetables Bundle', price: '18', currency: 'USDC',
    terms: ['Fresh organic only', 'Delivery within 2 hours'], deadline,
  };
  fsm.sendOffer(session.sessionId, state.userAgent!.agentId, offer);

  const counter: NegotiationCounterOffer = {
    item: 'Organic Vegetables Bundle', counterPrice: '16', currency: 'USDC',
    counterTerms: ['Fresh organic', 'Delivery within 3 hours', '10% loyalty discount'], deadline,
  };
  fsm.sendCounter(session.sessionId, state.supermarketAgent!.agentId, counter);

  const acceptance: NegotiationAcceptance = {
    agreementHash: 'mock_agreement_hash_vegetables',
    acceptedPrice: '16',
    acceptedTerms: ['Fresh organic', 'Delivery within 3 hours', '10% loyalty discount'],
  };
  fsm.accept(session.sessionId, state.userAgent!.agentId, acceptance);

  addTimeline('user', 'Offer: $18 for vegetables');
  addTimeline('supermarket', 'Counter: $16 (10% loyalty discount)');
  addTimeline('user', 'Accepted: $16');

  // === Animated Render ===
  pushEntry('user', {
    step: 5, title: 'Offering $18 for Vegetables',
    api: 'NegotiationStateMachine.sendOffer()',
    description: 'Sending an initial offer for the Organic Vegetables Bundle. My budget allows up to $20.',
    status: 'pass',
  });
  drawConnection('user', 'supermarket', 'Offer $18 USDC', 'blue');
  await delay(2500);

  pushEntry('supermarket', {
    step: 5, title: 'Counter-offering $16',
    api: 'NegotiationStateMachine.sendCounter()',
    description: 'Applying a 10% loyalty discount and offering $16 with a 3-hour delivery window.',
    status: 'pass',
  });
  drawConnection('supermarket', 'user', 'Counter $16 USDC', 'green');
  await delay(2500);

  const finalSession = fsm.getSession(session.sessionId)!;
  pushEntry('user', {
    step: 5, title: 'Deal Accepted at $16',
    api: 'NegotiationStateMachine.accept()',
    description: 'Great price! Accepting the $16 counter-offer. This is within my $20/tx policy limit.',
    status: 'pass',
    html: `<div class="fsm-flow">${fsmState('offer', 'done')}${fsmArrow()}${fsmState('counter', 'done')}${fsmArrow()}${fsmState('accepted', 'active')}</div>`,
  });
  drawConnection('user', 'supermarket', 'Accept \u2713', 'blue');

  unhighlightAll();
}

async function step6_commitment1() {
  highlightPanel('user');
  highlightPanel('supermarket');
  clearConnections();

  // === SDK Calls ===
  state.commitmentBuilder = new CommitmentBuilder(userStorage);
  const record = state.commitmentBuilder.createCommitment({
    buyerAgent: state.userAgent!.agentId,
    sellerAgent: state.supermarketAgent!.agentId,
    item: 'Organic Vegetables Bundle', price: '16', currency: 'USDC',
    deliveryDeadline: Math.floor(Date.now() / 1000) + 10800,
    arbitrator: 'yault-authority', escrowRequired: true, chainId: 1,
  });

  await state.commitmentBuilder.signAsBuyer(record.id, MNEMONIC_USER, PASSPHRASE);
  await state.commitmentBuilder.signAsSeller(record.id, MNEMONIC_SUPERMARKET, PASSPHRASE);
  state.commitment1 = state.commitmentBuilder.getCommitment(record.id)!;

  addTimeline('user', 'Signed commitment as buyer');
  addTimeline('supermarket', 'Signed commitment as seller');

  // === Render ===
  pushEntry('user', {
    step: 6, title: 'Signed Purchase Commitment',
    api: 'CommitmentBuilder.signAsBuyer()',
    description: 'Signing an EIP-712 typed commitment as buyer. This is a cryptographically binding purchase agreement with escrow.',
    status: 'pass',
    html: `$16 USDC | Escrow: on`,
  });

  drawConnection('user', 'supermarket', 'EIP-712 Dual-Sign', 'blue');
  await delay(1000);

  pushEntry('supermarket', {
    step: 6, title: 'Co-signed Commitment',
    api: 'CommitmentBuilder.signAsSeller()',
    description: 'Co-signing the purchase commitment as seller. Both signatures make this binding and enforceable.',
    status: 'pass',
    html: `Status: ${state.commitment1.status} | Dual-signed`,
  });

  unhighlightAll();
}

async function step7_policyCheck() {
  highlightPanel('user');
  clearConnections();

  // === SDK Calls ===
  const approved = await state.policyEngine!.checkAutoApprove({
    requestId: 'req-veg-16',
    vendorId: state.userAgent!.agentId,
    action: {
      type: 'transfer',
      payload: {
        chainId: 'solana', token: 'native',
        toAddress: 'SoFreshMart111111111111111111111111111111111', amount: '16',
      },
    },
  });

  const rejected = await state.policyEngine!.checkAutoApprove({
    requestId: 'req-steak-35',
    vendorId: state.userAgent!.agentId,
    action: {
      type: 'transfer',
      payload: {
        chainId: 'solana', token: 'native',
        toAddress: 'SoFreshMart111111111111111111111111111111111', amount: '35',
      },
    },
  });

  addTimeline('user', `$16 vegetables: ${approved ? 'AUTO-APPROVED' : 'REJECTED'}`);
  addTimeline('user', `$35 steak: ${rejected ? 'AUTO-APPROVED' : 'NEEDS REVIEW'}`);

  // === Render ===
  pushEntry('user', {
    step: 7, title: '$16 Vegetables \u2192 AUTO-APPROVED',
    api: 'PolicyEngine.checkAutoApprove()',
    description: 'Checking if $16 is within my spending policy... Yes! Under $20/tx limit. I can pay without asking my owner.',
    status: 'pass',
    html: `<span class="tag-pass">AUTO-APPROVED</span>`,
  });
  await delay(2500);

  pushEntry('user', {
    step: 7, title: '$35 Steak \u2192 NEEDS REVIEW',
    api: 'PolicyEngine.checkAutoApprove()',
    description: '$35 exceeds my $20/tx limit. I cannot approve this autonomously \u2014 escalating to my human owner for review.',
    status: 'fail',
    html: `<span class="tag-fail">NEEDS HUMAN REVIEW</span> Routing to mobile...`,
  });

  unhighlightAll();
}

async function step8_delegation() {
  highlightPanel('supermarket');
  highlightPanel('robot');
  clearConnections();

  // === SDK Calls ===
  const smHierarchy = new AgentHierarchyManager(supermarketStorage);
  smHierarchy.addAgent(state.supermarketAgent!.agentId, 'Supermarket Agent');
  smHierarchy.addAgent(state.robotAgent!.agentId, 'Delivery Robot', state.supermarketAgent!.agentId);

  const chain = smHierarchy.getEscalationChain(state.robotAgent!.agentId);
  const descendants = smHierarchy.getDescendants(state.supermarketAgent!.agentId);

  addTimeline('supermarket', 'Delegated delivery to robot agent');
  addTimeline('robot', 'Accepted delivery delegation');

  // === Render ===
  pushEntry('supermarket', {
    step: 8, title: 'Delegating Delivery',
    api: 'AgentHierarchyManager.getEscalationChain()',
    description: 'Assigning the delivery task to my robot sub-agent. It has scoped authority for delivery payments only.',
    status: 'pass',
  });

  drawConnection('supermarket', 'robot', 'Delegation', 'green');
  await delay(1000);

  pushEntry('robot', {
    step: 8, title: 'Delivery Task Accepted',
    api: 'AgentHierarchyManager',
    description: 'I received a delivery delegation from FreshMart. Ready to negotiate delivery fee and fulfill the order.',
    status: 'pass',
  });

  unhighlightAll();
}

async function step9_negotiation2() {
  highlightPanel('supermarket');
  highlightPanel('robot');
  clearConnections();

  // === SDK Calls ===
  const fsm = new NegotiationStateMachine();
  const session = fsm.createSession({
    myAgentId: state.supermarketAgent!.agentId,
    counterpartyAgentId: state.robotAgent!.agentId,
  });
  const deadline = new Date(Date.now() + 3600000).toISOString();

  const offer: NegotiationOffer = {
    item: 'Delivery Service', price: '5', currency: 'USDC',
    terms: ['Within 2 hours', 'GPS tracking', 'Proof of delivery'], deadline,
  };
  fsm.sendOffer(session.sessionId, state.supermarketAgent!.agentId, offer);

  const counter: NegotiationCounterOffer = {
    item: 'Delivery Service', counterPrice: '4', currency: 'USDC',
    counterTerms: ['Within 3 hours', 'GPS tracking', 'Proof of delivery'], deadline,
    reason: 'Optimized route allows lower fee',
  };
  fsm.sendCounter(session.sessionId, state.robotAgent!.agentId, counter);

  const acceptance: NegotiationAcceptance = {
    agreementHash: 'mock_agreement_hash_delivery',
    acceptedPrice: '4',
    acceptedTerms: ['Within 3 hours', 'GPS tracking', 'Proof of delivery'],
  };
  fsm.accept(session.sessionId, state.supermarketAgent!.agentId, acceptance);

  addTimeline('supermarket', 'Offer: $5 delivery fee');
  addTimeline('robot', 'Counter: $4 (optimized route)');
  addTimeline('supermarket', 'Accepted: $4 delivery fee');

  // === Animated Render ===
  pushEntry('supermarket', {
    step: 9, title: 'Offering $5 Delivery Fee',
    api: 'NegotiationStateMachine.sendOffer()',
    description: 'Negotiating with the delivery robot. Offering $5 for last-mile delivery with GPS tracking.',
    status: 'pass',
  });
  drawConnection('supermarket', 'robot', 'Offer $5 USDC', 'green');
  await delay(2500);

  pushEntry('robot', {
    step: 9, title: 'Counter-offering $4',
    api: 'NegotiationStateMachine.sendCounter()',
    description: 'I calculated an optimized route that saves fuel. Offering to deliver for $4 instead of $5.',
    status: 'pass',
  });
  drawConnection('robot', 'supermarket', 'Counter $4 USDC', 'purple');
  await delay(2500);

  const finalSession = fsm.getSession(session.sessionId)!;
  pushEntry('supermarket', {
    step: 9, title: 'Delivery Fee Agreed: $4',
    api: 'NegotiationStateMachine.accept()',
    description: 'Accepting the $4 counter-offer. Both parties agree on delivery terms.',
    status: 'pass',
    html: `<div class="fsm-flow">${fsmState('offer', 'done')}${fsmArrow()}${fsmState('counter', 'done')}${fsmArrow()}${fsmState('accepted', 'active')}</div>`,
  });
  drawConnection('supermarket', 'robot', 'Accept \u2713', 'green');

  unhighlightAll();
}

async function step10_commitment2() {
  highlightPanel('supermarket');
  highlightPanel('robot');
  clearConnections();

  // === SDK Calls ===
  state.commitmentBuilderSM = new CommitmentBuilder(supermarketStorage);
  const record = state.commitmentBuilderSM.createCommitment({
    buyerAgent: state.supermarketAgent!.agentId,
    sellerAgent: state.robotAgent!.agentId,
    item: 'Delivery Service', price: '4', currency: 'USDC',
    deliveryDeadline: Math.floor(Date.now() / 1000) + 10800,
    arbitrator: 'yault-authority', escrowRequired: false, chainId: 1,
  });

  await state.commitmentBuilderSM.signAsBuyer(record.id, MNEMONIC_SUPERMARKET, PASSPHRASE);
  await state.commitmentBuilderSM.signAsSeller(record.id, MNEMONIC_SUPERMARKET, PASSPHRASE);
  state.commitment2 = state.commitmentBuilderSM.getCommitment(record.id)!;

  addTimeline('supermarket', 'Signed delivery commitment as buyer');
  addTimeline('robot', 'Signed delivery commitment as seller');

  // === Render ===
  pushEntry('supermarket', {
    step: 10, title: 'Signed Delivery Commitment',
    api: 'CommitmentBuilder.signAsBuyer()',
    description: 'Creating an EIP-712 commitment for the $4 delivery fee. Signing as buyer (service requester).',
    status: 'pass',
    html: `$4 USDC | No escrow needed`,
  });

  drawConnection('supermarket', 'robot', 'EIP-712 Dual-Sign', 'green');
  await delay(1000);

  pushEntry('robot', {
    step: 10, title: 'Co-signed Delivery Commitment',
    api: 'CommitmentBuilder.signAsSeller()',
    description: 'Co-signing as delivery provider. This binds me to complete the delivery within agreed terms.',
    status: 'pass',
    html: `Status: ${state.commitment2.status} | Dual-signed`,
  });

  unhighlightAll();
}

async function step11_privacy() {
  highlightPanel('user');
  highlightPanel('robot');
  clearConnections();

  // === SDK Calls ===
  state.addressPool = new AddressPoolManager(userStorage);
  state.contextTagManager = new ContextTagManager(userStorage);

  const ephemeral = state.addressPool.deriveEphemeralAddress({
    mnemonic: MNEMONIC_USER, passphrase: PASSPHRASE,
    agentId: state.userAgent!.agentId, chain: 'solana', direction: 'outbound',
  });

  const tag = state.contextTagManager.createTag({
    agentId: state.userAgent!.agentId,
    contextInfo: ephemeral.contextInfo,
    derivedAddress: ephemeral.address,
    chain: 'solana', direction: 'outbound',
    amount: '4', token: 'USDC',
    counterpartyAddress: state.robotAgent!.agentId,
    commitmentId: state.commitment2?.id,
    privacyLevel: 'isolated',
  });

  addTimeline('user', 'Ephemeral address derived for delivery');
  addTimeline('user', 'Context tag created for audit');

  // === Render ===
  pushEntry('user', {
    step: 11, title: 'Privacy: Ephemeral Address',
    api: 'AddressPoolManager.deriveEphemeralAddress()',
    description: 'Deriving a one-time payment address so the delivery robot cannot link this payment to my other transactions.',
    status: 'pass',
    html: `Chain: ${ephemeral.chain} | <span class="tag-info">isolated</span>`,
  });
  await delay(1000);

  pushEntry('user', {
    step: 11, title: 'Audit Context Tag Created',
    api: 'ContextTagManager.createTag()',
    description: 'Creating an encrypted context tag for auditability. Stored on Arweave, minted as a compressed NFT receipt.',
    status: 'pass',
    html: `$${tag.amount} ${tag.token} | Encrypted \u2192 Arweave \u2192 cNFT`,
  });

  drawConnection('user', 'robot', 'Privacy: Isolated', 'purple');

  unhighlightAll();
}

async function step12_review(): Promise<void> {
  highlightPanelAmber('user');
  clearConnections();

  // === SDK Calls ===
  state.reviewManager = new ReviewManager(userStorage);
  const request = state.reviewManager.createReviewRequestAsync({
    agentId: state.userAgent!.agentId,
    agentLabel: 'Shopper Agent',
    action: 'transfer',
    summary: 'Purchase $35 Premium Wagyu Steak from FreshMart',
    details: {
      chain: 'solana', to: 'SoFreshMart111111111111111111111111111111111',
      amount: '35', currency: 'USDC', context: 'Exceeds $20/tx auto-approval limit',
    },
    policyViolation: { rule: 'maxAmountPerTx', actual: '35', limit: '20' },
    urgency: 'normal',
    deadlineMs: 300000,
  });

  state.reviewRequestId = request.requestId;
  addTimeline('user', 'Review request: $35 steak needs approval');

  // === Render ===
  const entry = pushEntry('user', {
    step: 12, title: '\u{1F4F1} Human Review Required',
    api: 'ReviewManager.createReviewRequestAsync()',
    description: 'The $35 steak exceeds my autonomous limit. Sending a push notification to my owner\'s phone for biometric approval.',
    status: 'interactive',
    html: `
      $35 exceeds $20/tx limit<br>
      <div class="review-actions">
        <button class="btn btn-approve" id="btn-approve">Approve ($35 Steak)</button>
        <button class="btn btn-reject" id="btn-reject">Reject</button>
      </div>
    `,
  });

  // Wait for user interaction
  return new Promise<void>((resolve) => {
    const approveBtn = document.getElementById('btn-approve')!;
    const rejectBtn = document.getElementById('btn-reject')!;

    approveBtn.addEventListener('click', () => {
      const response: ReviewResponse = {
        requestId: state.reviewRequestId!,
        decision: 'approve',
        respondedAt: new Date().toISOString(),
        respondedVia: 'extension',
        biometricVerified: true,
      };
      state.reviewManager!.submitResponse(response);
      addTimeline('user', 'APPROVED: $35 steak purchase');

      updateEntry(entry, {
        status: 'pass',
        html: `<span class="tag-pass">APPROVED</span> Biometric verified \u2713<br>Via: extension`,
      });
      unhighlightAll();
      resolve();
    });

    rejectBtn.addEventListener('click', () => {
      const response: ReviewResponse = {
        requestId: state.reviewRequestId!,
        decision: 'reject',
        respondedAt: new Date().toISOString(),
        respondedVia: 'extension',
        biometricVerified: false,
      };
      state.reviewManager!.submitResponse(response);
      addTimeline('user', 'REJECTED: $35 steak purchase');

      updateEntry(entry, {
        status: 'fail',
        html: `<span class="tag-fail">REJECTED</span> Decision: reject<br>Via: extension`,
      });
      unhighlightAll();
      resolve();
    });
  });
}

async function step13_delivery() {
  highlightPanel('robot');
  highlightPanel('supermarket');
  highlightPanel('user');
  clearConnections();

  // === SDK Calls ===
  if (state.commitment1) {
    state.commitmentBuilder!.updateStatus(state.commitment1.id, 'escrowed', {
      escrowTxHash: '0xmock_escrow_tx_hash_vegetables',
    });
    state.commitmentBuilder!.updateStatus(state.commitment1.id, 'delivered', {
      deliveryConfirmationHash: '0xmock_delivery_hash',
    });
    state.commitmentBuilder!.updateStatus(state.commitment1.id, 'completed', {
      releaseTxHash: '0xmock_release_tx_hash',
    });
  }

  const receiptTag = state.contextTagManager!.createTag({
    agentId: state.robotAgent!.agentId,
    contextInfo: 'delivery-receipt-' + Date.now(),
    derivedAddress: 'SoDeliveryReceipt111111111111111111111111',
    chain: 'solana', direction: 'inbound',
    amount: '4', token: 'USDC',
    counterpartyAddress: state.supermarketAgent!.agentId,
    txHash: '0xmock_delivery_receipt_tx',
    commitmentId: state.commitment2?.id,
    privacyLevel: 'isolated',
  });

  const c1 = state.commitmentBuilder?.getCommitment(state.commitment1!.id);

  addTimeline('robot', 'Delivery completed');
  addTimeline('robot', 'Encrypted NFT receipt created');
  addTimeline('supermarket', 'Escrow released');
  addTimeline('user', 'Goods received');

  // === Render ===
  pushEntry('robot', {
    step: 13, title: 'Delivery Completed!',
    api: 'CommitmentBuilder.updateStatus()',
    description: 'I have arrived at the destination and delivered the groceries. Updating commitment status to "delivered".',
    status: 'pass',
  });

  drawConnection('robot', 'user', 'Delivery \u2713', 'purple');
  await delay(1500);

  pushEntry('robot', {
    step: 13, title: 'NFT Receipt Minted',
    api: 'ContextTagManager.createTag()',
    description: 'Minting an encrypted compressed NFT as proof of delivery. Stored on Arweave for permanent auditability.',
    status: 'pass',
    html: `<span class="tag-info">isolated</span> Encrypted \u2192 Arweave \u2192 cNFT`,
  });

  drawConnection('robot', 'supermarket', 'Receipt', 'purple');
  await delay(1000);

  pushEntry('supermarket', {
    step: 13, title: 'Escrow Released',
    api: 'CommitmentBuilder.updateStatus()',
    description: 'Delivery confirmed. Releasing escrowed payment to complete the purchase commitment.',
    status: 'pass',
  });

  pushEntry('user', {
    step: 13, title: 'Groceries Received!',
    api: 'CommitmentBuilder.updateStatus()',
    description: 'Order complete! Vegetables delivered, commitments fulfilled, and all payments settled autonomously.',
    status: 'pass',
  });

  unhighlightAll();
}

async function step14_summary() {
  highlightPanel('user');
  highlightPanel('supermarket');
  highlightPanel('robot');
  clearConnections();

  // Build timeline
  const userEvents = state.timeline.filter((t) => t.agent === 'user' || t.agent === 'system');
  const smEvents = state.timeline.filter((t) => t.agent === 'supermarket');
  const robotEvents = state.timeline.filter((t) => t.agent === 'robot');

  const renderEntries = (events: typeof state.timeline) =>
    events.map((e) => `<div class="summary-entry"><span class="time">${e.time}</span>${e.action}</div>`).join('');

  // Add summary as a full-width section below panels
  const panels = document.querySelector('.panels')!;
  const existing = document.querySelector('.summary-section');
  if (existing) existing.remove();

  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'summary-section slide-up';
  summaryDiv.innerHTML = `
    <h3>\u{1F4CA} Full Three-Party Audit Trail</h3>
    <div class="summary-grid">
      <div class="summary-col user">
        <h4>\u{1F464} User / Shopper</h4>
        ${renderEntries(userEvents)}
      </div>
      <div class="summary-col supermarket">
        <h4>\u{1F3EA} Supermarket</h4>
        ${renderEntries(smEvents)}
      </div>
      <div class="summary-col robot">
        <h4>\u{1F916} Delivery Robot</h4>
        ${renderEntries(robotEvents)}
      </div>
    </div>
    ${outputBlock('Audit Summary', `
Total events: ${state.timeline.length}
Commitments: 2 (vegetables $16 + delivery $4)
Policy checks: 2 (1 approved, 1 escalated)
Privacy addresses: 1 ephemeral (isolated)
Context tags: 2 (audit + receipt)
Modules exercised: Identity, Hierarchy, Policy, A2A, Negotiation, Commitment, Review, Privacy`)}
  `;
  panels.after(summaryDiv);

  // Also push summary entries to each panel
  pushEntry('user', {
    step: 14, title: 'Audit Complete',
    status: 'pass',
    description: `${userEvents.length} events logged`,
  });
  pushEntry('supermarket', {
    step: 14, title: 'Audit Complete',
    status: 'pass',
    description: `${smEvents.length} events logged`,
  });
  pushEntry('robot', {
    step: 14, title: 'Audit Complete',
    status: 'pass',
    description: `${robotEvents.length} events logged`,
  });

  // Draw final triangle of connections
  drawConnection('user', 'supermarket', '$16 Vegetables', 'blue');
  drawConnection('supermarket', 'robot', '$4 Delivery', 'green');
  drawConnection('robot', 'user', 'Receipt', 'purple');

  // Keep all panels glowing for final state
}

// ─── Orchestration ───────────────────────────────────────────────────────────

const steps: Array<() => Promise<void>> = [
  step1_identity,
  step2_hierarchy,
  step3_policy,
  step4_a2a,
  step5_negotiation1,
  step6_commitment1,
  step7_policyCheck,
  step8_delegation,
  step9_negotiation2,
  step10_commitment2,
  step11_privacy,
  step12_review,
  step13_delivery,
  step14_summary,
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
      // Show error in first relevant panel
      pushEntry('user', {
        step: i + 1,
        title: `Error: Step ${i + 1}`,
        status: 'fail',
        html: `${(err as Error).message}`,
      });
      break;
    }
  }

  running = false;
  btn.disabled = false;
  btn.textContent = '\u25B6 Run Demo';
}

function resetAll() {
  if (running) return;

  // Clear panel bodies
  (['user', 'supermarket', 'robot'] as PanelId[]).forEach((p) => {
    $(`panel-${p}-body`).innerHTML = '';
    unhighlightPanel(p);
  });

  // Clear SVG connections
  clearConnections();

  // Remove summary section
  document.querySelector('.summary-section')?.remove();

  // Reset state
  Object.keys(state).forEach((key) => {
    const k = key as keyof DemoState;
    if (k === 'timeline') {
      state.timeline = [];
    } else {
      (state as Record<string, unknown>)[k] = null;
    }
  });

  userStorage.clear();
  supermarketStorage.clear();
  setupBrowserMockWasm();
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  $('btn-run-all').addEventListener('click', runAllSteps);
  $('btn-reset').addEventListener('click', resetAll);
});
