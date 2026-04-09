import type { ComponentPropsWithoutRef } from 'react'

type ClearableInputProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'onChange' | 'type' | 'value'
> & {
  clearLabel: string
  onChange: (value: string) => void
  value: string
}

export function ClearableInput({
  className,
  clearLabel,
  onChange,
  value,
  ...props
}: ClearableInputProps) {
  return (
    <div className="clearable-input-shell">
      <input
        {...props}
        className={className}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
      {value ? (
        <button
          aria-label={clearLabel}
          className="clearable-input-button"
          onClick={() => onChange('')}
          onMouseDown={(event) => event.preventDefault()}
          type="button"
        >
          <span aria-hidden="true" className="clearable-input-glyph">
            ×
          </span>
        </button>
      ) : null}
    </div>
  )
}
