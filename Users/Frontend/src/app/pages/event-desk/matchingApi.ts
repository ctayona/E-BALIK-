import { json, type EventReport } from './eventApi';

export type MatchReport = Pick<EventReport, 'report_id' | 'event_id' | 'reference' | 'kind' | 'item_name' | 'category' | 'venue' | 'occurred_at' | 'moderation_status' | 'received_at' | 'released_at' | 'version'>;
export interface EventMatch {
  report: MatchReport; score: number;
  components: Record<'category' | 'text' | 'image' | 'location' | 'date', { percent: number; weight: number } | null>;
  reasons: string[]; conflicts: string[];
  alert_status?: 'active' | 'inactive' | null;
}
export interface EventMatchResult { source: MatchReport; matches: EventMatch[]; offset: number; scanned: number; compared: number; has_more: boolean; scan_limit: number; result_limit: number; minimum_score: number; alerts_available?: boolean }
export const eventMatches = (event: string, report: string, offset = 0, signal?: AbortSignal) => json<EventMatchResult>(`/${encodeURIComponent(event)}/reports/${encodeURIComponent(report)}/matches?offset=${offset}`, { signal });
