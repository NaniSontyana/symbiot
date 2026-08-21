import React, { useState } from 'react';
import { Zap, Copy, Check, Sparkles, Code, Terminal, MessageSquare } from 'lucide-react';

export default function CopilotAnswerCard({ activeQuestion, responseText, isGenerating, latencyMs }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!responseText) return;
    navigator.clipboard.writeText(responseText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="glass-panel" style={{ padding: '24px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '380px' }}>
      {/* Question Banner */}
      <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--panel-border)', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MessageSquare size={14} color="#10b981" /> Detected Question
          </span>

          <span style={{ fontSize: '0.75rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '2px 8px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Zap size={12} /> Latency: {latencyMs || 180}ms
          </span>
        </div>

        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff' }}>
          {activeQuestion || 'Waiting for interviewer question...'}
        </h2>
      </div>

      {/* Answer Output Stream */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: responseText ? 'flex-start' : 'center' }}>
        {!responseText && !isGenerating ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px' }}>
            <Sparkles size={36} color="var(--primary-accent)" style={{ opacity: 0.6, marginBottom: '12px' }} />
            <p style={{ fontSize: '0.95rem', fontWeight: 500 }}>Symbiot AI Copilot is Standing By</p>
            <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>Speak into your mic or select a sample question below to test live answer generation.</p>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={14} /> AI Suggested Response
              </span>

              <button onClick={handleCopy} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
                {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '16px',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: '0.95rem',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              fontFamily: 'Inter, sans-serif'
            }}>
              {responseText}
              {isGenerating && (
                <span style={{ display: 'inline-block', width: '8px', height: '16px', background: '#10b981', marginLeft: '4px', animation: 'pulse 1s infinite' }} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
