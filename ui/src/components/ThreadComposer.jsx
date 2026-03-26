import { useRef, useState } from "react";

function getStatusLabel(status) {
  if (!status) return "idle";
  if (status === "awaiting_approval") return "approval needed";
  if (status === "done") return "completed";
  return String(status).replaceAll("_", " ");
}

export default function ThreadComposer({ disabled, onSend, workspace, taskId, status }) {
  const [text, setText] = useState("");
  const textareaRef = useRef(null);

  const submit = async (event) => {
    event?.preventDefault?.();
    const next = text.trim();
    if (!next || disabled) return;
    await onSend?.(next);
    setText("");
    textareaRef.current?.focus({ preventScroll: true });
  };

  return (
    <form className="threadComposer" onSubmit={submit}>
      <div className="composerTop">
        <div>
          <div className="composerEyebrow">Continue operation</div>
          <div className="composerContext mono">
            {taskId ? `${taskId.slice(0, 8)} · ${getStatusLabel(status)}` : "No active thread"}
          </div>
        </div>
        <div className="composerContext mono">{workspace || "No workspace scope"}</div>
      </div>

      <div className="composerInputRow">
        <textarea
          ref={textareaRef}
          value={text}
          className="composerTextarea"
          rows={2}
          placeholder="Continue this thread with the next instruction. Shift+Enter adds a new line."
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="submit"
          className="primaryButton composerButton"
          disabled={disabled || !text.trim()}
          onMouseDown={(event) => event.preventDefault()}
        >
          Send
        </button>
      </div>
    </form>
  );
}
