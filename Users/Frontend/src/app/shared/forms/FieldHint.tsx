import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { textProblemInfo, type TextKind } from '../../utils/textGuard';

export type TextRule = { kind: TextKind; label?: string; required?: boolean };

/**
 * The inline hint for one text field. The message appears once the person leaves the field, or as soon as what they typed looks like
 * random typing, a name with numbers in it and so on. "Too short" is not shown while they are still writing, and `forceShow` (set after a
 * failed submit) shows every hint at once.
 */
export function useFieldHint(value: string, rule?: TextRule, forceShow = false) {
  const [left, setLeft] = useState(false);
  const problem = rule ? textProblemInfo(value, rule.kind, rule.label, rule.required ?? true) : null;
  const typing = value.trim().length > 0 && problem !== null && problem.code !== 'short' && problem.code !== 'empty';
  const message = problem && (forceShow || left || typing) ? problem.message : '';
  return { message, invalid: Boolean(message), onBlur: () => setLeft(true) };
}

export function FieldHint({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" aria-live="polite" className={`mt-1.5 flex items-start gap-1.5 text-[13px] leading-5 text-rose-700 ${message ? '' : 'hidden'}`}>
      {message && <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span>{message}</span>
    </p>
  );
}

/** Border colour for a field that failed its check; the normal focus ring stays. */
export const INVALID_FIELD = '!border-rose-500 focus:!shadow-[0_0_0_3px_rgba(225,29,72,0.15)]';

/** After a failed submit: bring the first field that shows a hint into view and put the cursor in it. */
export function focusFirstInvalid() {
  window.requestAnimationFrame(() => {
    const field = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!field) return;
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field.focus({ preventScroll: true });
  });
}
