import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import AudioVisualizer from './components/AudioVisualizer';
import CopilotAnswerCard from './components/CopilotAnswerCard';
import CandidateContextModal from './components/CandidateContextModal';
import DesktopScreenModal from './components/DesktopScreenModal';
import FloatingPoint from './components/FloatingPoint';
import { useAudioStreamer } from './hooks/useAudioStreamer';
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

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [stealthMode, setStealthMode] = useState(true);
  const [clickThrough, setClickThrough] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(0.85);
  const [bgMode, setBgMode] = useState('transparent');
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash');
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
  const [latencyMs, setLatencyMs] = useState(180);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [similarQuestions, setSimilarQuestions] = useState(SIMILAR_QUESTION_BANKS.general);

  // Automatically update similar question recommendations when active question or context changes
  useEffect(() => {
    const updated = getTopicSimilarQuestions(activeQuestion, candidateContext);
    setSimilarQuestions(updated);
  }, [activeQuestion, candidateContext]);

  const handleRefreshSimilarQuestions = () => {
    const categories = Object.keys(SIMILAR_QUESTION_BANKS);
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    setSimilarQuestions(SIMILAR_QUESTION_BANKS[randomCategory]);
  };

  const socketRef = useRef(null);

  // Notify Electron of window resize when collapsing/expanding
  const handleToggleCollapse = (collapsedState) => {
    setIsCollapsed(collapsedState);
    if (window.electronAPI && window.electronAPI.resizeWindow) {
      window.electronAPI.resizeWindow({ isCollapsed: collapsedState, stealthMode });
    }
  };

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
  const handleAskQuestion = useCallback((questionStr) => {
    const query = (typeof questionStr === 'string' && questionStr.trim()) ? questionStr.trim() : customQuestion.trim();
    if (!query) return;

    if (isCollapsed) {
      handleToggleCollapse(false);
    }

    const newItemId = Date.now();
    const newLatency = Math.floor(Math.random() * 40) + 160;

    setActiveQuestion(query);
    setResponseText('');
    setIsGenerating(true);
    setLatencyMs(newLatency);

    setConversationHistory((prev) => [
      ...prev,
      {
        id: newItemId,
        question: query,
        answer: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        isGenerating: true,
        latencyMs: newLatency,
        selectedModel: selectedModel || 'gemini-1.5-flash',
      }
    ]);

    const payload = JSON.stringify({
      type: 'transcript_question',
      questionText: query,
      userId: '00000000-0000-0000-0000-000000000000',
      apiKey: apiKey || null,
      resumeContext: candidateContext || null,
      selectedModel: selectedModel || 'gemini-1.5-flash',
    });

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(payload);
      console.log(`[Copilot WS] Sent question to Gateway: "${query}"`);
    } else {
      console.warn('[Copilot WS] WebSocket on port 5000 not connected yet');
    }

    setCustomQuestion('');
  }, [customQuestion, apiKey, candidateContext, selectedModel, isCollapsed]);

  const handleAskQuestionRef = useRef(handleAskQuestion);
  useEffect(() => {
    handleAskQuestionRef.current = handleAskQuestion;
  }, [handleAskQuestion]);

  // Intelligent Interview Question Detector Filter for ASR Audio Stream
  const isInterviewQuestion = (text, speaker) => {
    if (!text) return false;
    const cleanText = text.trim();
    const lower = cleanText.toLowerCase();

    // 1. Only evaluate when speaker is interviewer/system (ignore applicant speech)
    if (speaker === 'applicant') return false;

    // 2. Reject Whisper subtitle hallucinations & noise artifacts
    const hallucinations = [
      'sous-titrage', 'radio-canada', 'amara.org', 'subtitles by', 'thank you for watching',
      'subscribe to', 'pog.org', 'pyscript', 'psyche', 'shizuk', 'particip'
    ];
    if (hallucinations.some(h => lower.includes(h))) return false;

    const normalized = lower.replace(/[^a-z0-9\s]/g, ' ').trim();
    const words = normalized.split(/\s+/).filter(Boolean);

    if (words.length < 2) return false;

    // 3. Filter out pure pleasantries / acknowledgments / greetings / location chatter
    const fillerWords = new Set([
      'thank', 'thanks', 'you', 'very', 'much', 'so', 'ok', 'okay', 'great',
      'good', 'job', 'awesome', 'perfect', 'cool', 'got', 'it', 'ah', 'aha',
      'yeah', 'yes', 'sure', 'right', 'alright', 'fine', 'nice', 'sounds',
      'makes', 'sense', 'bye', 'hello', 'hi', 'hey', 'there', 'doing', 'back',
      'well', 'noida', 'delhi', 'bangalore', 'mumbai', 'location', 'city'
    ]);

    const isAllFiller = words.every(w => fillerWords.has(w));
    if (isAllFiller) return false;

    // 4. Must contain an explicit question mark OR a clear question/interview prompt trigger
    const hasQuestionMark = cleanText.includes('?');

    const questionTriggers = [
      'what', 'how', 'why', 'where', 'when', 'which', 'who', 'whose', 'whom',
      'can you', 'could you', 'would you', 'will you', 'do you', 'did you',
      'have you', 'are you', 'is there', 'tell me', 'explain', 'describe',
      'walk me through', 'elaborate', 'discuss', 'difference', 'compare',
      'pros and cons', 'trade off', 'tradeoff', 'design', 'implement', 'build',
      'architecture', 'optimize', 'scale', 'experience', 'opinion', 'perspective',
      'thoughts'
    ];

    const hasQuestionTrigger = questionTriggers.some(trigger => lower.includes(trigger));

    // Reject incomplete trailing/transitional phrases without a question mark
    const trailingConnectors = [
      'and then', 'and now', 'so we', 'let us', 'going to', 'ahead and', 'we are', 'see'
    ];
    const endsWithTrailing = trailingConnectors.some(c => lower.endsWith(c));

    if (!hasQuestionMark && endsWithTrailing) {
      return false;
    }

    // Require either a question mark OR a question trigger to dispatch to AI
    return hasQuestionMark || hasQuestionTrigger;
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

  // Smart Speech Accumulator for ASR chunks
  const pendingQuestionRef = useRef('');
  const accumulationTimerRef = useRef(null);

  const dispatchAccumulatedQuestion = (text) => {
    if (!text || !text.trim()) return;
    const sanitized = sanitizeQuestionText(text);
    if (!sanitized || !sanitized.trim()) return;

    // Check dangling prepositions/connectors before dispatching
    const lower = sanitized.toLowerCase().trim();
    const words = lower.split(/\s+/).filter(Boolean);
    const hasQuestionMark = sanitized.includes('?');

    const danglingConnectors = [
      'and', 'or', 'with', 'for', 'in', 'of', 'to', 'about', 'like', 'such as',
      'between', 'versus', 'compared to', 'using', 'when', 'if', 'how', 'what',
      'why', 'where', 'which', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'the', 'a', 'an', 'and then', 'and now', 'so we', 'let us', 'going to',
      'ahead and', 'we are'
    ];

    const lastWord = words[words.length - 1] || '';
    const lastTwoWords = words.slice(-2).join(' ') || '';

    const isDanglingIncomplete = !hasQuestionMark && (danglingConnectors.includes(lastWord) || danglingConnectors.includes(lastTwoWords));

    if (isDanglingIncomplete) {
      console.log(`[ASR Accumulator] Sentence is dangling/incomplete ("${sanitized}"). Waiting for interviewer to complete question...`);
      return;
    }

    // Final structural validation before sending complete question to LLM
    if (!isInterviewQuestion(sanitized, 'interviewer')) {
      console.log(`[ASR Accumulator] Incomplete question speech dropped: "${sanitized}"`);
      return;
    }

    console.log(`[Copilot AI Dispatching 100% Complete Question]: "${sanitized}"`);
    if (handleAskQuestionRef.current) {
      handleAskQuestionRef.current(sanitized);
    }
    pendingQuestionRef.current = '';
  };

  // Audio streamer hook for direct mic ASR connection
  const {
    isStreaming,
    startStreaming,
    stopStreaming,
    isSystemAudioActive,
    startSystemAudioShare,
    stopSystemAudioShare,
    liveTranscript,
    audioLevel,
    micError,
    activeSpeaker,
    switchSpeaker,
    resetAsrBuffer
  } = useAudioStreamer(
    'ws://localhost:8000/ws/transcribe',
    (detectedText, speaker) => {
      if (detectedText) {
        if (speaker === 'applicant') {
          console.log(`[Applicant Speech Output]: "${detectedText}"`);
          // Automatically reset to Interviewer Listening Mode 2s after candidate finishes speaking response
          if (accumulationTimerRef.current) clearTimeout(accumulationTimerRef.current);
          accumulationTimerRef.current = setTimeout(() => {
            if (switchSpeakerRef.current) {
              console.log('[Turn Protocol] Candidate response finished. Resetting to Interviewer Listening Mode...');
              switchSpeakerRef.current('interviewer');
            }
          }, 2000);
          return;
        }

        // Clean all unnecessary filler words ("thank you", "good job", "thanks", etc.) BEFORE recording into buffer
        const cleanChunk = cleanUnnecessaryWords(detectedText);
        if (!cleanChunk) return;

        const combined = (pendingQuestionRef.current + ' ' + cleanChunk).trim();
        pendingQuestionRef.current = combined;

        if (accumulationTimerRef.current) clearTimeout(accumulationTimerRef.current);

        // Require a 2400ms (2.4s) complete silence pause after speech before dispatching complete question
        accumulationTimerRef.current = setTimeout(() => {
          dispatchAccumulatedQuestion(pendingQuestionRef.current);
        }, 2400);
      }
    }
  );

  useEffect(() => {
    switchSpeakerRef.current = switchSpeaker;
  }, [switchSpeaker]);

  const resetAsrBufferRef = useRef(resetAsrBuffer);
  useEffect(() => {
    resetAsrBufferRef.current = resetAsrBuffer;
  }, [resetAsrBuffer]);

  // Auto-start microphone streaming on application load
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isStreaming) {
        startStreaming();
      }
    }, 600);
    return () => clearTimeout(timer);
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
        const ws = new WebSocket('ws://localhost:5000/ws/copilot');
        socketRef.current = ws;

        ws.onopen = () => {
          console.log('[Copilot WS] Connected to Gateway port 5000');
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'start_generating') {
              setIsGenerating(true);
              setResponseText('');
            } else if (data.type === 'token_delta') {
              setResponseText((prev) => prev + data.token);
              setConversationHistory((prev) => {
                if (prev.length === 0) return prev;
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  answer: updated[lastIdx].answer + data.token,
                  isGenerating: true
                };
                return updated;
              });
            } else if (data.type === 'end_generating') {
              setIsGenerating(false);
              setConversationHistory((prev) => {
                if (prev.length === 0) return prev;
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  isGenerating: false
                };
                return updated;
              });
              if (resetAsrBufferRef.current) resetAsrBufferRef.current();
              if (switchSpeakerRef.current) {
                console.log('[Turn Protocol] AI answer streaming complete. Switching to Applicant Response Phase...');
                switchSpeakerRef.current('applicant');
              }
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

        ws.onerror = (err) => {
          ws.close();
        };
      } catch (err) {
        setIsConnected(false);
        timerId = setTimeout(connectWs, 3000);
      }
    };

    connectWs();

    return () => {
      if (timerId) clearTimeout(timerId);
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
    };
  }, []);

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
              bgMode={bgMode}
              setBgMode={setBgMode}
              activeSpeaker={activeSpeaker}
              onSwitchSpeaker={switchSpeaker}
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
              onClearHistory={() => setConversationHistory([])}
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
