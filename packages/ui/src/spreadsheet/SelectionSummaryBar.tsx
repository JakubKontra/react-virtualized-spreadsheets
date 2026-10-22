import { assertNever, type SelectionSummary } from '@sheet/core';
import type { SelectionSummaryState } from '@sheet/react';

export interface SelectionSummaryBarProps {
  readonly summary: SelectionSummaryState;
  readonly number: Intl.NumberFormat;
}

export function SelectionSummaryBar({ summary, number }: SelectionSummaryBarProps) {
  return (
    <div className="selection-summary" aria-live="polite">
      <SummaryContent summary={summary} number={number} />
    </div>
  );
}

function SummaryContent({ summary, number }: SelectionSummaryBarProps) {
  switch (summary.status) {
    case 'idle':
      return null;
    case 'loading':
      return 'Calculating selection…';
    case 'error':
      return 'Selection summary unavailable';
    case 'ready':
      return <SummaryValues value={summary.value} number={number} />;
    default:
      return assertNever(summary, 'Unknown summary status');
  }
}

function SummaryValues({
  value,
  number,
}: {
  readonly value: SelectionSummary;
  readonly number: Intl.NumberFormat;
}) {
  const optional = (n: number | null) => (n === null ? '—' : number.format(n));
  return (
    <>
      <span>
        Count <strong>{number.format(value.count)}</strong>
      </span>
      <span>
        Sum <strong>{number.format(value.sum)}</strong>
      </span>
      <span>
        Average <strong>{optional(value.average)}</strong>
      </span>
      <span>
        Min <strong>{optional(value.min)}</strong>
      </span>
      <span>
        Max <strong>{optional(value.max)}</strong>
      </span>
    </>
  );
}
