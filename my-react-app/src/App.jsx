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
  const [stealthMode, setStealthMode] = useState(false);
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

    setActiveQuestion(query);
    setResponseText('');
    setIsGenerating(true);
    setLatencyMs(Math.floor(Math.random() * 40) + 160);

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
          } else if (data.type === 'end_generating') {
            setIsGenerating(false);
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

    // 2. Minimum length check (must be at least 12 chars and 3 words)
    const words = lower.split(/\s+/);
    if (cleanText.length < 12 || words.length < 3) return false;

    // 3. Exclude casual filler phrases & pleasantries
    const fillerPhrases = [
      'thank you', 'thanks', 'can you hear me', 'am i audible', 'hello', 'hi there',
      'good morning', 'good afternoon', 'good evening', 'okay cool', 'sounds good',
      'makes sense', 'see you', 'bye for now', 'yes i can', 'no problem', 'right right'
    ];
    if (fillerPhrases.some(phrase => lower.includes(phrase))) return false;

    // 4. Must contain a question mark OR an explicit technical/interview prompt trigger
    const questionTriggers = [
      'what', 'how', 'why', 'where', 'when', 'which', 'who', 'whose', 'whom',
      'can you', 'could you', 'would you', 'explain', 'tell me', 'describe',
      'difference', 'compare', 'walk me through', 'design', 'implement',
      'optimize', 'architecture', 'in your experience', 'have you worked'
    ];

    const hasQuestionMark = cleanText.includes('?');
    const hasTriggerKeyword = questionTriggers.some(trigger => lower.includes(trigger));

    return hasQuestionMark || hasTriggerKeyword;
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
        if (isInterviewQuestion(detectedText, speaker)) {
          console.log(`[Interviewer Question Triggered AI Search]: "${detectedText}"`);
          if (handleAskQuestionRef.current) {
            handleAskQuestionRef.current(detectedText);
          }
        } else {
          console.log(`[Conversational Speech Filtered Out]: "${detectedText}"`);
        }
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
            } else if (data.type === 'end_generating') {
              setIsGenerating(false);
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

  return (
    <div style={{
      minHeight: '100vh',
      background: bgMode === 'transparent' ? 'transparent' : 'radial-gradient(ellipse at top, #111827 0%, #030712 100%)',
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
        <div style={{
          maxWidth: stealthMode ? '680px' : '1000px',
          width: '100%',
          margin: '0 auto',
          padding: '10px 14px',
          opacity: opacity,
          transition: 'opacity 0.2s ease, max-width 0.3s ease'
        }}>
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
              activeQuestion={activeQuestion}
              responseText={responseText}
              isGenerating={isGenerating}
              latencyMs={latencyMs}
            />

            {!stealthMode && (
              <div className="glass-panel" style={{ padding: '14px' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <HelpCircle size={14} color="#10b981" /> Question Simulator
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
                      <Play size={11} color="#10b981" />
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
