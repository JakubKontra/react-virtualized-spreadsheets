import { useState, type ComponentProps } from 'react';
import { Input } from '../components/input';
import { parseIntInput } from '../lib/parse';

export type IntegerInputProps = Omit<
  ComponentProps<typeof Input>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'
> & {
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  /** Whole number inside `[min, max]`, or `null` while the text is not one. */
  readonly onValueChange: (value: number | null) => void;
};

/** A number input that keeps the typed text and reports it parsed. */
export function IntegerInput({
  defaultValue,
  min,
  max,
  onValueChange,
  ...props
}: IntegerInputProps) {
  const [text, setText] = useState(() => String(defaultValue));
  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      value={text}
      aria-invalid={parseIntInput(text, { min, max }) === null || undefined}
      onChange={(event) => {
        setText(event.target.value);
        onValueChange(parseIntInput(event.target.value, { min, max }));
      }}
    />
  );
}
