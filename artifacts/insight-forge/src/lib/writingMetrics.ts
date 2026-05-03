// Pure client-side writing metrics. Used by the WritingMetrics panel in the
// drafting interface to give writers live readability + style feedback.
// No network calls, no AI — fast enough to recompute on every keystroke for
// section-sized prose.

// Strip markdown citation links [text](url) -> text so they don't pollute
// word counts or sentence parsing.
const stripCitations = (s: string) =>
  s.replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, "$1");

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;
const SENTENCE_SPLIT_RE = /[.!?]+(?:\s+|$)/;

const COMMON_JARGON = [
  "leverage",
  "synergy",
  "synergies",
  "utilize",
  "utilization",
  "paradigm",
  "ecosystem",
  "holistic",
  "robust",
  "seamless",
  "seamlessly",
  "cutting-edge",
  "best-in-class",
  "thought leader",
  "thought leadership",
  "low-hanging fruit",
  "circle back",
  "deep dive",
  "move the needle",
  "game changer",
  "game-changer",
  "value-add",
  "value add",
  "next-generation",
  "next generation",
  "world-class",
  "actionable insights",
  "mission-critical",
  "in today's",
  "in today’s",
  "delve",
  "delves",
  "delving",
  "tapestry",
  "navigate the complexities",
];

// Very rough syllable estimator. Good enough for Flesch-Kincaid trend lines,
// not a linguist's tool.
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const stripped = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export interface SentenceStat {
  text: string;
  words: number;
}

export interface JargonHit {
  phrase: string;
  count: number;
}

export interface WritingStats {
  words: number;
  sentences: number;
  characters: number;
  avgSentenceLen: number;
  longestSentence: SentenceStat | null;
  // Top 3 sentences over 25 words.
  longSentences: SentenceStat[];
  passiveVoiceCount: number;
  passiveVoicePct: number;
  fleschGrade: number;
  fleschReadingEase: number;
  readingTimeSec: number;
  jargon: JargonHit[];
  adverbCount: number;
}

// Detect simple passive constructions: "be"-form + past participle (-ed or
// known irregular). False positives happen ("the data was clean") but the
// trend signal is what matters to a writer.
const BE_FORMS = new Set([
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
]);

const IRREGULAR_PAST_PARTICIPLES = new Set([
  "made",
  "done",
  "said",
  "given",
  "taken",
  "seen",
  "known",
  "shown",
  "written",
  "found",
  "held",
  "told",
  "built",
  "bought",
  "brought",
  "caught",
  "chosen",
  "driven",
  "eaten",
  "felt",
  "got",
  "gotten",
  "heard",
  "kept",
  "led",
  "left",
  "lost",
  "meant",
  "met",
  "paid",
  "put",
  "read",
  "run",
  "sent",
  "set",
  "sold",
  "spent",
  "thought",
  "understood",
]);

function isPastParticiple(word: string) {
  const w = word.toLowerCase();
  if (IRREGULAR_PAST_PARTICIPLES.has(w)) return true;
  if (w.endsWith("ed") && w.length > 3) return true;
  return false;
}

function countPassive(sentence: string): number {
  const tokens = sentence.toLowerCase().match(WORD_RE) || [];
  let count = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (BE_FORMS.has(tokens[i])) {
      // allow optional adverb in between (e.g., "was clearly written")
      const next = tokens[i + 1];
      if (isPastParticiple(next)) {
        count++;
      } else if (next.endsWith("ly") && i + 2 < tokens.length && isPastParticiple(tokens[i + 2])) {
        count++;
      }
    }
  }
  return count;
}

export function computeWritingStats(raw: string): WritingStats {
  const text = stripCitations(raw || "").trim();
  if (!text) {
    return {
      words: 0,
      sentences: 0,
      characters: 0,
      avgSentenceLen: 0,
      longestSentence: null,
      longSentences: [],
      passiveVoiceCount: 0,
      passiveVoicePct: 0,
      fleschGrade: 0,
      fleschReadingEase: 0,
      readingTimeSec: 0,
      jargon: [],
      adverbCount: 0,
    };
  }

  const wordsArr: string[] = text.match(WORD_RE) ?? [];
  const words = wordsArr.length;
  const characters = text.length;

  const rawSentences = text
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const sentences = rawSentences.length || 1;

  const sentenceStats: SentenceStat[] = rawSentences.map((s) => ({
    text: s,
    words: (s.match(WORD_RE) || []).length,
  }));
  sentenceStats.sort((a, b) => b.words - a.words);
  const longestSentence = sentenceStats[0] || null;
  const longSentences = sentenceStats.filter((s) => s.words >= 25).slice(0, 3);

  let passiveVoiceCount = 0;
  for (const s of rawSentences) passiveVoiceCount += countPassive(s);
  const passiveVoicePct = sentences > 0 ? (passiveVoiceCount / sentences) * 100 : 0;

  // Flesch-Kincaid.
  const totalSyllables = wordsArr.reduce((sum, w) => sum + syllables(w), 0);
  const wordsPerSentence = words / sentences;
  const syllablesPerWord = words > 0 ? totalSyllables / words : 0;
  const fleschGrade =
    words > 0 ? 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59 : 0;
  const fleschReadingEase =
    words > 0 ? 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord : 0;

  const readingTimeSec = (words / 230) * 60; // 230 wpm average reading speed

  const lower = ` ${text.toLowerCase()} `;
  const jargon: JargonHit[] = [];
  for (const phrase of COMMON_JARGON) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const m = lower.match(re);
    if (m && m.length > 0) jargon.push({ phrase, count: m.length });
  }
  jargon.sort((a, b) => b.count - a.count);

  // Adverbs: -ly words, minus a small whitelist.
  const ADVERB_WHITELIST = new Set(["only", "early", "family", "supply", "apply", "reply", "rely", "rally"]);
  const adverbCount = wordsArr.filter((w) => {
    const lw = w.toLowerCase();
    return lw.endsWith("ly") && lw.length > 3 && !ADVERB_WHITELIST.has(lw);
  }).length;

  return {
    words,
    sentences,
    characters,
    avgSentenceLen: words / sentences,
    longestSentence,
    longSentences,
    passiveVoiceCount,
    passiveVoicePct,
    fleschGrade,
    fleschReadingEase,
    readingTimeSec,
    jargon,
    adverbCount,
  };
}

export function readingTimeLabel(sec: number): string {
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s read`;
  const m = sec / 60;
  if (m < 1.5) return "1 min read";
  return `${Math.round(m)} min read`;
}

export function gradeBand(grade: number): {
  label: string;
  tone: "verified" | "unverified" | "danger";
} {
  if (grade <= 9) return { label: "Easy", tone: "verified" };
  if (grade <= 13) return { label: "Plain", tone: "verified" };
  if (grade <= 16) return { label: "Dense", tone: "unverified" };
  return { label: "Heavy", tone: "danger" };
}

export function passiveBand(pct: number): "verified" | "unverified" | "danger" {
  if (pct <= 10) return "verified";
  if (pct <= 25) return "unverified";
  return "danger";
}
