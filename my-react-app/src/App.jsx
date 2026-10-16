import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import AudioVisualizer from './components/AudioVisualizer';
import CopilotAnswerCard from './components/CopilotAnswerCard';
import CandidateContextModal from './components/CandidateContextModal';
import DesktopScreenModal from './components/DesktopScreenModal';
import FloatingPoint from './components/FloatingPoint';
import AuthScreen from './components/AuthScreen';
import { useAudioStreamer } from './hooks/useAudioStreamer';
import { createTurnManager } from './lib/turnManager';
import { DEFAULT_MODEL } from './lib/models';
import { copilotWsUrl, asrWsUrl } from './lib/api';
import { Send, Play, HelpCircle, RefreshCw, Sparkles } from 'lucide-react';

const SIMILAR_QUESTION_BANKS = {
  react: [
    "How does React reconciliation and virtual DOM diffing work under the hood?",
    "When would you choose Zustand or Context API over Redux Toolkit?",
    "How do you prevent unnecessary component re-renders in large React applications?",
    "What is the practical difference between useMemo and useCallback hooks?"
  ],
  database: [
    "How do HNSW and IVFFlat vector indexes differ for pgvector search?",
    "How do you diagnose and optimize slow SQL queries using EXPLAIN ANALYZE?",
    "What are the main trade-offs of database connection pooling with PgBouncer?",
    "How do you ensure ACID transaction safety under high concurrency?"
  ],
  websocket: [
    "How do WebSockets handle reconnection and heartbeat ping-pong under network drops?",
    "What is the difference between WebSockets and Server-Sent Events (SSE)?",
    "How do you scale WebSocket microservices horizontally behind a load balancer?",
    "How do you handle channel authentication and security in WebSocket connections?"
  ],
  python: [
    "How does FastAPI achieve asynchronous non-blocking performance with Python asyncio?",
    "How do you manage background task queues and worker pools in FastAPI?",
    "What is the difference between sync and async database drivers in Python?",
    "How do you optimize memory consumption when processing large datasets in Python?"
  ],
  system_design: [
    "How would you design a rate-limiting middleware for high-traffic REST APIs?",
    "What strategies do you use for database partitioning and horizontal sharding?",
    "How do you design a resilient caching layer using Redis to prevent cache stampedes?",
    "What is the difference between monolithic and event-driven microservice architectures?"
  ],
  general: [
    "Tell me about a complex project where you handled real-time data streaming.",
    "How do WebSockets differ from HTTP long-polling in terms of latency and server load?",
    "What is the difference between SQL and NoSQL databases for high-scale applications?",
    "Explain how pgvector and HNSW indexes work for AI document retrieval."
  ]
};

function getTopicSimilarQuestions(activeQ = '', context = '') {
  const combined = (activeQ + ' ' + context).toLowerCase();

  const tailoredQuestions = [];

  // Match candidate resume & JD skills dynamically
  if (/react|jsx|component|state|frontend/i.test(combined)) {
    tailoredQuestions.push(...SIMILAR_QUESTION_BANKS.react);
  }
  if (/postgres|sql|database|vector|pgvector|hsnw|db/i.test(combined)) {
    tailoredQuestions.push(...SIMILAR_QUESTION_BANKS.database);
  }
  if (/websocket|socket|real-time|realtime|stream|audio/i.test(combined)) {
    tailoredQuestions.push(...SIMILAR_QUESTION_BANKS.websocket);
  }
  if (/python|fastapi|django|flask|backend|asr/i.test(combined)) {
    tailoredQuestions.push(...SIMILAR_QUESTION_BANKS.python);
  }
  if (/design|system|architecture|microservice|distributed/i.test(combined)) {
    tailoredQuestions.push(...SIMILAR_QUESTION_BANKS.system_design);
  }

  // Deduplicate and ensure 4 questions are available
  const uniqueQuestions = Array.from(new Set(tailoredQuestions));

  if (uniqueQuestions.length < 4) {
    for (const gq of SIMILAR_QUESTION_BANKS.general) {
      if (!uniqueQuestions.includes(gq)) {
        uniqueQuestions.push(gq);
      }
    }
  }

  return uniqueQuestions.slice(0, 4);
}

const DEMO_USER = {
  id: '00000000-0000-0000-0000-000000000000',
  username: 'demo_candidate',
  email: 'candidate@symbiot.ai',
  demo: true,
};

function loadStoredUser() {
  try {
    const raw = localStorage.getItem('symbiot_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(loadStoredUser);
  const [authDismissed, setAuthDismissed] = useState(
    () => !!loadStoredUser() || localStorage.getItem('symbiot_auth_dismissed') === '1'
  );
  const [isConnected, setIsConnected] = useState(false);
  const [stealthMode, setStealthMode] = useState(true);
  const [clickThrough, setClickThrough] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(0.85);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);

  const [displaysList, setDisplaysList] = useState([]);
  const [activeDisplayIndex, setActiveDisplayIndex] = useState(0);

  // Fetch displays from Electron on load and listen for display switch events
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getDisplays) {
      window.electronAPI.getDisplays().then((displays) => {
        if (displays && displays.length) {
          setDisplaysList(displays);
        }
      }).catch(() => {});
    }

    if (window.electronAPI && window.electronAPI.onDisplaySwitched) {
      const unsubDisplay = window.electronAPI.onDisplaySwitched((data) => {
        if (data && typeof data.index === 'number') {
          setActiveDisplayIndex(data.index);
        }
      });
      return unsubDisplay;
    }
  }, []);

  // Subscribe to Electron global hotkeys (Alt+S, Alt+C, Alt+H)
  useEffect(() => {
    if (window.electronAPI) {
      const unsubStealth = window.electronAPI.onHotkeyToggleStealth ? window.electronAPI.onHotkeyToggleStealth((isStealth) => {
        setStealthMode(isStealth);
      }) : null;

      const unsubClickThrough = window.electronAPI.onHotkeyToggleClickThrough ? window.electronAPI.onHotkeyToggleClickThrough((isClickThrough) => {
        setClickThrough(isClickThrough);
      }) : null;

      return () => {
        if (unsubStealth) unsubStealth();
        if (unsubClickThrough) unsubClickThrough();
      };
    }
  }, []);

  // Web fallback hotkey listener (Alt+D to open Screen Selector)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        setIsScreenModalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Candidate API Key & Resume Context state
  const [apiKey, setApiKey] = useState(localStorage.getItem('symbiot_gemini_key') || '');
  const [candidateContext, setCandidateContext] = useState(
    localStorage.getItem('symbiot_resume_context') ||
    'Experienced Full-Stack Engineer specializing in Node.js microservices, WebSockets, PostgreSQL pgvector, and React UIs.'
  );

  const [customQuestion, setCustomQuestion] = useState('');
  const [activeQuestion, setActiveQuestion] = useState('');
  const [responseText, setResponseText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  // Real measured time-to-first-token; shown live in the answer card badge
  const [latencyMs, setLatencyMs] = useState(null);

  // Streaming token buffer: WebSocket deltas are appended here and flushed to
  // React state at ~20 FPS, so hundreds of tokens/s never re-render per token.
  const tokenBufferRef = useRef('');
  const tokenFlushTimerRef = useRef(null);
  const questionSentAtRef = useRef(0); // performance.now() when question was dispatched
  const firstTokenSeenRef = useRef(false);

  const flushTokenBuffer = useCallback(() => {
    tokenFlushTimerRef.current = null;
    if (!tokenBufferRef.current) return;
    const chunk = tokenBufferRef.current;
    tokenBufferRef.current = '';
    setResponseText((prev) => prev + chunk);
  }, []);

  const scheduleTokenFlush = useCallback(() => {
    if (tokenFlushTimerRef.current === null) {
      tokenFlushTimerRef.current = setTimeout(flushTokenBuffer, 50);
    }
  }, [flushTokenBuffer]);
  const [conversationHistory, setConversationHistory] = useState([]);
  // Rotating question-bank seed: each "Generate Similar" press cycles the bank
  // merged with the topic-tailored suggestions derived from the active question.
  const [questionBankSeed, setQuestionBankSeed] = useState(0);

  const similarQuestions = React.useMemo(() => {
    const tailored = getTopicSimilarQuestions(activeQuestion, candidateContext);
    const categories = Object.keys(SIMILAR_QUESTION_BANKS);
    const bank = SIMILAR_QUESTION_BANKS[categories[questionBankSeed % categories.length]];
    return Array.from(new Set([...tailored, ...bank])).slice(0, 4);
  }, [activeQuestion, candidateContext, questionBankSeed]);

  const handleRefreshSimilarQuestions = () => {
    setQuestionBankSeed((seed) => seed + 1);
  };

  // ---------------------------------------------------------------- auth
  const handleAuthSuccess = ({ user, token }) => {
    setCurrentUser(user);
    setAuthDismissed(true);
    localStorage.setItem('symbiot_user', JSON.stringify(user));
    if (token) localStorage.setItem('symbiot_token', token);
    localStorage.removeItem('symbiot_auth_dismissed');
  };

  const handleContinueAsDemo = () => {
    setCurrentUser(DEMO_USER);
    setAuthDismissed(true);
    localStorage.setItem('symbiot_auth_dismissed', '1');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthDismissed(false);
    localStorage.removeItem('symbiot_user');
    localStorage.removeItem('symbiot_token');
    localStorage.removeItem('symbiot_auth_dismissed');
  };

  const socketRef = useRef(null);

  // Notify Electron of window resize when collapsing/expanding
  const handleToggleCollapse = useCallback((collapsedState) => {
    setIsCollapsed(collapsedState);
    if (window.electronAPI && window.electronAPI.resizeWindow) {
      window.electronAPI.resizeWindow({ isCollapsed: collapsedState, stealthMode });
    }
  }, [stealthMode]);

  // Close or exit the application
  const handleExitApp = () => {
    if (window.electronAPI && window.electronAPI.closeApp) {
      window.electronAPI.closeApp();
    } else {
      window.close();
    }
  };

  const switchSpeakerRef = useRef(null);

  // Trigger real-time question generation to Copilot engine
  // source: 'interviewer' for detected interviewer turns, 'manual' for typed questions
  const handleAskQuestion = useCallback((questionStr, source = 'manual') => {
    const query = (typeof questionStr === 'string' && questionStr.trim()) ? questionStr.trim() : customQuestion.trim();
    if (!query) return;

    if (isCollapsed) {
      handleToggleCollapse(false);
    }

    const newItemId = Date.now();

    questionSentAtRef.current = performance.now();
    firstTokenSeenRef.current = false;
    tokenBufferRef.current = '';

    setActiveQuestion(query);
    setResponseText('');
    setIsGenerating(true);
    setLatencyMs(null);

    setConversationHistory((prev) => [
      ...prev,
      {
        id: newItemId,
        question: query,
        answer: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        isGenerating: true,
        latencyMs: null,
        totalMs: null,
        selectedModel: selectedModel || DEFAULT_MODEL,
      }
    ]);

    const payload = JSON.stringify({
      type: 'transcript_question',
      questionText: query,
      userId: (currentUser && currentUser.id) || DEMO_USER.id,
      apiKey: apiKey || null,
      resumeContext: candidateContext || null,
      selectedModel: selectedModel || DEFAULT_MODEL,
      speaker: source === 'interviewer' ? 'interviewer' : 'manual',
    });

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(payload);
      console.log(`[Copilot WS] Sent question to Gateway: "${query}"`);
    } else {
      console.warn('[Copilot WS] Copilot gateway WebSocket not connected yet');
    }

    setCustomQuestion('');
  }, [customQuestion, apiKey, candidateContext, selectedModel, isCollapsed, currentUser, handleToggleCollapse]);

  const handleAskQuestionRef = useRef(handleAskQuestion);
  useEffect(() => {
    handleAskQuestionRef.current = handleAskQuestion;
  }, [handleAskQuestion]);

  // Intelligent Interview Question Detector Filter for ASR Audio Stream
  const isInterviewQuestion = (text) => {
    if (!text) return false;
    const cleanText = text.trim();
    const lower = cleanText.toLowerCase();

    // Reject Whisper subtitle hallucinations & noise artifacts
    const hallucinations = [
      'sous-titrage', 'radio-canada', 'amara.org', 'subtitles by', 'thank you for watching',
      'subscribe to', 'pog.org', 'pyscript', 'psyche', 'shizuk', 'particip'
    ];
    if (hallucinations.some(h => lower.includes(h))) return false;

    const normalized = lower.replace(/[^a-z0-9\s]/g, ' ').trim();
    const words = normalized.split(/\s+/).filter(Boolean);

    // Filter out pure single-word noise (allow 2+ word utterances)
    if (words.length < 2) return false;

    // 3. Blocklist explicit meeting audio setup checks only
    const setupBlocklist = [
      'can you hear me', 'hear me okay', 'am i audible', 'can you see my screen',
      'is my screen visible', 'screen is visible', 'let me share my screen',
      'sharing my screen', 'testing mic', 'audio check', 'testing 1 2 3'
    ];
    // A whole interviewer turn can contain setup chatter *and* a real question
    // ("can you hear me okay, great, so how does React reconcile?"): strip the chatter, keep the rest.
    let remainder = normalized;
    setupBlocklist.forEach((phrase) => {
      remainder = remainder.split(phrase).join(' ');
    });
    const remainingWords = remainder.split(/\s+/).filter(Boolean);
    if (remainingWords.length !== words.length && remainingWords.length < 3) {
      console.log(`[ASR Filter] Dropped setup/meeting chatter: "${cleanText}"`);
      return false;
    }

    // Filter out pure single-word pleasantries/acknowledgments
    const fillerWords = new Set([
      'thank', 'thanks', 'you', 'very', 'much', 'so', 'ok', 'okay', 'great',
      'good', 'job', 'awesome', 'perfect', 'cool', 'got', 'it', 'ah', 'aha',
      'yeah', 'yes', 'sure', 'right', 'alright', 'fine', 'nice', 'sounds',
      'makes', 'sense', 'bye', 'hello', 'hi', 'hey', 'there', 'doing', 'back'
    ]);

    const isAllFiller = words.every(w => fillerWords.has(w));
    if (isAllFiller) return false;

    // Dispatch all 2+ word spoken technical phrases as valid questions
    return true;
  };

  // Strip unnecessary filler words ("thank you", "good job", "hello", "thanks", "see you soon", etc.)
  const cleanUnnecessaryWords = (text) => {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text.trim();
    // Strip leading dots, symbols, or non-alphanumeric noise at start of string
    cleaned = cleaned.replace(/^[^a-zA-Z0-9]+/, '').trim();

    const unnecessaryPhrases = [
      /see\s+you(?:\s+soon|\s+later)?/gi,
      /see\s+ya/gi,
      /talk\s+to\s+you\s+later/gi,
      /catch\s+you\s+later/gi,
      /take\s+care/gi,
      /have\s+a\s+(?:good|great|nice)\s+(?:day|evening|night|time)/gi,
      /thank\s+you(?:\s+very\s+much|\s+so\s+much|\s+again)?/gi,
      /thanks(?:\s+a\s+lot|\s+again)?/gi,
      /good\s+job/gi,
      /great\s+job/gi,
      /nice\s+job/gi,
      /good\s+morning/gi,
      /good\s+afternoon/gi,
      /good\s+evening/gi,
      /good\s+night/gi,
      /nice\s+(?:to\s+meet\s+you|meeting\s+you)/gi,
      /glad\s+(?:to\s+meet\s+you|meeting\s+you)/gi,
      /\b(?:hello|hi|hey|bye|goodbye|thanks|thankyou|thx|cheers|noida|delhi|mumbai|city|location)\b/gi,
      /\b(?:okay|ok)\s+(?:cool|awesome|great|perfect|thanks|thank\s+you)\b/gi
    ];

    for (const phraseRegex of unnecessaryPhrases) {
      cleaned = cleaned.replace(phraseRegex, ' ');
    }

    return cleaned
      .replace(/[,\s]+/g, ' ')
      .replace(/\s+([?.!])/g, '$1')
      .replace(/^[^a-zA-Z0-9]+/, '')
      .trim();
  };

  // Sanitize, deduplicate n-grams/phrases, and strip repetitive noise
  const sanitizeQuestionText = (rawText) => {
    if (!rawText || typeof rawText !== 'string') return '';

    let text = cleanUnnecessaryWords(rawText);
    if (!text) return '';

    // 1. Strip leading pleasantries/fillers
    const leadingFillersPattern = /^(?:thank\s+you|thanks|thank|ok|okay|hi|hello|hey|good\s+job|great|awesome|perfect|ah|aha|yeah|yes|sure|right|alright|fine|nice|so|and|then|noida|delhi|mumbai|city|location|bye)[.,!\s]*/gi;
    let prevLen = 0;
    while (text.length !== prevLen) {
      prevLen = text.length;
      text = text.replace(leadingFillersPattern, '').trim();
    }

    // 2. Strip trailing pleasantries/fillers
    const trailingFillersPattern = /[.,!\s]*(?:thank\s+you(?:\s+very\s+much)?|thanks|thank|ok|okay|bye|good\s+job|great|awesome|perfect|ah|aha|yeah|yes|sure|right|alright|fine|nice|noida|delhi|mumbai|city|location|see\s+you|see\s+you\s+soon|see\s+ya)[.,!\s]*$/gi;
    prevLen = 0;
    while (text.length !== prevLen) {
      prevLen = text.length;
      text = text.replace(trailingFillersPattern, '').trim();
    }

    // 3. Deduplicate repeated consecutive words/phrases (1 to 5 words long, e.g. "What is What is CSS?" -> "What is CSS?")
    let prevText = '';
    while (text !== prevText) {
      prevText = text;
      text = text.replace(/\b(\w+(?:\s+\w+){0,4})([?.,!\s]+)\1\b/gi, '$1$2');
    }

    // 4. Remove repeated identical consecutive sentences
    const sentences = text.split(/(?<=[?.!])\s+/).filter(Boolean);
    const uniqueSentences = [];
    for (const s of sentences) {
      const cleanS = s.trim();
      if (uniqueSentences.length === 0 || uniqueSentences[uniqueSentences.length - 1].toLowerCase() !== cleanS.toLowerCase()) {
        uniqueSentences.push(cleanS);
      }
    }

    text = uniqueSentences.join(' ').trim() || text;
    text = text.replace(/^[^a-zA-Z0-9]+/, '').trim();

    if (text.length > 0) {
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }

    return text;
  };

  // Interviewer turn → AI question. Only complete interviewer turns are answered;
  // applicant (candidate) speech is used solely to detect that the question has ended.
  const dispatchInterviewerTurn = (text, meta = {}) => {
    const sanitized = sanitizeQuestionText(text);
    if (!sanitized) return;

    if (!isInterviewQuestion(sanitized)) {
      console.log(`[Turn Manager] Interviewer turn is not a question, skipped: "${sanitized}"`);
      return;
    }

    console.log(`[Turn Manager] Interviewer turn complete (${meta.reason || 'pause'}) -> AI: "${sanitized}"`);
    if (handleAskQuestionRef.current) {
      handleAskQuestionRef.current(sanitized, 'interviewer');
    }
  };

  const dispatchInterviewerTurnRef = useRef(dispatchInterviewerTurn);
  useEffect(() => {
    dispatchInterviewerTurnRef.current = dispatchInterviewerTurn;
  });

  const turnManagerRef = useRef(null);
  useEffect(() => {
    const manager = createTurnManager({
      onInterviewerTurn: (text, meta) => dispatchInterviewerTurnRef.current(text, meta),
    });
    turnManagerRef.current = manager;
    return () => {
      manager.dispose();
      turnManagerRef.current = null;
    };
  }, []);

  // Audio streamer hook for direct mic ASR connection
  const {
    isStreaming,
    startStreaming,
    stopStreaming,
    isSystemAudioActive,
    startSystemAudioShare,
    stopSystemAudioShare,
    isSwitchingMic,
    liveTranscript,
    audioLevel,
    micError,
    activeSpeaker,
    switchSpeaker,
    asrStatus,
    speakerMode,
    setSpeakerMode,
    diarStatus,
    assignLastSpeaker,
    audioDevices,
    selectedMicId,
    switchMicrophone
  } = useAudioStreamer(
    asrWsUrl(),
    (detectedText, speaker, engine, isFinal = true) => {
      if (isFinal && detectedText) {
        console.log(`[ASR Speech Output] [${speaker}]: "${detectedText}"`);
      }
      // Interviewer text is cleaned of pleasantries ("thank you", "hello") before it can join a question;
      // an empty final still marks the end of the interviewer's utterance.
      const text = speaker === 'interviewer' && isFinal ? cleanUnnecessaryWords(detectedText) : detectedText;
      if (turnManagerRef.current) turnManagerRef.current.handleTranscript({ speaker, text, isFinal });
    }
  );

  useEffect(() => {
    switchSpeakerRef.current = switchSpeaker;
  }, [switchSpeaker]);

  // Auto-start microphone streaming on application load (run once on mount)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isStreaming) {
        startStreaming();
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleMic = () => {
    if (isStreaming) {
      stopStreaming();
    } else {
      startStreaming();
    }
  };

  const handleToggleSystemAudio = (sourceId = null) => {
    if (isSystemAudioActive) {
      stopSystemAudioShare();
    } else {
      startSystemAudioShare(sourceId);
    }
  };

  const handleSaveSettings = (data) => {
    if (data.apiKey) {
      setApiKey(data.apiKey);
      localStorage.setItem('symbiot_gemini_key', data.apiKey);
    }

    const combinedContext = [
      data.targetRole ? `[TARGET INTERVIEW ROLE]: ${data.targetRole}` : '',
      data.jobDescriptionText ? `[JOB DESCRIPTION (JD)]:\n${data.jobDescriptionText}` : '',
      data.resumeText ? `[CANDIDATE RESUME / HIGHLIGHTS]:\n${data.resumeText}` : '',
      data.uploadedFileName ? `[RESUME FILE ATTACHED]: ${data.uploadedFileName}` : ''
    ].filter(Boolean).join('\n\n');

    setCandidateContext(combinedContext);
    localStorage.setItem('symbiot_resume_context', combinedContext);
  };

  // Initialize WebSocket connection to Backend Gateway (Port 5000) with auto-reconnect
  useEffect(() => {
    let timerId = null;

    const connectWs = () => {
      try {
        const ws = new WebSocket(copilotWsUrl());
        socketRef.current = ws;

        ws.onopen = () => {
          console.log('[Copilot WS] Connected to Backend Gateway');
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'start_generating') {
              tokenBufferRef.current = '';
              setIsGenerating(true);
              setResponseText('');
            } else if (data.type === 'token_delta') {
              if (!firstTokenSeenRef.current) {
                firstTokenSeenRef.current = true;
                // Real time-to-first-token for the live latency badge
                setLatencyMs(Math.max(1, Math.round(performance.now() - questionSentAtRef.current)));
              }
              tokenBufferRef.current += data.token;
              scheduleTokenFlush();
            } else if (data.type === 'end_generating') {
              // Server-measured latency wins when available (immune to client clock jitter)
              const ttft = typeof data.ttftMs === 'number' ? data.ttftMs : null;
              const total = typeof data.totalMs === 'number' ? data.totalMs : null;
              if (ttft !== null) setLatencyMs(ttft);
              if (tokenFlushTimerRef.current !== null) {
                clearTimeout(tokenFlushTimerRef.current);
                tokenFlushTimerRef.current = null;
              }
              flushTokenBuffer();
              setIsGenerating(false);
              setConversationHistory((prev) => {
                if (prev.length === 0) return prev;
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                // Sync accumulated responseText into conversationHistory on completion
                setResponseText((finalText) => {
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    answer: finalText,
                    isGenerating: false,
                    latencyMs: ttft,
                    totalMs: total,
                  };
                  return finalText;
                });
                return updated;
              });
            }
          } catch (err) {
            console.error('[Copilot WS] Parse error:', err);
          }
        };

        ws.onclose = () => {
          console.log('[Copilot WS] Disconnected. Retrying in 3s...');
          setIsConnected(false);
          timerId = setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        setIsConnected(false);
        timerId = setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    return () => {
      if (timerId) clearTimeout(timerId);
      if (tokenFlushTimerRef.current !== null) {
        clearTimeout(tokenFlushTimerRef.current);
        tokenFlushTimerRef.current = null;
      }
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
    };
  }, [flushTokenBuffer, scheduleTokenFlush]);

  const handleMouseEnterInteractive = () => {
    if (clickThrough && window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(false);
    }
  };

  const handleMouseLeaveInteractive = () => {
    if (clickThrough && window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(true, { forward: true });
    }
  };

  return (
    <div
      className={clickThrough ? 'click-through-active' : ''}
      style={{
        minHeight: '100vh',
        background: 'transparent',
        transition: 'background 0.3s ease',
        display: 'flex',
        alignItems: isCollapsed ? 'flex-start' : 'stretch',
        justifyContent: isCollapsed ? 'flex-start' : 'stretch',
        padding: isCollapsed ? '8px' : '0'
      }}
    >
      {/* First-run authentication gate (sign in or continue as demo) */}
      {!authDismissed && (
        <AuthScreen onAuthSuccess={handleAuthSuccess} onContinueAsDemo={handleContinueAsDemo} />
      )}

      {/* Collapsed View: Floating Point Pill Badge */}
      {isCollapsed ? (
        <FloatingPoint
          onExpand={() => handleToggleCollapse(false)}
          onExitApp={handleExitApp}
          isGenerating={isGenerating}
          isStreaming={isStreaming}
          stealthMode={stealthMode}
        />
      ) : (
        /* Expanded View: Teleprompter Eye-Level Optimized Layout */
        <div
          onMouseEnter={handleMouseEnterInteractive}
          onMouseLeave={handleMouseLeaveInteractive}
          style={{
            maxWidth: stealthMode ? '680px' : '1000px',
            width: '100%',
            margin: '0 auto',
            padding: '10px 14px',
            opacity: opacity,
            transition: 'opacity 0.2s ease, max-width 0.3s ease'
          }}
        >
          {/* 1. FIRST SECTION: MAIN HEADER */}
          <Header
            currentUser={currentUser}
            onLogout={handleLogout}
            isConnected={isConnected}
            stealthMode={stealthMode}
            setStealthMode={setStealthMode}
            clickThrough={clickThrough}
            setClickThrough={setClickThrough}
            displaysList={displaysList}
            activeDisplayIndex={activeDisplayIndex}
            onSwitchDisplay={() => {
              if (window.electronAPI && displaysList.length > 1) {
                const nextIndex = (activeDisplayIndex + 1) % displaysList.length;
                const targetDisplay = displaysList[nextIndex];
                if (targetDisplay && window.electronAPI.switchDisplay) {
                  window.electronAPI.switchDisplay(targetDisplay.id);
                  setActiveDisplayIndex(nextIndex);
                }
              }
            }}
            onOpenScreenModal={() => setIsScreenModalOpen(true)}
            onOpenSettings={() => setIsModalOpen(true)}
            onCollapse={() => handleToggleCollapse(true)}
            onExitApp={handleExitApp}
          />

          {/* 2. SECOND SECTION: MIC & AI MODEL CONTROLS */}
          <div style={{ marginBottom: '12px' }}>
            <AudioVisualizer
              isStreaming={isStreaming}
              onToggleMic={handleToggleMic}
              audioLevel={audioLevel}
              liveTranscript={liveTranscript}
              micError={micError}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              opacity={opacity}
              setOpacity={setOpacity}
              activeSpeaker={activeSpeaker}
              onSwitchSpeaker={switchSpeaker}
              isSystemAudioActive={isSystemAudioActive}
              asrStatus={asrStatus}
              speakerMode={speakerMode}
              onChangeSpeakerMode={setSpeakerMode}
              diarStatus={diarStatus}
              onAssignLastSpeaker={assignLastSpeaker}
              audioDevices={audioDevices}
              selectedMicId={selectedMicId}
              onSwitchMicrophone={switchMicrophone}
              isSwitchingMic={isSwitchingMic}
            />
          </div>

          {/* 3. THIRD SECTION: MAIN EYE-LEVEL TELEPROMPTER ANSWER STAGE & SIMULATOR */}
          <div className={`main-stage-grid ${stealthMode ? 'stealth' : ''}`}>
            <CopilotAnswerCard
              conversationHistory={conversationHistory}
              activeQuestion={activeQuestion}
              responseText={responseText}
              isGenerating={isGenerating}
              latencyMs={latencyMs}
              selectedModel={selectedModel}
              onClearHistory={() => {
                setConversationHistory([]);
                setActiveQuestion('');
                setResponseText('');
                setIsGenerating(false);
              }}
              onDeleteTurn={(turnId) => {
                setConversationHistory((prev) => prev.filter((item) => item.id !== turnId));
              }}
            />

            {!stealthMode && (
              <div className="glass-panel" style={{ padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <HelpCircle size={14} color="#ffffff" /> Question Simulator
                  </h3>
                  <button
                    type="button"
                    onClick={handleRefreshSimilarQuestions}
                    className="btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                    title="Generate new similar follow-up questions"
                  >
                    <RefreshCw size={11} color="#ffffff" />
                    <span>Generate Similar</span>
                  </button>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleAskQuestion(); }} style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                  <input
                    type="text"
                    className="glass-input"
                    style={{ flex: 1, padding: '8px 10px', fontSize: '0.85rem' }}
                    placeholder="Type custom question (e.g., Explain HNSW vector indexing)..."
                    value={customQuestion}
                    onChange={(e) => setCustomQuestion(e.target.value)}
                  />
                  <button type="submit" className="btn-primary" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Send size={14} />
                    <span>Ask</span>
                  </button>
                </form>

                {/* Similar / Related Questions Chips */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.7rem', color: '#a3a3a3', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Sparkles size={11} color="#eab308" />
                    {activeQuestion ? 'Suggested Similar Follow-up Questions:' : 'Practice Interview Questions:'}
                  </span>
                  <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                    {similarQuestions.map((q, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleAskQuestion(q)}
                        className="btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '6px 10px', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                      >
                        <Play size={11} color="#ffffff" />
                        <span>{q}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <CandidateContextModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            currentApiKey={apiKey}
            currentUser={currentUser}
            onSaveContext={handleSaveSettings}
          />

          <DesktopScreenModal
            isOpen={isScreenModalOpen}
            onClose={() => setIsScreenModalOpen(false)}
            displaysList={displaysList}
            activeDisplayIndex={activeDisplayIndex}
            onSelectDisplay={(idx, source) => {
              setActiveDisplayIndex(idx);
              if (window.electronAPI && window.electronAPI.switchDisplay && source.display_id) {
                window.electronAPI.switchDisplay(source.display_id);
              }
            }}
            isSystemAudioActive={isSystemAudioActive}
            onToggleSystemAudio={handleToggleSystemAudio}
          />
        </div>
      )}
    </div>
  );
}
