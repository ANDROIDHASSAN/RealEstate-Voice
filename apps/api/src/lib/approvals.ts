import {
  APPROVAL_ACTION_META,
  defaultApprovalPolicy,
  defaultSelfCorrect,
  type ApprovalAction,
  type ApprovalPolicy,
  type SelfCorrectConfig,
} from '@truecode/shared';
import { logger } from '../logger.js';
import { AgentOpsConfig, Approval } from '../models.js';
import { emitAgentEvent } from './events.js';

/**
 * Human-in-the-loop approvals.
 *
 * `requireApproval()` is the gate: an action checks policy and, if the account
 * requires human sign-off for that action, it persists the full payload as a
 * pending Approval and returns `{ gated: true }` — the caller stops WITHOUT
 * performing the action. Later, a human approves; `decideApproval()` looks up the
 * registered executor for that action and replays the persisted payload. Because
 * the payload lives in Mongo, the pause can last minutes or hours and the action
 * resumes exactly where it left off — durable workflow persistence, not an
 * in-memory promise that dies with the process.
 *
 * Policy is opt-in per action and defaults to OFF, so turning on the AgentOps
 * module never silently changes an account's existing send behavior.
 */

export interface AgentOpsSettings {
  approvalPolicy: ApprovalPolicy;
  selfCorrect: SelfCorrectConfig;
}

export async function getAgentOpsConfig(accountId: string): Promise<AgentOpsSettings> {
  const doc = await AgentOpsConfig.findOne({ accountId }).lean();
  return {
    approvalPolicy: { ...defaultApprovalPolicy(), ...((doc?.approvalPolicy as ApprovalPolicy) ?? {}) },
    selfCorrect: { ...defaultSelfCorrect(), ...((doc?.selfCorrect as Partial<SelfCorrectConfig>) ?? {}) },
  };
}

export async function requiresApproval(accountId: string, action: ApprovalAction): Promise<boolean> {
  const { approvalPolicy } = await getAgentOpsConfig(accountId);
  return Boolean(approvalPolicy[action]);
}

export interface RequireApprovalOpts {
  accountId: string;
  action: ApprovalAction;
  title: string;
  summary?: string;
  payload: Record<string, unknown>;
  requestedBy?: string;
  origin?: string;
  leadId?: string;
  /** Skip the gate entirely (used when resuming an already-approved action). */
  skip?: boolean;
}

export interface ApprovalGateResult {
  gated: boolean;
  approvalId?: string;
}

/** The gate. Returns `{ gated:true }` when the action was parked for approval. */
export async function requireApproval(opts: RequireApprovalOpts): Promise<ApprovalGateResult> {
  if (opts.skip) return { gated: false };
  if (!(await requiresApproval(opts.accountId, opts.action))) return { gated: false };

  const meta = APPROVAL_ACTION_META[opts.action];
  const approval = await Approval.create({
    accountId: opts.accountId,
    action: opts.action,
    title: opts.title,
    summary: opts.summary,
    risk: meta.risk,
    payload: opts.payload,
    status: 'pending',
    requestedBy: opts.requestedBy,
    origin: opts.origin,
    leadId: opts.leadId,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  });
  emitAgentEvent(opts.accountId, {
    type: 'agent:step',
    agentKey: 'approval-gate',
    title: `Approval needed: ${meta.label}`,
    detail: opts.title,
    status: 'blocked',
  });
  logger.info({ accountId: opts.accountId, action: opts.action, approvalId: String(approval._id) }, 'action parked for approval');
  return { gated: true, approvalId: String(approval._id) };
}

// --- Executor registry ------------------------------------------------------

/** Resumes an approved action from its persisted payload. */
export type ApprovalExecutor = (
  payload: Record<string, unknown>,
  ctx: { accountId: string; approvalId: string; leadId?: string },
) => Promise<Record<string, unknown>>;

const executors = new Map<ApprovalAction, ApprovalExecutor>();

export function registerApprovalExecutor(action: ApprovalAction, fn: ApprovalExecutor): void {
  executors.set(action, fn);
}

export interface DecideResult {
  status: 'approved' | 'rejected' | 'not_found' | 'already_decided';
  execution?: 'executed' | 'failed';
  result?: Record<string, unknown>;
}

/** Approve or reject a pending request. On approve, the executor resumes the action. */
export async function decideApproval(
  accountId: string,
  id: string,
  decision: 'approved' | 'rejected',
  decidedBy?: string,
  reason?: string,
): Promise<DecideResult> {
  const approval = await Approval.findOne({ _id: id, accountId });
  if (!approval) return { status: 'not_found' };
  if (approval.status !== 'pending') return { status: 'already_decided' };

  approval.decidedBy = decidedBy;
  approval.reason = reason;
  approval.decidedAt = new Date();

  if (decision === 'rejected') {
    approval.status = 'rejected';
    await approval.save();
    emitAgentEvent(accountId, { type: 'agent:step', agentKey: 'approval-gate', title: `Rejected: ${approval.title}`, status: 'blocked' });
    return { status: 'rejected' };
  }

  approval.status = 'approved';
  await approval.save();

  const executor = executors.get(approval.action as ApprovalAction);
  if (!executor) {
    approval.status = 'failed';
    approval.result = { error: 'no_executor_registered' };
    await approval.save();
    return { status: 'approved', execution: 'failed', result: approval.result as Record<string, unknown> };
  }

  try {
    const result = await executor(approval.payload as Record<string, unknown>, {
      accountId,
      approvalId: String(approval._id),
      leadId: approval.leadId ? String(approval.leadId) : undefined,
    });
    approval.status = 'executed';
    approval.result = result;
    await approval.save();
    emitAgentEvent(accountId, { type: 'agent:done', agentKey: 'approval-gate', title: `Approved & executed: ${approval.title}`, status: 'done' });
    return { status: 'approved', execution: 'executed', result };
  } catch (err) {
    approval.status = 'failed';
    approval.result = { error: (err as Error).message };
    await approval.save();
    emitAgentEvent(accountId, { type: 'agent:error', agentKey: 'approval-gate', title: `Execution failed: ${approval.title}`, detail: (err as Error).message, status: 'error' });
    return { status: 'approved', execution: 'failed', result: approval.result as Record<string, unknown> };
  }
}
