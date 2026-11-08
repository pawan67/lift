/** A few readings as a line, for the rows of the measurements list. Plain SVG: there are fifteen of them. */

export function Sparkline({
  values,
  width = 72,
  height = 24,
  className,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return <div style={{ width, height }} className={className} aria-hidden />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const y = (value: number) => height - 2 - ((value - min) / span) * (height - 4);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const last = values[values.length - 1]!;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <polyline points={points} fill="none" stroke="var(--fg-3)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={y(last)} r={2.5} fill="var(--volt)" transform={`translate(-2.5 0)`} />
    </svg>
  );
}
