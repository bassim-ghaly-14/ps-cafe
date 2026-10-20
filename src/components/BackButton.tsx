import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  onClick: () => void;
  /** i18n key for the accessible label / visible text. Defaults to common.back. */
  labelKey?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Standardized back-navigation button for the PS-Cafe app.
 *
 * Visual (RTL Arabic): uses a right-pointing arrow (ArrowRight) because in
 * RTL layouts "back" travels toward the right-hand side of the screen.
 * The button keeps an LTR internal direction so the icon stays to the left of
 * the label regardless of the surrounding page direction.
 *
 * Styling: subtle secondary surface (var(--panel)) with a visible border
 * (var(--line)), contrasting text (var(--text)), and hover / focus-visible /
 * active / disabled states. Reuses existing theme tokens only.
 */
export default function BackButton({
  onClick,
  labelKey = "common.back",
  disabled,
  className,
}: Props) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      dir="ltr"
      className={`back-btn ${className ?? ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={t(labelKey)}
    >
      <ArrowRight size={16} aria-hidden />
      <span>{t(labelKey)}</span>
    </button>
  );
}
