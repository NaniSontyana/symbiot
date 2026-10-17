/**
 * Interviewer turn detection.
 *
 * The ASR service sends one final transcript per utterance (on the model's
 * end-of-utterance token). An interviewer question often spans several
 * utterances ("Okay, next topic." ... "How would you shard a Postgres table?"),
 * so this module joins them into a single interviewer *turn* and hands the
 * complete turn to the AI exactly once.
 *
 * A turn is complete when:
 *   - the interviewer has been silent for `turnGapMs` after their last final
 *     (a little longer if the text ends in a dangling word like "and"/"the"), or
 *   - the applicant starts answering (a real answer, not "yeah"/"okay"), or
 *   - the turn has run for `maxTurnMs`.
 *
 * Applicant speech is never sent to the AI.
 */

const BACKCHANNEL_WORDS = new Set([
  'yeah', 'yes', 'yep', 'yup', 'ok', 'okay', 'mm', 'mhm', 'mmhmm', 'hmm', 'uh', 'um', 'huh',
  'right', 'sure', 'alright', 'got', 'it', 'i', 'see', 'cool', 'great', 'nice', 'fine',
  'true', 'exactly', 'correct', 'sounds', 'good', 'oh', 'ah', 'thanks', 'thank', 'you',
]);

const DANGLING_ENDINGS = [
  'and', 'or', 'with', 'for', 'in', 'of', 'to', 'about', 'like', 'such as', 'between',
  'versus', 'compared to', 'using', 'when', 'if', 'how', 'what', 'why', 'where', 'which',
  'is', 'are', 'was', 'were', 'be', 'the', 'a', 'an', 'so', 'but', 'because', 'kind of',
  'type of', 'sort of', 'going to',
];

function words(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export function isBackchannel(text) {
  const w = words(text);
  return w.length > 0 && w.length <= 4 && w.every((x) => BACKCHANNEL_WORDS.has(x));
}

export function endsWithDanglingWord(text) {
  const w = words(text);
  if (w.length === 0) return false;
  const last = w[w.length - 1];
  const lastTwo = w.slice(-2).join(' ');
  return DANGLING_ENDINGS.includes(last) || DANGLING_ENDINGS.includes(lastTwo);
}

/**
 * A finished utterance ending in a question mark is an unambiguous completion
 * signal — the interviewer is not about to continue, so the turn can be
 * flushed almost immediately instead of waiting for the full pause gap.
 */
export function endsWithQuestionMark(text) {
  return /\?\s*$/.test(text || '');
}

export function createTurnManager({
  onInterviewerTurn,
  turnGapMs = 650,           // pause that closes an interviewer turn (was 900)
  questionFastFlushMs = 200, // fast path when the utterance ended with '?'
  danglingExtraMs = 1200,
  partialStallMs = 4000,
  maxTurnMs = 60000,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let segments = [];
  let interviewerSpeaking = false;
  let turnStartedAt = null;
  let extended = false;
  let timer = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const reset = () => {
    cancel();
    segments = [];
    interviewerSpeaking = false;
    turnStartedAt = null;
    extended = false;
  };

  const flush = (reason) => {
    const text = segments.join(' ').replace(/\s+/g, ' ').trim();
    reset();
    if (text && onInterviewerTurn) onInterviewerTurn(text, { reason });
  };

  const schedule = (ms, fn) => {
    cancel();
    timer = setTimer(() => {
      timer = null;
      fn();
    }, ms);
  };

  const onPause = () => {
    if (segments.length === 0) return;
    if (!extended && endsWithDanglingWord(segments[segments.length - 1])) {
      extended = true; // interviewer probably paused mid-sentence; give them a bit longer
      schedule(danglingExtraMs, onPause);
      return;
    }
    flush('pause');
  };

  const handleInterviewer = (text, isFinal) => {
    if (!isFinal) {
      interviewerSpeaking = true;
      // Still talking: hold the turn open. The stall timer only matters if a final never arrives.
      if (segments.length > 0) schedule(partialStallMs, () => flush('stalled'));
      return;
    }
    interviewerSpeaking = false;
    if (text) {
      if (turnStartedAt === null) turnStartedAt = now();
      segments.push(text);
    }
    if (segments.length === 0) return;
    if (now() - turnStartedAt >= maxTurnMs) {
      flush('max_length');
      return;
    }
    // Latency fast path: a completed question mark means the interviewer finished
    // asking — flush after a very short settle window instead of the full pause
    // gap. If the interviewer immediately adds a follow-up utterance, the new
    // final replaces this timer and the segments merge as usual.
    if (endsWithQuestionMark(segments[segments.length - 1])) {
      schedule(questionFastFlushMs, () => flush('question_complete'));
      return;
    }
    schedule(turnGapMs, onPause);
  };

  const handleApplicant = (text) => {
    if (segments.length === 0 || !text) return;
    if (interviewerSpeaking) return; // talking over the interviewer: backchannel or leftover echo
    if (isBackchannel(text)) return;
    flush('applicant_started');
  };

  return {
    /** Feed every ASR result: { speaker: 'interviewer' | 'applicant', text, isFinal }. */
    handleTranscript({ speaker, text, isFinal }) {
      const clean = (text || '').trim();
      if (speaker === 'applicant') handleApplicant(clean);
      else handleInterviewer(clean, !!isFinal);
    },
    /** Send whatever the interviewer has said so far right now. */
    flushNow() {
      if (segments.length > 0) flush('manual');
    },
    reset,
    getPendingText: () => segments.join(' ').trim(),
    isInterviewerSpeaking: () => interviewerSpeaking,
    dispose: reset,
  };
}
