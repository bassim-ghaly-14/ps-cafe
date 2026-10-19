interface Props {
  label: string;
  value: string;
}

/** Single summary metric. Value pre-formatted by caller. */
export default function StatCard({ label, value }: Props) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
