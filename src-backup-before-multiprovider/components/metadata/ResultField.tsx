"use client";

import { ToolIcon, type ToolIconName } from "./ToolIcons";

type ResultFieldProps = {
  id: string;
  label: string;
  tone: "violet" | "pink" | "blue" | "green";
  icon: ToolIconName;
  countLabel: string;
  footer: string;
  footerOver: boolean;
  value: string;
  draft: string;
  editing: boolean;
  rows: number;
  emptyHint: string;
  onCopy: () => void;
  onStartEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function ResultField({
  id,
  label,
  tone,
  icon,
  countLabel,
  footer,
  footerOver,
  value,
  draft,
  editing,
  rows,
  emptyHint,
  onCopy,
  onStartEdit,
  onDraftChange,
  onSave,
  onCancel,
}: ResultFieldProps) {
  return (
    <div className="mw-field">
      <div className="mw-field-head">
        <h3 className="mw-field-title">
          <span className="mw-field-icon" data-tone={tone}>
            <ToolIcon name={icon} size={14} />
          </span>
          <span>{label}</span>
          <span className="mw-field-count">({countLabel})</span>
        </h3>

        <div className="mw-field-actions">
          <button type="button" className="mw-mini" onClick={onCopy}>
            <ToolIcon name="copy" size={14} />
            Copy
          </button>
          {editing ? (
            <>
              <button type="button" className="mw-mini" data-primary="true" onClick={onSave}>
                <ToolIcon name="check" size={14} />
                Save
              </button>
              <button type="button" className="mw-mini" onClick={onCancel}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="mw-mini" onClick={onStartEdit}>
              <ToolIcon name="edit" size={14} />
              Edit
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <textarea
          id={id}
          className="mw-textarea"
          aria-label={label}
          rows={rows}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
        />
      ) : (
        <div className="mw-field-body" data-empty={value ? "false" : "true"}>
          {value || emptyHint}
        </div>
      )}

      <div className="mw-field-foot" data-over={footerOver ? "true" : "false"}>
        {footer}
      </div>
    </div>
  );
}