import { CalendarDays, ImagePlus, Palette, TextCursorInput, Users, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

export const SETUP_STEPS = [
  { id: 'details', label: 'Details', note: 'Name & venue', icon: TextCursorInput },
  { id: 'schedule', label: 'Schedule', note: 'Dates & recovery', icon: CalendarDays },
  { id: 'appearance', label: 'Appearance', note: 'Theme & colors', icon: Palette },
  { id: 'artwork', label: 'Artwork', note: 'Logo & cover', icon: ImagePlus },
  { id: 'team', label: 'Team', note: 'People & access', icon: Users },
  { id: 'review', label: 'Review', note: 'Readiness & state', icon: ShieldCheck },
] as const;
export type SetupStep = typeof SETUP_STEPS[number]['id'];

export default function EventSetupTabs({ value, onChange, disabled }: { value: SetupStep; onChange: (step: SetupStep) => void; disabled: boolean }) {
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = tabs.current;
    const active = document.getElementById(`event-step-${value}`);
    if (!bar || !active) return;
    const bounds = bar.getBoundingClientRect(), item = active.getBoundingClientRect();
    if (item.left < bounds.left) bar.scrollLeft -= bounds.left - item.left + 8;
    else if (item.right > bounds.right) bar.scrollLeft += item.right - bounds.right + 8;
  }, [value]);
  return <div ref={tabs} className="event-setup-tabs" role="tablist" aria-label="Event setup steps" onKeyDown={(event) => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = SETUP_STEPS.findIndex((step) => step.id === value);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? SETUP_STEPS.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + SETUP_STEPS.length) % SETUP_STEPS.length;
    const next = SETUP_STEPS[index].id;
    onChange(next);
    document.getElementById(`event-step-${next}`)?.focus();
  }}>{SETUP_STEPS.map((step, index) => {
    const Icon: LucideIcon = step.icon;
    return <button type="button" role="tab" id={`event-step-${step.id}`} aria-controls={`event-panel-${step.id}`} aria-selected={value === step.id} tabIndex={value === step.id ? 0 : -1} disabled={disabled} key={step.id} onClick={() => onChange(step.id)}><span className="event-step-icon"><Icon size={17} /></span><span className="event-step-text"><strong><span className="event-step-number">0{index + 1}</span>{step.label}</strong><small>{step.note}</small></span></button>;
  })}</div>;
}
