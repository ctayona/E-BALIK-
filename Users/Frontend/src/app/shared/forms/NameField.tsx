import { useId } from 'react';
import { CX } from '../../utils/clay';
import { FieldHint, INVALID_FIELD, useFieldHint, type TextRule } from './FieldHint';

/** A first, middle or last name input with the inline hint (letters, spaces, hyphens and apostrophes only). */
export default function NameField({
  label,
  value,
  onChange,
  placeholder,
  required = true,
  forceShow = false,
  inputClass = `${CX.input} w-full`,
  labelClass = 'text-[12px] font-bold text-navy-800',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  forceShow?: boolean;
  inputClass?: string;
  labelClass?: string;
}) {
  const id = useId();
  const rule: TextRule = { kind: 'name', label: label.toLowerCase(), required };
  const hint = useFieldHint(value, rule, forceShow);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={hint.onBlur}
        placeholder={placeholder}
        required={required}
        maxLength={60}
        autoComplete="off"
        aria-invalid={hint.invalid}
        aria-describedby={hint.invalid ? `${id}-hint` : undefined}
        className={`${inputClass} ${hint.invalid ? INVALID_FIELD : ''}`}
      />
      <FieldHint id={`${id}-hint`} message={hint.message} />
    </div>
  );
}
