"""Shared report matching helpers."""
from datetime import datetime
import re


def _tokens(value):
    return {token for token in re.findall(r'[a-z0-9]+', (value or '').lower()) if len(token) > 2}


def match_percentage(missing_item, found_item):
    score = 0.0
    if missing_item.get('category') and found_item.get('category') and missing_item['category'].lower() == found_item['category'].lower():
        score += 30

    missing_location = (missing_item.get('last_location') or '').lower()
    found_location = (found_item.get('location') or '').lower()
    if missing_location and found_location:
        if missing_location == found_location:
            score += 25
        elif missing_location in found_location or found_location in missing_location:
            score += 18
        elif _tokens(missing_location) & _tokens(found_location):
            score += 10

    missing_date = missing_item.get('last_seen_date')
    found_date = found_item.get('found_date')
    if missing_date and found_date:
        try:
            days = abs((datetime.strptime(str(missing_date)[:10], '%Y-%m-%d') - datetime.strptime(str(found_date)[:10], '%Y-%m-%d')).days)
            score += 20 if days == 0 else 12 if days <= 2 else 6 if days <= 7 else 0
        except ValueError:
            pass

    missing_text = ' '.join([missing_item.get('item_name', ''), missing_item.get('description', ''), missing_item.get('distinctive_marks', '')])
    found_text = ' '.join([found_item.get('item_name', ''), found_item.get('description', '')])
    missing_tokens = _tokens(missing_text)
    found_tokens = _tokens(found_text)
    if missing_tokens and found_tokens:
        score += min(25, round(25 * len(missing_tokens & found_tokens) / len(missing_tokens), 1))

    return round(min(100, score), 1)


def build_match_summaries(missing_items, found_items):
    summaries = {}
    for item in missing_items:
        scores = [match_percentage(item, found) for found in found_items]
        summaries[item.get('mpost_id')] = {
            'matched_above_55': sum(score >= 55 for score in scores),
            'matched_below_54': sum(score < 55 for score in scores),
            'total_matches': len(scores),
        }
    return summaries


def build_found_match_summaries(found_items, missing_items):
    summaries = {}
    for item in found_items:
        scores = [match_percentage(missing, item) for missing in missing_items]
        summaries[item.get('fpost_id')] = {
            'matched_above_55': sum(score >= 55 for score in scores),
            'matched_below_54': sum(score < 55 for score in scores),
            'total_matches': len(scores),
        }
    return summaries