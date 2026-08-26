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

  const [qaHistory, setQaHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [screenshotAttached, setScreenshotAttached] = useState(false);
  const inputRef = useRef(null);

  const handlePrevHistory = useCallback(() => {
    if (qaHistory.length === 0) return;
    const newIdx = historyIndex <= 0 ? 0 : historyIndex - 1;
    setHistoryIndex(newIdx);
    setActiveQuestion(qaHistory[newIdx].question);
    setResponseText(qaHistory[newIdx].response);
  }, [qaHistory, historyIndex]);

  const handleNextHistory = useCallback(() => {
    if (qaHistory.length === 0) return;
    const newIdx = historyIndex >= qaHistory.length - 1 ? qaHistory.length - 1 : historyIndex + 1;
    setHistoryIndex(newIdx);
    setActiveQuestion(qaHistory[newIdx].question);
    setResponseText(qaHistory[newIdx].response);
  }, [qaHistory, historyIndex]);

  const handleFocusChat = useCallback(() => {
    if (isCollapsed) handleToggleCollapse(false);
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 100);
  }, [isCollapsed]);

  const handleTriggerScreenshot = useCallback(() => {
    setScreenshotAttached(prev => !prev);
    alert('Screen capture snippet attached for AI query!');
  }, []);

  const handleClearSession = useCallback(() => {
    setActiveQuestion('');
    setResponseText('');
    setScreenshotAttached(false);
  }, []);

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
            // Store in Q&A History
            setQaHistory(prev => {
              const updated = [...prev, { question: query, response: responseText }];
              setHistoryIndex(updated.length - 1);
              return updated;
            });
            setTimeout(() => {
              if (switchSpeakerRef.current) switchSpeakerRef.current('interviewer');
            }, 4000);
          }
        } catch (e) {}
      };
    }

    setCustomQuestion('');
  }, [customQuestion, apiKey, candidateContext, selectedModel, isCollapsed, responseText]);

  // Global Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Alt + Enter -> Trigger Answer (⌘↵)
      if (e.altKey && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        handleAskQuestion();
      }
      // Alt + Shift + Enter -> Screenshot (⌘⇧↵)
      else if (e.altKey && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        handleTriggerScreenshot();
      }
      // Alt + Shift + U -> Focus Chat (⌘⇧_)
      else if (e.altKey && e.shiftKey && (e.key === '_' || e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        handleFocusChat();
      }
      // Alt + Backspace -> Clear Session (⌘⌫)
      else if (e.altKey && e.key === 'Backspace') {
        e.preventDefault();
        handleClearSession();
      }
      // Alt + LeftArrow -> Prev History (⌘←)
      else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevHistory();
      }
      // Alt + RightArrow -> Next History (⌘→)
      else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextHistory();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAskQuestion, handleTriggerScreenshot, handleFocusChat, handleClearSession, handlePrevHistory, handleNextHistory]);

  const handleAskQuestionRef = useRef(handleAskQuestion);
  useEffect(() => {
    handleAskQuestionRef.current = handleAskQuestion;
  }, [handleAskQuestion]);

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

  const handleToggleSystemAudio = () => {
    if (isSystemAudioActive) {
      stopSystemAudioShare();
    } else {
      startSystemAudioShare();
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

  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

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
        /* Expanded View: Target Screenshot Overlay Layout */
        <div style={{
          maxWidth: '940px',
          width: '100%',
          margin: '0 auto',
          padding: '12px 14px',
          opacity: opacity,
          transition: 'opacity 0.2s ease'
        }}>
          {/* 1. Top Floating Pill Toolbar matching target screenshot */}
          <Header
            isStreaming={isStreaming}
            onToggleMic={handleToggleMic}
            audioLevel={audioLevel}
            isSystemAudioActive={isSystemAudioActive}
            onToggleSystemAudio={handleToggleSystemAudio}
            onTriggerAnswer={() => handleAskQuestion()}
            onTriggerScreenshot={handleTriggerScreenshot}
            onToggleChat={handleFocusChat}
            onOpenSettings={() => setIsModalOpen(true)}
            onCollapse={() => handleToggleCollapse(true)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={handleToggleFullscreen}
            onClearSession={handleClearSession}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
          />

          {/* 2. Main Floating Glass Response Panel matching target screenshot */}
          <CopilotAnswerCard
            activeQuestion={activeQuestion}
            responseText={responseText}
            isGenerating={isGenerating}
            onSendMessage={(msg) => handleAskQuestion(msg)}
            onClearSession={handleClearSession}
            onAddScreenshot={handleTriggerScreenshot}
            onOpenSettings={() => setIsModalOpen(true)}
            onClose={() => handleToggleCollapse(true)}
            onPrevHistory={handlePrevHistory}
            onNextHistory={handleNextHistory}
            screenshotAttached={screenshotAttached}
            inputRef={inputRef}
            opacity={opacity}
            setOpacity={setOpacity}
            stealthMode={stealthMode}
            setStealthMode={setStealthMode}
            bgMode={bgMode}
            setBgMode={setBgMode}
          />
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
