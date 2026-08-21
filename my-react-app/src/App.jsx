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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(0.85);
  const [bgMode, setBgMode] = useState('transparent');
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash');
  const [isModalOpen, setIsModalOpen] = useState(false);

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

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'transcript_question',
          questionText: query,
          userId: 'demo-candidate-123',
          apiKey: apiKey || null,
          resumeContext: candidateContext,
          selectedModel: selectedModel
        })
      );
    } else {
      setTimeout(() => {
        setResponseText(
          `[${selectedModel.toUpperCase()} Response]: Direct Answer: Based on your resume experience, emphasize your background building distributed Node.js systems, real-time WebSockets, and database vector search.\n\nKey Talking Points:\n• Scalability: Discuss how you decoupled microservice endpoints for high throughput.\n• Technical Mastery: Mention your hands-on work with PostgreSQL pgvector and low-latency API gateways.`
        );
        setIsGenerating(false);
      }, 300);
    }

    setCustomQuestion('');
  }, [customQuestion, apiKey, candidateContext, selectedModel, isCollapsed]);

  // Audio streamer hook for direct mic ASR connection
  const { isStreaming, startStreaming, stopStreaming, liveTranscript, audioLevel } = useAudioStreamer(
    'ws://localhost:8000/ws/transcribe',
    (detectedText) => {
      if (detectedText) {
        handleAskQuestion(detectedText);
      }
    }
  );

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
    if (data.resumeText) {
      setCandidateContext(data.resumeText);
      localStorage.setItem('symbiot_resume_context', data.resumeText);
    }
  };

  // Initialize WebSocket connection to Backend Gateway
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:5000/ws/copilot');
    socketRef.current = ws;

    ws.onopen = () => {
      console.log('[Copilot WS] Connected to Gateway');
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
        }
      } catch (err) {
        console.error('[Copilot WS] Parse error:', err);
      }
    };

    ws.onclose = () => {
      console.log('[Copilot WS] Disconnected');
      setIsConnected(false);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
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
        /* Expanded View: Full Copilot Application */
        <div style={{
          maxWidth: stealthMode ? '680px' : '1100px',
          width: '100%',
          margin: '0 auto',
          padding: '20px',
          opacity: opacity,
          transition: 'opacity 0.2s ease, max-width 0.3s ease'
        }}>
          <Header
            isConnected={isConnected}
            stealthMode={stealthMode}
            setStealthMode={setStealthMode}
            onOpenSettings={() => setIsModalOpen(true)}
            onCollapse={() => handleToggleCollapse(true)}
            onExitApp={handleExitApp}
          />

          <div style={{ marginBottom: '20px' }}>
            <AudioVisualizer
              isStreaming={isStreaming}
              onToggleMic={handleToggleMic}
              audioLevel={audioLevel}
              liveTranscript={liveTranscript}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              opacity={opacity}
              setOpacity={setOpacity}
              bgMode={bgMode}
              setBgMode={setBgMode}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: stealthMode ? '1fr' : '1fr 340px', gap: '20px', alignItems: 'start' }}>
            {/* Main Copilot Response View */}
            <CopilotAnswerCard
              activeQuestion={activeQuestion}
              responseText={responseText}
              isGenerating={isGenerating}
              latencyMs={latencyMs}
            />

            {/* Sidebar / Quick Question Feeder */}
            {!stealthMode && (
              <div className="glass-panel" style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <HelpCircle size={16} color="#10b981" /> Question Feeder Simulator
                </h3>

                {/* Custom Input */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
                  <input
                    type="text"
                    className="glass-input"
                    style={{ flex: 1 }}
                    placeholder="Type or simulate interviewer question..."
                    value={customQuestion}
                    onChange={(e) => setCustomQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAskQuestion()}
                  />
                  <button onClick={() => handleAskQuestion()} className="btn-primary" style={{ padding: '10px 14px' }}>
                    <Send size={16} />
                  </button>
                </div>

                {/* Preset Samples */}
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '10px', textTransform: 'uppercase' }}>
                  Sample Technical Questions
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {SAMPLE_QUESTIONS.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAskQuestion(q)}
                      className="btn-secondary"
                      style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '0.8rem', padding: '10px 12px' }}
                    >
                      <Play size={12} color="#10b981" style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {q}
                      </span>
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
