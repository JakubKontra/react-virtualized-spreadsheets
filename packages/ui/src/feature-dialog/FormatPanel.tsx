import { useState } from 'react';
import {
  CELL_KINDS,
  DEFAULT_CURRENCY,
  DEFAULT_DECIMALS,
  decimalsOf,
  isNumericKind,
  withColumnKind,
  type ColumnOptions,
  type ConditionalRule,
} from '@sheet/core';
import { Button } from '../components/button';
import { Textarea } from '../components/textarea';
import { IntegerInput } from '../fields/IntegerInput';
import { OptionSelect } from '../fields/OptionSelect';
import { viewColumnLetter } from '../lib/column-labels';
import { CURRENCIES } from '../lib/labels';
import { optionsFromValues } from '../lib/options';
import { withChoices, withCurrency, withDecimals } from './column-format';
import { ConditionalRules } from './ConditionalRules';
import type { ViewPanelProps } from './types';
import { useSettingsForm } from './use-settings-form';

const KIND_OPTIONS = optionsFromValues(CELL_KINDS);
const CURRENCY_OPTIONS = optionsFromValues(CURRENCIES);
const MAX_DECIMALS = 10;
const AUTO: ColumnOptions = { kind: 'auto' };

export function FormatPanel({ store, view, close }: ViewPanelProps) {
  const settings = view.getSnapshot();
  const col = view.columns.canonicalAt(store.getSnapshot().active.col);
  const [option, setOption] = useState<ColumnOptions>(() => settings.columnOptions?.[col] ?? AUTO);
  const [decimalsValid, setDecimalsValid] = useState(true);
  const [rules, setRules] = useState<readonly ConditionalRule[]>(
    () => settings.conditionalRules?.filter((rule) => rule.col === col) ?? [],
  );
  const form = useSettingsForm(close);
  return (
    <form
      onSubmit={form.submit(() => {
        if (isNumericKind(option.kind) && !decimalsValid)
          throw new Error(`Use 0 to ${MAX_DECIMALS} decimal places`);
        store.configure({
          columnOptions: { ...settings.columnOptions, [col]: option },
          conditionalRules: [
            ...(settings.conditionalRules?.filter((rule) => rule.col !== col) ?? []),
            ...rules,
          ],
        });
      })}
    >
      <p>Column {viewColumnLetter(view, col)} · applies to all rows</p>
      <label className="stack-field">
        Cell type
        <OptionSelect
          autoFocus
          options={KIND_OPTIONS}
          value={option.kind}
          onValueChange={(kind) => setOption(withColumnKind(option, kind))}
        />
      </label>
      {isNumericKind(option.kind) && (
        <label className="stack-field">
          Decimal places
          <IntegerInput
            min={0}
            max={MAX_DECIMALS}
            defaultValue={decimalsOf(option) ?? DEFAULT_DECIMALS}
            onValueChange={(decimals) => {
              setDecimalsValid(decimals !== null);
              if (decimals !== null) setOption(withDecimals(option, decimals));
            }}
          />
        </label>
      )}
      {option.kind === 'currency' && (
        <label className="stack-field">
          Currency
          <OptionSelect
            options={CURRENCY_OPTIONS}
            value={option.currency ?? DEFAULT_CURRENCY}
            onValueChange={(currency) => setOption(withCurrency(option, currency))}
          />
        </label>
      )}
      {option.kind === 'select' && (
        <label className="stack-field">
          Choices (one per line)
          <Textarea
            value={option.options.join('\n')}
            onChange={(event) => setOption(withChoices(option, event.target.value))}
          />
        </label>
      )}
      <ConditionalRules col={col} rules={rules} onChange={setRules} />
      <p className="settings-note">
        The first matching rule wins. Types validate new inputs; existing values are preserved.
      </p>
      {form.error && <p role="alert">{form.error}</p>}
      <div className="dialog-actions">
        <Button variant="default" type="submit">
          Apply format
        </Button>
      </div>
    </form>
  );
}
