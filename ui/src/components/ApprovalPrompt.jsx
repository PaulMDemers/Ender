function formatTimestamp(value) {
  if (!value) return "pending";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export default function ApprovalPrompt({ approval, onApprove, onDeny }) {
  if (!approval) return null;
  const titleId = `approval-title-${approval.id}`;

  return (
    <section className="approvalCard approvalCardSticky" role="alert" aria-labelledby={titleId}>
      <div className="approvalHeader">
        <div>
          <div className="workflowBadge">APPROVAL REQUIRED</div>
          <h2 id={titleId} className="approvalTitle">{approval.title || "Sensitive action requested"}</h2>
        </div>
        <div className="approvalCode mono">{approval.type || "sensitive_action"} · {String(approval.id || "").slice(0, 8)}</div>
      </div>

      <div className="approvalDesc">
        {approval.description || "The agent has paused because this action could change external state or perform a privileged operation."}
      </div>

      {approval.details ? (
        <pre className="approvalDetails mono">{typeof approval.details === "string" ? approval.details : JSON.stringify(approval.details, null, 2)}</pre>
      ) : null}

      <div className="approvalFooter">
        <div className="panelNote">Requested at {formatTimestamp(approval.requestedAt)}. Resolve this action to unblock the run; the decision is recorded in the transcript.</div>
        <div className="approvalActions">
          <button className="primaryButton" onClick={() => onApprove?.(approval.id)}>
            Approve
          </button>
          <button className="dangerButton" onClick={() => onDeny?.(approval.id)}>
            Deny
          </button>
        </div>
      </div>
    </section>
  );
}
