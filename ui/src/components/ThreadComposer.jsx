import { useEffect, useRef, useState } from "react";
import { MAX_ATTACHMENTS, prepareMessageAttachments } from "../utils/messageAttachments";
import { formatLlmProfileOption } from "../utils/llmProfiles";
import DisclosureButton from "./ui/DisclosureButton";
import StateNotice from "./ui/StateNotice";

function getAttachmentLabel(attachment) {
  if (attachment.kind === "image") return "image";
  if (attachment.kind === "text") return "text";
  return "file";
}

function getMemoryLabel(memoryMode) {
  if (memoryMode === "manual") return "Manual memory";
  if (memoryMode === "off") return "Memory off";
  return "Automatic memory";
}

export default function ThreadComposer({
  disabled,
  onSend,
  llmProfiles,
  currentLlmProfileId,
  currentMemoryMode
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [llmProfileId, setLlmProfileId] = useState(currentLlmProfileId || "");
  const [memoryMode, setMemoryMode] = useState(currentMemoryMode || "auto");
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [runSettingsOpen, setRunSettingsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const canSend = Boolean(text.trim() || attachments.length);
  const selectedProfile = (llmProfiles || []).find((profile) => profile.id === llmProfileId);
  const settingsSummary = `${selectedProfile?.label || selectedProfile?.backend || "Server default"} · ${getMemoryLabel(memoryMode)}`;

  useEffect(() => {
    setLlmProfileId(currentLlmProfileId || "");
  }, [currentLlmProfileId]);

  useEffect(() => {
    if (!llmProfiles?.length || !llmProfileId) return;
    if (!llmProfiles.some((profile) => profile.id === llmProfileId)) {
      setLlmProfileId(llmProfiles[0].id);
    }
  }, [llmProfileId, llmProfiles]);

  useEffect(() => {
    setMemoryMode(currentMemoryMode || "auto");
  }, [currentMemoryMode]);

  const submit = async (event) => {
    event?.preventDefault?.();
    if (!canSend || disabled || attachmentBusy || sending) return;

    const prompt = text.trim();
    const content = attachments.flatMap((attachment) => attachment.blocks || []);
    setSending(true);
    setSendError("");
    try {
      await onSend?.({
        prompt,
        ...(content.length ? { content } : {}),
        ...(llmProfileId ? { llmProfileId } : {}),
        memoryMode
      });
      setText("");
      setAttachments([]);
      setAttachmentError("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      textareaRef.current?.focus({ preventScroll: true });
    } catch (error) {
      setSendError(error?.message || "Unable to send this follow-up");
    } finally {
      setSending(false);
    }
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
      <div className="composerSettingsBar">
        <div className="composerSettingsCopy">
          <span className="composerSettingsLabel">Follow-up settings</span>
          <span className="composerSettingsSummary mono">{settingsSummary}</span>
        </div>
        <DisclosureButton
          className="secondaryButton composerSettingsButton"
          expanded={runSettingsOpen}
          controls="thread-run-settings"
          label={runSettingsOpen ? "Hide follow-up run settings" : "Review follow-up run settings"}
          onClick={() => setRunSettingsOpen((value) => !value)}
        >
          {runSettingsOpen ? "Done" : "Change"}
        </DisclosureButton>
      </div>

      {runSettingsOpen ? (
        <div id="thread-run-settings" className="composerSettingsGrid">
          <label className="workflowField composerInlineField">
            <span className="workflowFieldLabel">Backend profile</span>
            <select className="consoleInput" value={llmProfileId} onChange={(event) => setLlmProfileId(event.target.value)}>
              {(llmProfiles || []).map((profile) => (
                <option key={profile.id} value={profile.id} disabled={profile.ready === false}>
                  {formatLlmProfileOption(profile)}
                </option>
              ))}
            </select>
          </label>
          <label className="workflowField composerInlineField">
            <span className="workflowFieldLabel">Memory</span>
            <select className="consoleInput" value={memoryMode} onChange={(event) => setMemoryMode(event.target.value)}>
              <option value="auto">Auto</option>
              <option value="manual">Manual tools only</option>
              <option value="off">Off</option>
            </select>
          </label>
        </div>
      ) : null}

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

      {sendError ? (
        <StateNotice
          tone="danger"
          title="Message not sent"
          detail={sendError}
          actionLabel="Retry message"
          onAction={() => submit()}
          busy={sending}
          compact
        />
      ) : null}

      <div className="composerInputRow">
        <textarea
          ref={textareaRef}
          value={text}
          className="composerTextarea"
          rows={2}
          aria-label="Follow-up message"
          placeholder="Continue the thread…"
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
            disabled={disabled || sending || attachmentBusy || attachments.length >= MAX_ATTACHMENTS}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            {attachmentBusy ? "Preparing…" : "Attach"}
          </button>
          <button
            type="submit"
            className="primaryButton composerButton"
            disabled={disabled || sending || attachmentBusy || !canSend}
            onMouseDown={(event) => event.preventDefault()}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </form>
  );
}
