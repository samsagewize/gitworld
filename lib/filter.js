// Basic chat filter: length cap, link stripping, repeated-character collapse, and profanity masking.
import { clean } from './guard';

const BAD = ['fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'slut', 'whore', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'rape', 'kys', 'wank', 'twat', 'porn', 'nazi', 'kike', 'spic', 'chink', 'tranny'];
const LEET = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b' };
const fold = w => w.toLowerCase().split('').map(c => LEET[c] || c).join('').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
const BADF = BAD.map(fold);
const INFIX = ['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'bitch', 'whore', 'asshole'].map(fold); // also caught inside longer words

export function filterChat(raw) {
  let s = clean(raw, 300);
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]').replace(/\b[a-z0-9-]+\.(?:com|net|org|io|xyz|ru|gg|co|app|dev|me|ly|link|click|top)\b\S*/gi, '[link]');
  s = s.replace(/(.)\1{3,}/g, '$1$1$1');
  s = s.split(' ').map(w => { const f = fold(w); return f && (BADF.includes(f) || INFIX.some(b => f.includes(b))) ? '*'.repeat(Math.min(6, Math.max(3, w.length))) : w; }).join(' ');
  s = s.slice(0, 120).trim();
  return s;
}
// mostly-symbol or mostly-caps walls of text count as spam
export function looksSpammy(s) {
  if (!s) return true;
  const letters = s.replace(/[^A-Za-z]/g, ''); if (letters.length > 20 && letters === letters.toUpperCase()) return true;
  return false;
}
