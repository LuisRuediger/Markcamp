import { toLocalInputValue, type DateChoice } from './dateTime'
import { ptBR } from './i18n/pt-BR'

// The date link of the New site and Record screens (one component, so the two cannot drift).
// Closed means "now, at save time"; "alterar data e hora" opens a datetime-local input and
// "usar agora" closes it again. The parent keeps the choice and reads it with chosenInstant.

interface DateTimeFieldProps {
  value: DateChoice
  onChange: (next: DateChoice) => void
}

function DateTimeField({ value, onChange }: DateTimeFieldProps) {
  if (!value.open) {
    return (
      <button type="button" className="link-button" onClick={() => onChange({ open: true, max: toLocalInputValue(new Date()), value: '' })}>
        {ptBR.sites.changeDate}
      </button>
    )
  }
  return (
    <>
      <label>
        {ptBR.sites.dateLabel}
        {/* max = now when it was opened: occurredAt may not be in the future (ADR 0005, rule 2).
            The iOS picker ignores it; the command checks the date again before queueing. */}
        <input
          type="datetime-local"
          max={value.max}
          value={value.value}
          onChange={(event) => onChange({ ...value, value: event.target.value })}
        />
      </label>
      <button type="button" className="link-button" onClick={() => onChange({ open: false })}>
        {ptBR.sites.useNow}
      </button>
    </>
  )
}

export default DateTimeField
