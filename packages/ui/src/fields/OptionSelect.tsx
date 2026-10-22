import type { ComponentProps } from 'react';
import { NativeSelect } from '../components/native-select';
import { findOption, type OptionList, type OptionValue } from '../lib/options';

export type OptionSelectProps<V extends OptionValue> = Omit<
  ComponentProps<typeof NativeSelect>,
  'value' | 'defaultValue' | 'onChange' | 'children'
> & {
  readonly options: OptionList<V>;
  readonly value: V;
  readonly onValueChange: (value: V) => void;
};

/** A native select whose value round-trips through `String(value)` back to its typed option. */
export function OptionSelect<V extends OptionValue>({
  options,
  value,
  onValueChange,
  ...props
}: OptionSelectProps<V>) {
  return (
    <NativeSelect
      {...props}
      value={String(value)}
      onChange={(event) => {
        const option = findOption(options, event.target.value);
        if (option) onValueChange(option.value);
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  );
}
