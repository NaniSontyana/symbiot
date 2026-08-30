import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import AudioVisualizer from './components/AudioVisualizer';
import CopilotAnswerCard from './components/CopilotAnswerCard';
import CandidateContextModal from './components/CandidateContextModal';
import DesktopScreenModal from './components/DesktopScreenModal';
import FloatingPoint from './components/FloatingPoint';
import { useAudioStreamer } from './hooks/useAudioStreamer';
import { Send, Play, HelpCircle } from 'lucide-react';

const SAMPLE_QUESTIONS = [
  "Tell me about a complex project where you handled real-time data streaming.",
  "How do WebSockets differ from HTTP long-polling in terms of latency and server load?",
  "What is the difference between SQL and NoSQL databases for high-scale applications?",
  "Explain how pgvector and HNSW indexes work for AI document retrieval."
];

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

    const sendPayload = (ws) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        console.log(`[Question Simulator] Sent question: "${query}"`);
      }
    };

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      sendPayload(socketRef.current);
    } else {
      console.warn('[Copilot WS] Gateway WebSocket reconnecting on port 5000...');
      const newWs = new WebSocket('ws://localhost:5000/ws/copilot');
      socketRef.current = newWs;

      newWs.onopen = () => {
        setIsConnected(true);
        sendPayload(newWs);
      };

      newWs.onmessage = (event) => {
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

            // Automatically switch to Applicant Speech Mode so candidate can read/speak response to interviewer
            if (switchSpeakerRef.current) {
              console.log('[Turn Protocol] AI answer complete. Switching to Applicant Response Phase...');
              switchSpeakerRef.current('applicant');
            }
          }
        } catch (e) {}
      };
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

    // 3. Minimum length check (must be at least 14 chars and 3 words)
    const words = lower.split(/\s+/).filter(Boolean);
    if (cleanText.length < 14 || words.length < 3) return false;

    // 4. Exclude casual filler phrases & pleasantries
    const fillerPhrases = [
      'thank you', 'thanks', 'can you hear me', 'am i audible', 'hello', 'hi there',
      'good morning', 'good afternoon', 'good evening', 'okay cool', 'sounds good',
      'makes sense', 'see you', 'bye for now', 'yes i can', 'no problem', 'right right',
      'this is better', 'yeah this', 'let me show', 'as i can say'
    ];
    if (fillerPhrases.some(phrase => lower.includes(phrase))) return false;

    // 5. Exclude explanatory statement prefixes (statements using "what/how/why" in prose)
    const statementPrefixes = [
      'so what we', 'this is how', 'that is why', 'here is what', 'what we are doing',
      'i think that', 'we are going to', 'as you can see', 'let me explain', 'in this case',
      'for example', 'first of all', 'remember we have'
    ];
    if (statementPrefixes.some(prefix => lower.startsWith(prefix))) return false;

    // 6. Must have an explicit question mark OR a question-starter phrase in the first 3 words
    const hasQuestionMark = cleanText.includes('?');

    const questionStarters = [
      'what', 'how', 'why', 'where', 'when', 'which', 'who', 'whose', 'whom',
      'can you', 'could you', 'would you', 'explain', 'tell me', 'describe',
      'difference', 'compare', 'walk me through', 'design', 'implement',
      'optimize', 'architecture', 'have you', 'in your opinion'
    ];

    const firstThreeWords = words.slice(0, 3).join(' ');
    const startsWithQuestionTrigger = questionStarters.some(trigger =>
      firstThreeWords.includes(trigger) || lower.startsWith(trigger)
    );

    // Reject dangling/incomplete trailing prepositions ("Can you explain about", "How do you handle in")
    const trailingConnectors = [
      'about', 'with', 'in', 'of', 'for', 'and', 'or', 'the', 'a', 'an', 'to', 'is', 'are',
      'by', 'on', 'what', 'how', 'why', 'where', 'when', 'can you', 'could you', 'would you',
      'like', 'such as', 'that', 'this', 'if', 'when', 'which', 'who'
    ];
    const lastWord = words[words.length - 1];
    const isDanglingIncomplete = trailingConnectors.includes(lastWord) && !hasQuestionMark;

    if (isDanglingIncomplete) return false;

    return hasQuestionMark || startsWithQuestionTrigger;
  };

  // Smart Speech Accumulator for ASR chunks
  const pendingQuestionRef = useRef('');
  const accumulationTimerRef = useRef(null);

  const dispatchAccumulatedQuestion = (text) => {
    if (!text || !text.trim()) return;
    const finalQ = text.trim();

    // Final structural validation before sending complete question to LLM
    if (!isInterviewQuestion(finalQ, 'interviewer')) {
      console.log(`[ASR Accumulator] Incomplete question speech dropped: "${finalQ}"`);
      return;
    }

    console.log(`[Copilot AI Dispatching 100% Complete Question]: "${finalQ}"`);
    if (handleAskQuestionRef.current) {
      handleAskQuestionRef.current(finalQ);
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

        // Accumulate incoming text chunks continuously while interviewer speaks
        const combined = (pendingQuestionRef.current + ' ' + detectedText).trim();
        pendingQuestionRef.current = combined;

        if (accumulationTimerRef.current) clearTimeout(accumulationTimerRef.current);

        // Require a 1400ms (1.4s) natural silence pause after speech before dispatching to LLM
        accumulationTimerRef.current = setTimeout(() => {
          dispatchAccumulatedQuestion(pendingQuestionRef.current);
        }, 1400);
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
    <div style={{
      minHeight: '100vh',
      background: 'transparent',
      transition: 'background 0.3s ease',
      display: 'flex',
      alignItems: isCollapsed ? 'flex-start' : 'stretch',
      justifyContent: isCollapsed ? 'flex-start' : 'stretch',
      padding: isCollapsed ? '8px' : '0'
    }}>
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
                <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <HelpCircle size={14} color="#ffffff" /> Question Simulator
                </h3>

                <form onSubmit={(e) => { e.preventDefault(); handleAskQuestion(); }} style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
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

                {/* Preset Samples */}
                <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {SAMPLE_QUESTIONS.map((q, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleAskQuestion(q)}
                      className="btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '6px 10px', whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Play size={11} color="#ffffff" />
                      <span>{q}</span>
                    </button>
                  ))}
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
