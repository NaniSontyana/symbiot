import React, { useState, useEffect, useRef } from 'react';
import { Zap, Copy, Check, Sparkles, MessageSquare, Trash2, Bot, User } from 'lucide-react';

export default function CopilotAnswerCard({
  conversationHistory = [],
  activeQuestion = '',
  responseText = '',
  isGenerating = false,
  latencyMs = 180,
  selectedModel = 'gemini-1.5-flash',
  onClearHistory
}) {
  const [copiedId, setCopiedId] = useState(null);
  const feedEndRef = useRef(null);

  // Auto-scroll feed to bottom when new questions or answer tokens arrive
  useEffect(() => {
    if (feedEndRef.current) {
      feedEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversationHistory, responseText, isGenerating]);

  const handleCopyText = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Build items array from conversationHistory or activeQuestion fallback
  const displayItems = conversationHistory.length > 0
    ? conversationHistory
    : (activeQuestion || responseText
      ? [{
          id: 'single-active',
          question: activeQuestion,
          answer: responseText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isGenerating: isGenerating,
          latencyMs: latencyMs,
          selectedModel: selectedModel
        }]
      : []);

  return (
    <div
      className="glass-panel"
      style={{
        padding: '10px 14px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '240px',
        maxHeight: 'calc(100vh - 130px)',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
        position: 'relative'
      }}
    >
      {/* Header Bar with Conversation Feed Stats & Controls */}
      <div style={{ paddingBottom: '4px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={14} color="#ffffff" />
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ffffff', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            REAL-TIME INTERVIEW CONVERSATION FEED
          </span>
          <span style={{ fontSize: '0.66rem', background: 'rgba(255, 255, 255, 0.12)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#ffffff', padding: '1px 6px', borderRadius: '8px', fontWeight: 600 }}>
            {displayItems.length} {displayItems.length === 1 ? 'Turn' : 'Turns'}
          </span>
        </div>

        {conversationHistory.length > 0 && onClearHistory && (
          <button
            onClick={onClearHistory}
            className="btn-secondary"
            style={{ padding: '2px 6px', fontSize: '0.66rem', color: '#ffffff', borderColor: 'rgba(255, 255, 255, 0.25)', display: 'flex', alignItems: 'center', gap: '3px' }}
          >
            <Trash2 size={11} color="#ffffff" /> Clear Feed
          </button>
        )}
      </div>

      {/* Main Conversation Feed Scroll Area */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '2px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {displayItems.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#a3a3a3', margin: 'auto', padding: '20px 10px' }}>
            <Sparkles size={32} color="#ffffff" style={{ opacity: 0.9, marginBottom: '8px' }} />
            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
              🎙️ Ready for Interviewer Voice Questions
            </p>
            <p style={{ fontSize: '0.78rem', color: '#a3a3a3', marginTop: '4px', margin: 0 }}>
              Speak or play audio. The ASR service will convert interviewer voice into a question, and AI Copilot will stream candidate answers below!
            </p>
          </div>
        ) : (
          displayItems.map((item, idx) => (
            <div
              key={item.id || idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                transition: 'border-color 0.2s ease'
              }}
            >
              {/* 1. Interviewer Voice Speech-to-Text Question Card */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '6px',
                  padding: '6px 8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#e5e7eb', display: 'flex', alignItems: 'center', gap: '4px', letterSpacing: '0.03em' }}>
                    <User size={11} color="#ffffff" /> INTERVIEWER (CONVERTED VOICE QUESTION)
                  </span>
                  <span style={{ fontSize: '0.64rem', color: '#a3a3a3' }}>
                    {item.timestamp || 'Voice Transcribed'}
                  </span>
                </div>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', margin: 0, lineHeight: 1.3 }}>
                  {item.question || 'Transcribing interviewer speech...'}
                </h3>
              </div>

              {/* 2. AI Copilot Generated Candidate Answer Card */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  borderRadius: '6px',
                  padding: '8px 10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '4px', letterSpacing: '0.03em' }}>
                    <Bot size={12} color="#ffffff" /> CANDIDATE AI COPILOT ANSWER
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.64rem', background: 'rgba(255, 255, 255, 0.12)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#ffffff', padding: '1px 5px', borderRadius: '8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Zap size={9} color="#ffffff" /> {item.latencyMs || latencyMs || 180}ms
                    </span>
                    <button
                      onClick={() => handleCopyText(item.answer, item.id || idx)}
                      className="btn-secondary"
                      style={{ padding: '1px 6px', fontSize: '0.64rem', color: '#ffffff', border: '1px solid rgba(255, 255, 255, 0.25)' }}
                    >
                      {copiedId === (item.id || idx) ? <Check size={11} color="#ffffff" /> : <Copy size={11} color="#ffffff" />}
                      {copiedId === (item.id || idx) ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                {item.answer ? (
                  <div style={{
                    fontSize: '0.84rem',
                    fontWeight: 500,
                    lineHeight: 1.45,
                    color: '#ffffff',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
                  }}>
                    {item.answer}
                    {item.isGenerating && (
                      <span style={{ display: 'inline-block', width: '6px', height: '14px', background: '#ffffff', marginLeft: '4px', animation: 'pulse 0.8s infinite' }} />
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a3a3a3', fontSize: '0.78rem', fontStyle: 'italic', padding: '4px 0' }}>
                    <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#ffffff', animation: 'pulse 0.8s infinite' }} />
                    Generating candidate answer via vector RAG...
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={feedEndRef} />
      </div>
    </div>
  );
}
