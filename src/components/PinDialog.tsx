import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  error: string | null;
  busy: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

/** PIN gate for Developer Mode. Masked numeric input, keyboard submit. */
export default function PinDialog({
  open,
  error,
  busy,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPin("");
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const submit = () => {
    if (busy) return;
    onSubmit(pin);
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={t("dev.pinTitle")}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{t("dev.pinTitle")}</h3>
        <p className="sub">{t("dev.pinBody")}</p>
        <label className="fld">
          <span>{t("dev.pinLabel")}</span>
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            maxLength={8}
            value={pin}
            disabled={busy}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            aria-label={t("dev.pinLabel")}
            aria-invalid={error ? true : undefined}
          />
        </label>
        {error && (
          <p className="notice err" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={submit}
          >
            {t("dev.pinConfirm")}
          </button>
          <button type="button" className="btn ghost" onClick={onCancel}>
            {t("settings.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
