import { RadioGroup, RadioGroupItem } from '../components/radio-group';
import { findOption, type OptionList, type OptionValue } from '../lib/options';

export interface OptionRadioGroupProps<V extends OptionValue> {
  readonly options: OptionList<V>;
  readonly value: V;
  readonly onValueChange: (value: V) => void;
  readonly 'aria-label': string;
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
}

/** Radio buttons over a closed set of values; each radio is named by its option label. */
export function OptionRadioGroup<V extends OptionValue>({
  options,
  value,
  onValueChange,
  ...props
}: OptionRadioGroupProps<V>) {
  return (
    <RadioGroup
      {...props}
      value={String(value)}
      onValueChange={(raw: unknown) => {
        const option = typeof raw === 'string' ? findOption(options, raw) : undefined;
        if (option) onValueChange(option.value);
      }}
    >
      {options.map((option) => (
        <label key={String(option.value)}>
          <RadioGroupItem value={String(option.value)} aria-label={option.label} />
          {option.label}
        </label>
      ))}
    </RadioGroup>
  );
}
