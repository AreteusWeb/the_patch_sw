'use strict';
/**
 * Rules-based router (v0). Deliberately simple: no classifier yet.
 * mode: 'coach' | 'general' | 'auto'
 * NOTE: the existing coach system prompt refuses non-fitness topics, so the
 * 'general' route MUST use its own general-assistant system prompt.
 */
const HEALTH_RE = /(workout|training|train\b|recover|sleep|heart|hrv|\bhr\b|spo2|ecg|pain|injur|running|lift|calorie|protein|diet|fatigue|rest day|muscle|cardio|entren|dorm|sue[ñn]o|cansanc|lesi[oó]n|dolor|m[uú]sculo|corazon|coraz[oó]n|respiraci)/i;

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return String(messages[i].content || '');
  }
  return '';
}

function route({ mode = 'auto', messages = [] } = {}) {
  if (mode === 'coach') return { provider: 'gemini', tier: 'mid', reason: 'mode=coach' };
  if (mode === 'general') return { provider: 'openai', tier: 'economy', reason: 'mode=general' };
  if (HEALTH_RE.test(lastUserText(messages))) return { provider: 'gemini', tier: 'mid', reason: 'auto:health-keywords' };
  return { provider: 'openai', tier: 'economy', reason: 'auto:general' };
}

module.exports = { route };
