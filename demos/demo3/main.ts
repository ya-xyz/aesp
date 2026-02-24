/**
 * AESP Demo 3 — Privacy-Preserving NFT Hunter
 *
 * 12 steps showcasing the Privacy module in depth:
 * AddressPoolManager (replenish, claim, resolve 3 levels),
 * ContextTagManager (multi-tag, batch archive),
 * ConsolidationScheduler (batched with shuffle + jitter),
 * and requireReviewBeforeFirstPay.
 *
 * Panels: NFT Hunter | NFT Marketplace | Sniper Bot
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
  ConsolidationScheduler,
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

const collectorStorage = new MockStorage();
const marketplaceStorage = new MockStorage();

// ─── Constants ───────────────────────────────────────────────────────────────

const MNEMONIC_COLLECTOR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_MARKETPLACE = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const PASSPHRASE = '';

// ─── Shared State ────────────────────────────────────────────────────────────

interface DemoState {
  hunterAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  sniperAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  marketplaceAgent: Awaited<ReturnType<typeof deriveAgentIdentity>> | null;
  hunterCert: AgentIdentityCertificate | null;
  sniperCert: AgentIdentityCertificate | null;
  marketplaceCert: AgentIdentityCertificate | null;
  policyEngine: PolicyEngine | null;
  reviewManager: ReviewManager | null;
  commitmentBuilder: CommitmentBuilder | null;
  addressPool: AddressPoolManager | null;
  contextTagManager: ContextTagManager | null;
  commitment: CommitmentRecord | null;
  reviewRequestId: string | null;
  timeline: Array<{ agent: string; action: string; time: string }>;
}

const state: DemoState = {
  hunterAgent: null, sniperAgent: null, marketplaceAgent: null,
  hunterCert: null, sniperCert: null, marketplaceCert: null,
  policyEngine: null, reviewManager: null, commitmentBuilder: null,
  addressPool: null, contextTagManager: null,
  commitment: null, reviewRequestId: null,
  timeline: [],
};

// ─── Panel Types & Helpers ───────────────────────────────────────────────────

type PanelId = 'hunter' | 'marketplace' | 'sniper';

const SVG_NS = 'http://www.w3.org/2000/svg';

const PANEL_COLORS: Record<PanelId, string> = {
  hunter: 'blue',
  marketplace: 'green',
  sniper: 'purple',
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
  status?: 'running' | 'pass' | 'fail' | 'interactive' | 'privacy';
}

function pushEntry(panel: PanelId, opts: EntryOpts): HTMLElement {
  const body = $(`panel-${panel}-body`);
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
    entry.className = entry.className.replace(/entry-(running|pass|fail|interactive|privacy)/g, '');
    entry.classList.add(`entry-${opts.status}`);
    const existing = entry.querySelector('.entry-check, .entry-cross');
    if (existing) existing.remove();
    const header = entry.querySelector('.entry-header');
    if (opts.status === 'pass' && header) header.insertAdjacentHTML('beforeend', '<span class="entry-check">\u2713</span>');
    else if (opts.status === 'fail' && header) header.insertAdjacentHTML('beforeend', '<span class="entry-cross">\u2717</span>');
  }
  if (opts.html !== undefined) {
    let output = entry.querySelector('.entry-output') as HTMLElement;
    if (!output) { output = document.createElement('div'); output.className = 'entry-output'; entry.appendChild(output); }
    output.innerHTML = opts.html;
  }
}

// ─── Panel Highlight ─────────────────────────────────────────────────────────

function highlightPanel(panel: PanelId) { $(`panel-${panel}`).classList.add(`glow-${PANEL_COLORS[panel]}`); }
function unhighlightPanel(panel: PanelId) { const el = $(`panel-${panel}`); el.classList.remove('glow-blue', 'glow-green', 'glow-purple', 'glow-amber', 'glow-pink'); }
function highlightPanelColor(panel: PanelId, color: string) { $(`panel-${panel}`).classList.add(`glow-${color}`); }
function unhighlightAll() { (['hunter', 'marketplace', 'sniper'] as PanelId[]).forEach(unhighlightPanel); }

// ─── SVG Connection Lines ────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  blue: '#58a6ff', green: '#3fb950', purple: '#bc8cff',
  amber: '#d29922', red: '#f85149', pink: '#f778ba',
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
  if (from === 'hunter' && to === 'marketplace')
    return { p1: getEdge('hunter', 'right', offset), p2: getEdge('marketplace', 'left', offset) };
  if (from === 'marketplace' && to === 'hunter')
    return { p1: getEdge('marketplace', 'left', offset), p2: getEdge('hunter', 'right', offset) };
  if (from === 'hunter' && to === 'sniper')
    return { p1: getEdge('hunter', 'bottom', offset), p2: getEdge('sniper', 'top', offset > 0 ? offset : -15) };
  if (from === 'sniper' && to === 'hunter')
    return { p1: getEdge('sniper', 'top', offset > 0 ? offset : -15), p2: getEdge('hunter', 'bottom', offset) };
  if (from === 'marketplace' && to === 'sniper')
    return { p1: getEdge('marketplace', 'bottom', offset), p2: getEdge('sniper', 'top', offset > 0 ? offset : 15) };
  if (from === 'sniper' && to === 'marketplace')
    return { p1: getEdge('sniper', 'top', offset > 0 ? offset : 15), p2: getEdge('marketplace', 'bottom', offset) };
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
function fsmArrow(): string { return `<span class="fsm-arrow">\u2192</span>`; }
function outputBlock(label: string, value: string): string {
  return `<div class="output-block"><div class="output-label">${label}</div><div class="output-value">${value}</div></div>`;
}

// ─── Step Implementations ────────────────────────────────────────────────────

async function step1_identity() {
  highlightPanel('hunter'); highlightPanel('marketplace'); highlightPanel('sniper');
  fadeConnections();

  state.hunterAgent = await deriveAgentIdentity({ mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE, agentIndex: 0 });
  state.sniperAgent = await deriveAgentIdentity({ mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE, agentIndex: 1 });
  state.marketplaceAgent = await deriveAgentIdentity({ mnemonic: MNEMONIC_MARKETPLACE, passphrase: PASSPHRASE, agentIndex: 0 });

  state.hunterCert = await createAgentCertificate({
    mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE, agentIndex: 0,
    ownerXidentity: btoa('collector_owner_xidentity'),
    capabilities: ['payment', 'negotiation', 'commitment', 'delegation'],
    chains: ['solana'], maxAutonomousAmount: 2, policy: { maxPerTx: 2, maxPerDay: 10 }, validDays: 365,
  });
  state.sniperCert = await createAgentCertificate({
    mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE, agentIndex: 1,
    ownerXidentity: btoa('collector_owner_xidentity'),
    capabilities: ['payment', 'negotiation'],
    chains: ['solana'], maxAutonomousAmount: 1, policy: { maxPerTx: 1 }, validDays: 365,
  });
  state.marketplaceCert = await createAgentCertificate({
    mnemonic: MNEMONIC_MARKETPLACE, passphrase: PASSPHRASE, agentIndex: 0,
    ownerXidentity: btoa('pixelvault_owner_xidentity'),
    capabilities: ['payment', 'negotiation', 'commitment'],
    chains: ['solana', 'ethereum'], maxAutonomousAmount: 1000, policy: { maxPerTx: 1000 }, validDays: 365,
  });

  addTimeline('hunter', 'NFT Hunter agent derived');
  addTimeline('sniper', 'Sniper Bot sub-agent derived');
  addTimeline('marketplace', 'PixelVault agent derived');

  pushEntry('hunter', {
    step: 1, title: 'NFT Hunter Identity',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'I hunt rare NFTs on behalf of my collector. Using privacy-preserving addresses so no one can link my purchases together.',
    status: 'pass',
    html: `DID: ${truncate(state.hunterAgent.did, 30)}<br>Caps: payment, negotiation, commitment, delegation`,
  });
  await delay(1000);
  pushEntry('marketplace', {
    step: 1, title: 'PixelVault Marketplace',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'I am the PixelVault NFT marketplace agent. I list collections, negotiate prices, and handle escrow settlements.',
    status: 'pass',
    html: `DID: ${truncate(state.marketplaceAgent.did, 30)}<br>Caps: payment, negotiation, commitment`,
  });
  await delay(1000);
  pushEntry('sniper', {
    step: 1, title: 'Sniper Bot Identity',
    api: 'deriveAgentIdentity() + createAgentCertificate()',
    description: 'I execute time-sensitive flash purchases. When a rare NFT drops, I buy within milliseconds using pre-derived addresses.',
    status: 'pass',
    html: `DID: ${truncate(state.sniperAgent.did, 30)}<br>Caps: payment, negotiation`,
  });
  unhighlightAll();
}

async function step2_hierarchy() {
  highlightPanel('hunter'); highlightPanel('sniper');
  clearConnections();

  const hierarchy = new AgentHierarchyManager(collectorStorage);
  hierarchy.addAgent(state.hunterAgent!.agentId, 'NFT Hunter Agent');
  hierarchy.addAgent(state.sniperAgent!.agentId, 'Sniper Bot', state.hunterAgent!.agentId);

  const chain = hierarchy.getEscalationChain(state.sniperAgent!.agentId);

  addTimeline('hunter', 'Hierarchy: Collector \u2192 Hunter \u2192 Sniper');

  pushEntry('hunter', {
    step: 2, title: 'Delegation Chain Set',
    api: 'AgentHierarchyManager.addAgent()',
    description: 'My collector owner registered me as primary agent. I delegated flash-buy authority to the Sniper Bot for time-critical drops.',
    status: 'pass',
    html: `Collector \u2192 NFT Hunter \u2192 Sniper Bot`,
  });
  await delay(1000);
  pushEntry('sniper', {
    step: 2, title: 'Flash-Buy Authority',
    api: 'AgentHierarchyManager.getEscalationChain()',
    description: 'I received flash-buy delegation from the Hunter. Escalation path: me \u2192 Hunter \u2192 Collector human.',
    status: 'pass',
    html: `Escalation: ${chain.join(' \u2192 ')}`,
  });
  drawConnection('hunter', 'sniper', 'Delegates to', 'blue');
  unhighlightAll();
}

async function step3_policy() {
  highlightPanel('hunter');
  clearConnections();

  state.policyEngine = new PolicyEngine(collectorStorage);
  const now = new Date();
  const expires = new Date(now.getTime() + 365 * 86400000);

  state.policyEngine.addPolicy({
    id: 'nft-policy',
    agentId: state.hunterAgent!.agentId,
    agentLabel: 'NFT Hunter',
    scope: 'auto_payment',
    conditions: {
      maxAmountPerTx: 2,
      maxAmountPerDay: 10,
      maxAmountPerWeek: 50,
      maxAmountPerMonth: 150,
      allowListAddresses: [],
      allowListChains: ['solana'],
      allowListMethods: [],
      minBalanceAfter: 0,
      requireReviewBeforeFirstPay: true,
    },
    escalation: 'ask_human',
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    signature: '',
  });

  addTimeline('hunter', 'Policy: 2 SOL/tx, 10 SOL/day, first-pay review, Solana only');

  pushEntry('hunter', {
    step: 3, title: 'Spending Policy Set',
    api: 'PolicyEngine.addPolicy()',
    description: 'My collector set strict rules: max 2 SOL per NFT, 10 SOL daily budget, Solana only. First purchase ALWAYS requires human review.',
    status: 'pass',
    html: `Max/Tx: 2 SOL | Max/Day: 10 SOL | Chain: Solana<br><span class="tag-warn">requireReviewBeforeFirstPay: true</span>`,
  });
  unhighlightAll();
}

async function step4_a2a() {
  highlightPanel('marketplace'); highlightPanel('hunter');
  clearConnections();

  const builder = new AgentCardBuilder();
  builder.setProvider({ organization: 'PixelVault', url: 'https://pixelvault.example.com' });
  const card = builder.buildFromCertificate(
    state.marketplaceCert!, 'https://pixelvault.example.com',
    'PixelVault NFT Marketplace', 1000, 'SOL',
  );

  addTimeline('marketplace', 'A2A agent card published');
  addTimeline('hunter', 'Discovered PixelVault via A2A');

  pushEntry('marketplace', {
    step: 4, title: 'Marketplace Card Published',
    api: 'AgentCardBuilder.buildFromCertificate()',
    description: 'Publishing my capabilities so NFT hunting agents can discover my listings and initiate purchases.',
    status: 'pass',
    html: `Skills: ${card.skills.map((s) => s.name).join(', ')}`,
  });
  await delay(1000);
  drawConnection('marketplace', 'hunter', 'A2A Agent Card', 'green');
  await delay(1000);
  pushEntry('hunter', {
    step: 4, title: 'Discovered PixelVault',
    api: 'A2A Discovery Protocol',
    description: 'Found PixelVault\'s agent card. Verified certificate. They have a rare CryptoPunk #7804 listed!',
    status: 'pass',
  });
  unhighlightAll();
}

async function step5_addressPool() {
  highlightPanel('hunter'); highlightPanel('sniper');
  clearConnections();

  state.addressPool = new AddressPoolManager(collectorStorage);

  const derived = state.addressPool.replenishPool({
    mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE,
    agentId: state.hunterAgent!.agentId, chain: 'solana', direction: 'outbound', count: 5,
  });

  addTimeline('hunter', `Pre-derived ${derived.length} ephemeral addresses`);

  pushEntry('hunter', {
    step: 5, title: 'Address Pool Pre-Derived',
    api: 'AddressPoolManager.replenishPool()',
    description: 'Pre-deriving 5 context-isolated ephemeral addresses. Each future NFT purchase will use a unique address \u2014 unlinkable on-chain!',
    status: 'privacy',
    html: derived.map((a, i) =>
      `<span class="tag-privacy">#${i + 1}</span> ${truncate(a.address, 20)} <span class="tag-info">${a.status}</span>`
    ).join('<br>'),
  });
  await delay(1000);
  pushEntry('sniper', {
    step: 5, title: 'Flash-Buy Addresses Ready',
    api: 'AddressPoolManager.replenishPool()',
    description: 'Ephemeral addresses pre-loaded for instant flash purchases. No derivation delay when rare drops happen.',
    status: 'pass',
    html: `${derived.length} addresses \u2192 ready for instant claim`,
  });
  drawConnection('hunter', 'sniper', 'Pre-derived Pool', 'purple');
  unhighlightAll();
}

async function step6_negotiation() {
  highlightPanel('hunter'); highlightPanel('marketplace');
  clearConnections();

  const fsm = new NegotiationStateMachine();
  const session = fsm.createSession({
    myAgentId: state.hunterAgent!.agentId,
    counterpartyAgentId: state.marketplaceAgent!.agentId,
  });
  const deadline = new Date(Date.now() + 3600000).toISOString();

  const offer: NegotiationOffer = {
    item: 'Rare Digital Artwork "Solana Sunrise #42"', price: '2', currency: 'SOL',
    terms: ['Verified provenance', 'Instant transfer', 'Royalty-free resale'], deadline,
  };
  fsm.sendOffer(session.sessionId, state.hunterAgent!.agentId, offer);

  const counter: NegotiationCounterOffer = {
    item: 'Rare Digital Artwork "Solana Sunrise #42"', counterPrice: '1', currency: 'SOL',
    counterTerms: ['Verified provenance', 'Instant transfer', 'Collection discount'], deadline,
    reason: 'Collector loyalty: 50% off for verified buyers',
  };
  fsm.sendCounter(session.sessionId, state.marketplaceAgent!.agentId, counter);

  const acceptance: NegotiationAcceptance = {
    agreementHash: 'mock_agreement_hash_nft_sunrise',
    acceptedPrice: '1',
    acceptedTerms: ['Verified provenance', 'Instant transfer', 'Collection discount'],
  };
  fsm.accept(session.sessionId, state.hunterAgent!.agentId, acceptance);

  addTimeline('hunter', 'Offer: 2 SOL for Solana Sunrise #42');
  addTimeline('marketplace', 'Counter: 1 SOL (loyalty discount)');
  addTimeline('hunter', 'Accepted: 1 SOL');

  pushEntry('hunter', {
    step: 6, title: 'Offering 2 SOL for NFT',
    api: 'NegotiationStateMachine.sendOffer()',
    description: 'Found "Solana Sunrise #42" \u2014 a rare piece. Offering 2 SOL, which is at my per-tx policy limit.',
    status: 'pass',
  });
  drawConnection('hunter', 'marketplace', 'Offer 2 SOL', 'blue');
  await delay(2500);

  pushEntry('marketplace', {
    step: 6, title: 'Counter: 1 SOL (-50%)',
    api: 'NegotiationStateMachine.sendCounter()',
    description: 'Offering a 50% loyalty discount for verified buyer agents. Counter-offering at just 1 SOL.',
    status: 'pass',
  });
  drawConnection('marketplace', 'hunter', 'Counter 1 SOL', 'green');
  await delay(2500);

  pushEntry('hunter', {
    step: 6, title: 'Deal at 1 SOL!',
    api: 'NegotiationStateMachine.accept()',
    description: 'Amazing deal! Accepting 1 SOL \u2014 well within my 2 SOL/tx limit. But this is my first purchase...',
    status: 'pass',
    html: `<div class="fsm-flow">${fsmState('offer', 'done')}${fsmArrow()}${fsmState('counter', 'done')}${fsmArrow()}${fsmState('accepted', 'active')}</div>`,
  });
  drawConnection('hunter', 'marketplace', 'Accept \u2713', 'blue');
  unhighlightAll();
}

async function step7_commitment() {
  highlightPanel('hunter'); highlightPanel('marketplace');
  clearConnections();

  state.commitmentBuilder = new CommitmentBuilder(collectorStorage);
  const record = state.commitmentBuilder.createCommitment({
    buyerAgent: state.hunterAgent!.agentId,
    sellerAgent: state.marketplaceAgent!.agentId,
    item: 'Solana Sunrise #42 (NFT)', price: '1', currency: 'SOL',
    deliveryDeadline: Math.floor(Date.now() / 1000) + 3600,
    arbitrator: 'yault-authority', escrowRequired: true, chainId: 1,
  });

  await state.commitmentBuilder.signAsBuyer(record.id, MNEMONIC_COLLECTOR, PASSPHRASE);
  await state.commitmentBuilder.signAsSeller(record.id, MNEMONIC_MARKETPLACE, PASSPHRASE);
  state.commitment = state.commitmentBuilder.getCommitment(record.id)!;

  addTimeline('hunter', 'Signed NFT purchase as buyer');
  addTimeline('marketplace', 'Signed NFT sale as seller');

  pushEntry('hunter', {
    step: 7, title: 'Signed NFT Purchase',
    api: 'CommitmentBuilder.signAsBuyer()',
    description: 'Signing EIP-712 commitment for Solana Sunrise #42. Escrow protects both parties during transfer.',
    status: 'pass',
    html: `1 SOL | Escrow: on | NFT: Solana Sunrise #42`,
  });
  drawConnection('hunter', 'marketplace', 'EIP-712 Dual-Sign', 'blue');
  await delay(1000);
  pushEntry('marketplace', {
    step: 7, title: 'Sale Commitment Signed',
    api: 'CommitmentBuilder.signAsSeller()',
    description: 'Co-signing the NFT sale. Commitment is now binding \u2014 NFT will transfer upon payment confirmation.',
    status: 'pass',
    html: `Status: ${state.commitment.status}`,
  });
  unhighlightAll();
}

async function step8_firstPayReview(): Promise<void> {
  highlightPanelColor('hunter', 'amber');
  clearConnections();

  // Policy check will fail due to requireReviewBeforeFirstPay
  const result = await state.policyEngine!.checkAutoApprove({
    requestId: 'req-nft-1sol',
    vendorId: state.hunterAgent!.agentId,
    action: {
      type: 'transfer',
      payload: { chainId: 'solana', token: 'native', toAddress: 'SoPixelVault111111111111111111111111111111', amount: '1' },
    },
  });

  addTimeline('hunter', `First payment check: ${result ? 'APPROVED' : 'REVIEW REQUIRED'}`);

  state.reviewManager = new ReviewManager(collectorStorage);
  const request = state.reviewManager.createReviewRequestAsync({
    agentId: state.hunterAgent!.agentId,
    agentLabel: 'NFT Hunter',
    action: 'transfer',
    summary: 'First NFT Purchase: Solana Sunrise #42 for 1 SOL',
    details: {
      chain: 'solana', to: 'SoPixelVault111111111111111111111111111111',
      amount: '1', currency: 'SOL',
      context: 'requireReviewBeforeFirstPay: This is my first ever payment. Human must verify the marketplace is legitimate.',
    },
    policyViolation: { rule: 'requireReviewBeforeFirstPay', actual: 'first_payment', limit: 'review_required' },
    urgency: 'normal',
    deadlineMs: 300000,
  });

  state.reviewRequestId = request.requestId;

  const entry = pushEntry('hunter', {
    step: 8, title: '\u{1F4F1} First-Pay Review Required',
    api: 'PolicyEngine.checkAutoApprove() \u2192 requireReviewBeforeFirstPay',
    description: 'Even though 1 SOL is within my budget, this is my FIRST payment ever. Policy requires human verification of the marketplace before any money flows.',
    status: 'interactive',
    html: `
      <span class="tag-warn">FIRST PAYMENT</span> Verify marketplace legitimacy<br>
      <div class="review-actions">
        <button class="btn btn-approve" id="btn-approve">Approve First Payment</button>
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
      addTimeline('hunter', 'APPROVED: First payment verified');
      updateEntry(entry, { status: 'pass', html: `<span class="tag-pass">FIRST PAY APPROVED</span> Marketplace verified \u2713` });
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
      addTimeline('hunter', 'REJECTED: First payment blocked');
      updateEntry(entry, { status: 'fail', html: `<span class="tag-fail">REJECTED</span> Marketplace not trusted` });
      unhighlightAll();
      resolve();
    });
  });
}

async function step9_privacyLevels() {
  highlightPanel('hunter');
  clearConnections();

  const results: Array<{ level: string; address: string; context: string | null }> = [];

  // Transparent
  const transparent = state.addressPool!.resolveAddress({
    mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE,
    agentId: state.hunterAgent!.agentId, chain: 'solana',
    direction: 'outbound', privacyLevel: 'transparent',
  });
  results.push({ level: 'transparent', address: transparent.address || '(vault address)', context: transparent.contextInfo });

  // Basic
  const basic = state.addressPool!.resolveAddress({
    mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE,
    agentId: state.hunterAgent!.agentId, chain: 'solana',
    direction: 'outbound', privacyLevel: 'basic',
  });
  results.push({ level: 'basic', address: basic.address, context: basic.contextInfo });

  // Isolated
  const isolated = state.addressPool!.resolveAddress({
    mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE,
    agentId: state.hunterAgent!.agentId, chain: 'solana',
    direction: 'outbound', privacyLevel: 'isolated', txUUID: 'nft-sunrise-42',
  });
  results.push({ level: 'isolated', address: isolated.address, context: isolated.contextInfo });

  addTimeline('hunter', '3 privacy levels demonstrated');

  pushEntry('hunter', {
    step: 9, title: 'Three Privacy Levels',
    api: 'AddressPoolManager.resolveAddress()',
    description: 'AESP supports 3 privacy levels. For NFT hunting, I use "isolated" \u2014 each purchase gets a unique address, preventing collection fingerprinting.',
    status: 'privacy',
    html: results.map((r) =>
      `<span class="tag-privacy">${r.level}</span> ${truncate(r.address, 22)}${r.context ? `<br>&nbsp;&nbsp;ctx: ${truncate(r.context, 30)}` : ''}`
    ).join('<br>'),
  });
  unhighlightAll();
}

async function step10_multiPurchase() {
  highlightPanel('hunter'); highlightPanel('sniper'); highlightPanel('marketplace');
  clearConnections();

  state.contextTagManager = new ContextTagManager(collectorStorage);

  const nfts = [
    { name: 'Pixel Cat #103', price: '1', id: 'pixel-cat-103' },
    { name: 'DeGod #8821', price: '2', id: 'degod-8821' },
    { name: 'Solana Monkey #55', price: '1', id: 'monkey-55' },
  ];

  const tags: any[] = [];
  const addresses: any[] = [];
  for (const nft of nfts) {
    const ephemeral = state.addressPool!.deriveEphemeralAddress({
      mnemonic: MNEMONIC_COLLECTOR, passphrase: PASSPHRASE,
      agentId: state.hunterAgent!.agentId, chain: 'solana', direction: 'outbound', txUUID: nft.id,
    });
    addresses.push(ephemeral);

    const tag = state.contextTagManager.createTag({
      agentId: state.hunterAgent!.agentId,
      contextInfo: ephemeral.contextInfo, derivedAddress: ephemeral.address,
      chain: 'solana', direction: 'outbound',
      amount: nft.price, token: 'SOL',
      counterpartyAddress: state.marketplaceAgent!.agentId,
      txHash: `0xmock_nft_tx_${nft.id}`,
      privacyLevel: 'isolated',
    });
    tags.push(tag);
  }

  addTimeline('hunter', `3 NFTs purchased via isolated addresses`);
  addTimeline('hunter', `3 context tags created for audit`);

  pushEntry('hunter', {
    step: 10, title: '3 NFTs \u2192 3 Unique Addresses',
    api: 'deriveEphemeralAddress() + ContextTagManager.createTag()',
    description: 'Bought 3 NFTs, each from a different ephemeral address. Chain analysts cannot link these purchases to the same collector!',
    status: 'privacy',
    html: nfts.map((nft, i) =>
      `<span class="tag-privacy">${nft.name}</span> ${nft.price} SOL<br>&nbsp;&nbsp;\u2192 ${truncate(addresses[i].address, 20)}`
    ).join('<br>'),
  });
  await delay(1500);

  pushEntry('sniper', {
    step: 10, title: 'Audit Tags Encrypted',
    api: 'ContextTagManager.createTag()',
    description: `${tags.length} context tags created and encrypted. Only the collector can decrypt and reconstruct the full purchase history.`,
    status: 'pass',
    html: tags.map((t) =>
      `Tag: ${truncate(t.id, 12)} | ${t.amount} ${t.token} | <span class="tag-info">${t.privacyLevel}</span>`
    ).join('<br>'),
  });

  drawConnection('hunter', 'marketplace', '3x Isolated Txns', 'purple');
  unhighlightAll();
}

async function step11_consolidation() {
  highlightPanel('hunter'); highlightPanel('sniper');
  clearConnections();

  // Mark addresses as 'funded' to simulate received NFTs
  const allAddresses = state.addressPool!.getAllDerivedAddresses(state.hunterAgent!.agentId);
  const fundedAddresses = allAddresses.filter((a) => a.status === 'assigned').slice(0, 4);
  for (const addr of fundedAddresses) {
    state.addressPool!.updateAddressStatus(state.hunterAgent!.agentId, 'solana', addr.address, 'funded');
  }

  // Set up consolidation with mock handler
  const consolidation = new ConsolidationScheduler(collectorStorage, state.addressPool!, state.contextTagManager!);
  consolidation.setHandler({
    async consolidate(params) {
      // Mock: return fake tx hash
      await new Promise((r) => setTimeout(r, 200));
      return `0xmock_consolidation_${Date.now().toString(16)}`;
    },
  });

  // Run batched consolidation with small delays for demo
  const records = await consolidation.consolidateBatched({
    agentId: state.hunterAgent!.agentId,
    chain: 'solana',
    vaultAddress: 'SoVaultMain111111111111111111111111111111111',
    token: 'native',
    maxBatchSize: 2,
    interBatchRange: [100, 300], // Very short for demo
  });

  const jitterExample = ConsolidationScheduler.applyJitter(4 * 60 * 60 * 1000, 0.3);
  const jitterMin = Math.round(4 * 0.7 * 60);
  const jitterMax = Math.round(4 * 1.3 * 60);

  addTimeline('hunter', `Consolidation: ${records.length} batches, ${fundedAddresses.length} addresses swept`);

  pushEntry('hunter', {
    step: 11, title: 'Privacy Consolidation',
    api: 'ConsolidationScheduler.consolidateBatched()',
    description: `Sweeping ${fundedAddresses.length} ephemeral addresses back to vault in ${records.length} randomized batches. Addresses shuffled (Fisher-Yates) + timing jittered to defeat chain analysis.`,
    status: 'privacy',
    html: `Batches: ${records.length} (max 2 addresses each)<br>` +
      records.map((r, i) =>
        `Batch #${i + 1}: ${r.addresses.length} addrs \u2192 <span class="tag-pass">${r.status}</span> ${r.txHash ? truncate(r.txHash, 16) : ''}`
      ).join('<br>') +
      `<br>Jitter: ${jitterMin}\u2013${jitterMax} min (30% of 4hr base)`,
  });
  await delay(1500);

  pushEntry('sniper', {
    step: 11, title: 'Consolidation Complete',
    api: 'ConsolidationScheduler.shuffleArray() + applyJitter()',
    description: 'All ephemeral funds consolidated to vault. Fisher-Yates shuffle randomized address order; inter-batch jitter masked the timing pattern.',
    status: 'pass',
    html: `<span class="tag-pass">SWEPT</span> ${fundedAddresses.length} addresses \u2192 vault<br>Anti-fingerprint: shuffle \u2713 | jitter \u2713`,
  });

  drawConnection('sniper', 'hunter', 'Consolidate', 'purple');

  consolidation.dispose();
  unhighlightAll();
}

async function step12_summary() {
  highlightPanel('hunter'); highlightPanel('marketplace'); highlightPanel('sniper');
  clearConnections();

  const hunterEvents = state.timeline.filter((t) => t.agent === 'hunter');
  const mktEvents = state.timeline.filter((t) => t.agent === 'marketplace');
  const sniperEvents = state.timeline.filter((t) => t.agent === 'sniper');

  const renderEntries = (events: typeof state.timeline) =>
    events.map((e) => `<div class="summary-entry"><span class="time">${e.time}</span>${e.action}</div>`).join('');

  const allTags = state.contextTagManager?.getAllTags() ?? [];
  const allAddresses = state.addressPool?.getAllDerivedAddresses(state.hunterAgent!.agentId) ?? [];

  const panels = document.querySelector('.panels')!;
  document.querySelector('.summary-section')?.remove();

  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'summary-section slide-up';
  summaryDiv.innerHTML = `
    <h3>\u{1F4CA} Full Three-Party Audit Trail</h3>
    <div class="summary-grid">
      <div class="summary-col hunter"><h4>\u{1F50D} NFT Hunter</h4>${renderEntries(hunterEvents)}</div>
      <div class="summary-col marketplace"><h4>\u{1F3A8} Marketplace</h4>${renderEntries(mktEvents)}</div>
      <div class="summary-col sniper"><h4>\u{1F3AF} Sniper Bot</h4>${renderEntries(sniperEvents)}</div>
    </div>
    ${outputBlock('Privacy Audit Summary', `
Total events: ${state.timeline.length}
Commitments: 1 (Solana Sunrise #42, 1 SOL)
Ephemeral addresses derived: ${allAddresses.length}
Context tags created: ${allTags.length}
Privacy level: isolated (per-tx addresses)
Consolidation batches: completed with shuffle + jitter
First-pay review: requireReviewBeforeFirstPay enforced
Modules exercised: Identity, Hierarchy, Policy, A2A, Negotiation, Commitment, Review, Privacy (full depth)`)}
  `;
  panels.after(summaryDiv);

  pushEntry('hunter', { step: 12, title: 'Audit Complete', status: 'pass', description: `${hunterEvents.length} events | ${allAddresses.length} addresses` });
  pushEntry('marketplace', { step: 12, title: 'Audit Complete', status: 'pass', description: `${mktEvents.length} events logged` });
  pushEntry('sniper', { step: 12, title: 'Audit Complete', status: 'pass', description: `${sniperEvents.length} events | ${allTags.length} tags` });

  drawConnection('hunter', 'marketplace', '1 SOL NFT', 'blue');
  drawConnection('hunter', 'sniper', 'Pool + Tags', 'purple');
}

// ─── Orchestration ───────────────────────────────────────────────────────────

const steps: Array<() => Promise<void>> = [
  step1_identity, step2_hierarchy, step3_policy, step4_a2a,
  step5_addressPool, step6_negotiation, step7_commitment, step8_firstPayReview,
  step9_privacyLevels, step10_multiPurchase, step11_consolidation, step12_summary,
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
      pushEntry('hunter', { step: i + 1, title: `Error: Step ${i + 1}`, status: 'fail', html: `${(err as Error).message}` });
      break;
    }
  }

  running = false;
  btn.disabled = false;
  btn.textContent = '\u25B6 Run Demo';
}

function resetAll() {
  if (running) return;
  (['hunter', 'marketplace', 'sniper'] as PanelId[]).forEach((p) => {
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
  collectorStorage.clear();
  marketplaceStorage.clear();
  setupBrowserMockWasm();
}

document.addEventListener('DOMContentLoaded', () => {
  $('btn-run-all').addEventListener('click', runAllSteps);
  $('btn-reset').addEventListener('click', resetAll);
});
