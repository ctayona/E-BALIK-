import { useId, useState } from "react";
import { FieldHint, INVALID_FIELD } from "@/app/shared/forms/FieldHint";
import { CX } from "@/app/utils/clay";
import { campusToday, earliestReportDate, reportDateProblem } from "@/app/utils/reportDates";

/**
 * The date of a lost or found report. The picker cannot go past today or more than a year back, and a typed date that breaks
 * the rule shows its reason under the field as soon as the person leaves it (or after a failed submit, with `forceShow`).
 */
export default function DateField({ label, ruleLabel, value, onChange, icon, required = false, forceShow = false }: {
  label: string;
  /** How the rule names the date in its message, for example "date found". */
  ruleLabel: string;
  value: string;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  required?: boolean;
  forceShow?: boolean;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const problem = (touched || forceShow) && (value || required) ? reportDateProblem(value, ruleLabel) : "";
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[14px] font-semibold text-ink-soft">
        {icon && <span className="text-gold-600" aria-hidden="true">{icon}</span>}
        {label}
        {required && <span className="text-rose-600" aria-hidden="true">*</span>}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        min={earliestReportDate()}
        max={campusToday()}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
        required={required}
        aria-invalid={Boolean(problem)}
        aria-describedby={problem ? `${id}-hint` : undefined}
        className={`${CX.input} w-full ${problem ? INVALID_FIELD : ""}`}
      />
      <FieldHint id={`${id}-hint`} message={problem} />
    </div>
  );
}
