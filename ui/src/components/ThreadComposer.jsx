import { useState } from "react";

export default function ThreadComposer({ disabled, onSend }) {
  const [text, setText] = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    const next = text.trim();
    if (!next || disabled) return;
    await onSend?.(next);
    setText("");
  };

  return (
    <form className="threadComposer" onSubmit={submit}>
      <textarea
        value={text}
        className="threadInput"
        rows={2}
        placeholder="Add next prompt for this thread"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button className="actionButton" disabled={disabled || !text.trim()}>
        Send
      </button>
    </form>
  );
}
