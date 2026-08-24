import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import AudioVisualizer from './components/AudioVisualizer';
import CopilotAnswerCard from './components/CopilotAnswerCard';
import CandidateContextModal from './components/CandidateContextModal';
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
    const query = questionStr || customQuestion;
    if (!query || !query.trim()) return;

    if (isCollapsed) {
      handleToggleCollapse(false);
    }

    setActiveQuestion(query);
    setResponseText('');
    setIsGenerating(true);
    setLatencyMs(Math.floor(Math.random() * 40) + 160);

    // Automatically switch to Applicant mode while answer is being delivered
    if (switchSpeakerRef.current) {
      switchSpeakerRef.current('applicant');
    }

    const sendPayload = () => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'transcript_question',
            questionText: query,
            userId: '00000000-0000-0000-0000-000000000000',
            apiKey: apiKey || null,
            resumeContext: candidateContext || null,
            selectedModel: selectedModel || 'gemini-1.5-flash',
          })
        );
      }
    };

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      sendPayload();
    } else {
      console.warn('[Copilot WS] Gateway WebSocket disconnected. Reconnecting to port 5000...');
      const newWs = new WebSocket('ws://localhost:5000/ws/copilot');
      socketRef.current = newWs;
      newWs.onopen = () => {
        setIsConnected(true);
        sendPayload();
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
            if (resetAsrBufferRef.current) resetAsrBufferRef.current();
            // Automatically switch back to Interviewer listening mode after answer is read
            setTimeout(() => {
              if (switchSpeakerRef.current) switchSpeakerRef.current('interviewer');
            }, 4000);
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

  // Audio streamer hook for direct mic ASR connection
  const { isStreaming, startStreaming, stopStreaming, liveTranscript, audioLevel, micError, activeSpeaker, switchSpeaker, resetAsrBuffer } = useAudioStreamer(
    'ws://localhost:8000/ws/transcribe',
    (detectedText, speaker) => {
      if (detectedText) {
        const lower = detectedText.toLowerCase().trim();
        const isQuestion = lower.endsWith('?') || ['what', 'how', 'why', 'can you', 'could you', 'explain', 'tell me', 'describe', 'difference', 'compare', 'where', 'when', 'which', 'would you'].some(w => lower.includes(w));

        if ((!speaker || speaker === 'interviewer') && isQuestion) {
          console.log(`[Interviewer Question Detected]: "${detectedText}"`);
          if (handleAskQuestionRef.current) {
            handleAskQuestionRef.current(detectedText);
          }
        } else {
          console.log(`[Applicant/Prose Speech Ignored for Question Trigger]: "${detectedText}"`);
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

                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  <input
                    type="text"
                    className="glass-input"
                    style={{ flex: 1, padding: '8px 10px', fontSize: '0.85rem' }}
                    placeholder="Type custom question..."
                    value={customQuestion}
                    onChange={(e) => setCustomQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAskQuestion()}
                  />
                  <button onClick={() => handleAskQuestion()} className="btn-primary" style={{ padding: '8px 12px' }}>
                    <Send size={14} />
                  </button>
                </div>

                {/* Preset Samples */}
                <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {SAMPLE_QUESTIONS.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAskQuestion(q)}
                      className="btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '6px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}
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
        </div>
      )}
    </div>
  );
}
