import React, { useState } from 'react';
import { Zap, Copy, Check, Sparkles, MessageSquare } from 'lucide-react';

export default function CopilotAnswerCard({
  activeQuestion,
  responseText,
  isGenerating,
  latencyMs
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!responseText) return;
    navigator.clipboard.writeText(responseText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="glass-panel"
      style={{
        padding: '18px 22px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: '280px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        position: 'relative'
      }}
    >
      {/* Question Header Banner */}
      <div style={{ paddingBottom: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MessageSquare size={13} color="#10b981" /> DETECTED QUESTION
          </span>

          <span style={{ fontSize: '0.72rem', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', padding: '2px 8px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
            <Zap size={11} /> Latency: {latencyMs || 180}ms
          </span>
        </div>

        <h2 style={{ fontSize: '1.08rem', fontWeight: 600, color: '#f3f4f6', margin: 0, lineHeight: 1.35 }}>
          {activeQuestion || 'Listening for interviewer question...'}
        </h2>
      </div>

      {/* Main Eye-Level Teleprompter Answer Output */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: responseText ? 'flex-start' : 'center' }}>
        {!responseText && !isGenerating ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 16px' }}>
            <Sparkles size={36} color="#10b981" style={{ opacity: 0.85, marginBottom: '8px' }} />
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#e5e7eb', margin: 0 }}>Copilot Teleprompter Ready</p>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: '4px', margin: 0 }}>Answers stream right here at eye-level with your webcam.</p>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '0.04em' }}>
                <Sparkles size={13} /> LIVE TELEPROMPTER RESPONSE
              </span>

              <button onClick={handleCopy} className="btn-secondary" style={{ padding: '3px 8px', fontSize: '0.72rem' }}>
                {copied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div style={{
              background: 'rgba(5, 15, 25, 0.65)',
              padding: '16px 20px',
              borderRadius: '10px',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              fontSize: 'clamp(0.95rem, 1vw + 0.6rem, 1.12rem)',
              fontWeight: 500,
              lineHeight: 1.65,
              color: '#f9fafb',
              whiteSpace: 'pre-wrap',
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
              maxHeight: 'calc(100vh - 220px)',
              overflowY: 'auto'
            }}>
              {responseText}
              {isGenerating && (
                <span style={{ display: 'inline-block', width: '8px', height: '18px', background: '#10b981', marginLeft: '6px', animation: 'pulse 0.8s infinite' }} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
