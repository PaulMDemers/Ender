import { useRef, useState } from "react";
import { MAX_ATTACHMENTS, prepareMessageAttachments } from "../utils/messageAttachments";

function getStatusLabel(status) {
  if (!status) return "idle";
  if (status === "awaiting_approval") return "approval needed";
  if (status === "done") return "completed";
  return String(status).replaceAll("_", " ");
}

function getAttachmentLabel(attachment) {
  if (attachment.kind === "image") return "image";
  if (attachment.kind === "text") return "text";
  return "file";
}

export default function ThreadComposer({ disabled, onSend, workspace, taskId, status }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const canSend = Boolean(text.trim() || attachments.length);

  const submit = async (event) => {
    event?.preventDefault?.();
    if (!canSend || disabled || attachmentBusy) return;

    const prompt = text.trim();
    const content = attachments.flatMap((attachment) => attachment.blocks || []);
    await onSend?.({
      prompt,
      ...(content.length ? { content } : {})
    });
    setText("");
    setAttachments([]);
    setAttachmentError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    textareaRef.current?.focus({ preventScroll: true });
  };

  const attachFiles = async (event) => {
    const files = event.target?.files;
    if (!files?.length) return;

    setAttachmentBusy(true);
    try {
      const { items, errors } = await prepareMessageAttachments(files, { existingCount: attachments.length });
      setAttachments((current) => [...current, ...items].slice(0, MAX_ATTACHMENTS));
      setAttachmentError(errors.join(" "));
    } finally {
      setAttachmentBusy(false);
      if (event.target) {
        event.target.value = "";
      }
    }
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    setAttachmentError("");
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

      <input
        ref={fileInputRef}
        type="file"
        className="composerHiddenInput"
        multiple
        onChange={attachFiles}
      />

      {attachments.length ? (
        <div className="composerAttachmentList" aria-live="polite">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="composerAttachmentCard">
              {attachment.previewUrl ? (
                <img className="composerAttachmentPreview" src={attachment.previewUrl} alt={attachment.name} />
              ) : (
                <div className="composerAttachmentPreview composerAttachmentPreviewFallback mono">
                  {getAttachmentLabel(attachment)}
                </div>
              )}
              <div className="composerAttachmentMeta">
                <div className="composerAttachmentName">{attachment.name}</div>
                <div className="composerAttachmentDetails mono">
                  {getAttachmentLabel(attachment)} · {attachment.sizeLabel}
                </div>
              </div>
              <button
                type="button"
                className="secondaryButton composerAttachmentRemove"
                onClick={() => removeAttachment(attachment.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {attachmentError ? <div className="composerAttachmentError">{attachmentError}</div> : null}

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
        <div className="composerButtonStack">
          <button
            type="button"
            className="secondaryButton composerButton"
            disabled={disabled || attachmentBusy || attachments.length >= MAX_ATTACHMENTS}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            {attachmentBusy ? "Preparing..." : "Attach files"}
          </button>
          <button
            type="submit"
            className="primaryButton composerButton"
            disabled={disabled || attachmentBusy || !canSend}
            onMouseDown={(event) => event.preventDefault()}
          >
            Send
          </button>
        </div>
      </div>
    </form>
  );
}
