// @ts-check

const { randomUUID } = require("node:crypto");

function normalizeApproval(input = {}, defaults = {}) {
  return {
    id: String(defaults.id || input.id || ""),
    type: input.type || "generic",
    title: input.title || "Approval required",
    description: input.description || "Please confirm this action",
    details: input.details || {},
    requestedAt: defaults.requestedAt || input.requestedAt || new Date().toISOString()
  };
}

class TaskApprovalCoordinator {
  constructor(options = {}) {
    this.createId = options.createId || randomUUID;
    this.now = options.now || (() => new Date().toISOString());
  }

  createStore(records = []) {
    const approvals = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const approval = normalizeApproval(record, { requestedAt: record?.requestedAt || this.now() });
      if (!approval.id) continue;
      approvals.set(approval.id, { ...approval, resolve: () => {} });
    }
    return approvals;
  }

  count(task) {
    return this._store(task).size;
  }

  list(task) {
    return [...this._store(task).values()].map((approval) => ({
      id: approval.id,
      type: approval.type,
      title: approval.title,
      description: approval.description,
      details: approval.details,
      requestedAt: approval.requestedAt
    }));
  }

  request(task, payload = {}) {
    const approvals = this._store(task);
    let id = String(this.createId());
    while (!id || approvals.has(id)) id = String(this.createId());

    let resolveDecision;
    const decision = new Promise((resolve) => {
      resolveDecision = resolve;
    });
    let settled = false;
    const approval = {
      ...normalizeApproval(payload, { id, requestedAt: this.now() }),
      resolve: (approved) => {
        if (settled) return;
        settled = true;
        resolveDecision(Boolean(approved));
      }
    };

    approvals.set(id, approval);
    return { approval, decision };
  }

  resolve(task, approvalId, approved) {
    const approvals = this._store(task);
    const id = String(approvalId);
    const approval = approvals.get(id);
    if (!approval) return { ok: false, error: "approval_not_found" };

    approvals.delete(id);
    approval.resolve(Boolean(approved));
    return { ok: true, approval, remaining: approvals.size };
  }

  rejectAll(task) {
    const approvals = this._store(task);
    const count = approvals.size;
    for (const approval of approvals.values()) approval.resolve(false);
    approvals.clear();
    return count;
  }

  _store(task) {
    if (!(task.pendingApprovals instanceof Map)) {
      task.pendingApprovals = new Map();
    }
    return task.pendingApprovals;
  }
}

module.exports = {
  TaskApprovalCoordinator,
  normalizeApproval
};
