interface Props {
  label: string;
  value: string;
  className?: string;
}

/** Single summary metric. Value pre-formatted by caller. */
export default function StatCard({ label, value, className }: Props) {
  return (
    <div className={`stat${className ? ` ${className}` : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
