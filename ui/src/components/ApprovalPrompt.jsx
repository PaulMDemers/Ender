export default function ApprovalPrompt({ approval, onApprove, onDeny }) {
  if (!approval) return null;

  return (
    <div className="approvalBox">
      <div className="approvalTitle">{approval.title || "Approval required"}</div>
      <div className="approvalDesc">{approval.description}</div>
      <div className="approvalMeta">Task requests action type: {approval.type}</div>
      <div className="approvalActions">
        <button className="actionButton" onClick={() => onApprove?.(approval.id)}>
          Approve
        </button>
        <button className="dangerButton" onClick={() => onDeny?.(approval.id)}>
          Deny
        </button>
      </div>
    </div>
  );
}
