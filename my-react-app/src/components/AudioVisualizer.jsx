import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Radio, Bot, Eye, ChevronDown, SunMedium, Moon } from 'lucide-react';

export default function AudioVisualizer({
  isStreaming,
  onToggleMic,
  audioLevel,
  liveTranscript,
  selectedModel,
  setSelectedModel,
  opacity,
  setOpacity,
  bgMode,
  setBgMode
}) {
  const [bars, setBars] = useState([20, 40, 15, 60, 30, 70, 45, 25, 80, 50, 35, 65, 20]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);

  const opacityPresets = [0.35, 0.6, 0.85, 1.0];

  const modelList = [
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', badge: 'Ultra Fast' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', badge: 'Deep Reasoning' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', badge: 'Next-Gen' },
    { id: 'gpt-4o', name: 'OpenAI GPT-4o', badge: 'High Intelligence' },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', badge: 'Coding Leader' },
  ];

  const activeModelObj = modelList.find((m) => m.id === selectedModel) || modelList[0];

  useEffect(() => {
    if (!isStreaming) return;

    const baseLevel = Math.max(15, audioLevel || 20);
    const interval = setInterval(() => {
      setBars((prev) => prev.map(() => Math.floor(Math.random() * baseLevel * 0.8) + 15));
    }, 100);

    return () => clearInterval(interval);
  }, [isStreaming, audioLevel]);

  return (
    <div
      className="glass-panel"
      style={{
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        position: 'relative'
      }}
    >
      {/* Floating Control Bar Floating Directly Above Mic Section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '10px' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Live Audio Controls & AI Engine
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', WebkitAppRegion: 'no-drag' }}>
          {/* Floating AI Model Changer */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowModelMenu(!showModelMenu)}
              className="btn-secondary"
              style={{
                padding: '5px 12px',
                fontSize: '0.8rem',
                borderColor: 'rgba(59, 130, 246, 0.4)',
                color: '#60a5fa',
                background: 'rgba(59, 130, 246, 0.12)'
              }}
            >
              <Bot size={14} />
              {activeModelObj.name}
              <ChevronDown size={12} />
            </button>

            {showModelMenu && (
              <div
                className="glass-panel"
                style={{
                  position: 'absolute',
                  top: '115%',
                  right: 0,
                  padding: '8px',
                  width: '230px',
                  zIndex: 200,
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)'
                }}
              >
                <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', padding: '4px 8px', textTransform: 'uppercase' }}>
                  Select Active AI Model
                </p>

                {modelList.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedModel(m.id);
                      setShowModelMenu(false);
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderRadius: '6px',
                      border: 'none',
                      background: selectedModel === m.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                      color: selectedModel === m.id ? '#60a5fa' : 'var(--text-main)',
                      fontSize: '0.78rem',
                      fontWeight: selectedModel === m.id ? 600 : 400,
                      cursor: 'pointer',
                      marginBottom: '2px',
                      textAlign: 'left'
                    }}
                  >
                    <span>{m.name}</span>
                    <span style={{ fontSize: '0.65rem', opacity: 0.8, padding: '2px 6px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.1)' }}>
                      {m.badge}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Floating Opacity Optimizer */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowOpacitySlider(!showOpacitySlider)}
              className="btn-secondary"
              style={{
                padding: '5px 12px',
                fontSize: '0.8rem',
                borderColor: opacity < 1.0 ? 'var(--primary-accent)' : 'var(--panel-border)',
                color: opacity < 1.0 ? 'var(--primary-accent)' : 'var(--text-main)'
              }}
            >
              <Eye size={14} />
              {Math.round(opacity * 100)}% Opacity
            </button>

            {showOpacitySlider && (
              <div
                className="glass-panel"
                style={{
                  position: 'absolute',
                  top: '115%',
                  right: 0,
                  padding: '14px',
                  width: '210px',
                  zIndex: 200,
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>Opacity</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#10b981' }}>{Math.round(opacity * 100)}%</span>
                </div>

                <input
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: '#10b981', cursor: 'pointer', marginBottom: '8px' }}
                />

                <div style={{ display: 'flex', gap: '4px', justifyContent: 'space-between' }}>
                  {opacityPresets.map((val) => (
                    <button
                      key={val}
                      onClick={() => setOpacity(val)}
                      style={{
                        padding: '2px 6px',
                        fontSize: '0.68rem',
                        borderRadius: '4px',
                        border: opacity === val ? '1px solid #10b981' : '1px solid var(--panel-border)',
                        background: opacity === val ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: opacity === val ? '#10b981' : 'var(--text-main)',
                        cursor: 'pointer'
                      }}
                    >
                      {Math.round(val * 100)}%
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Clear Glass Background Toggle */}
          <button
            onClick={() => setBgMode(bgMode === 'transparent' ? 'subtle_dark' : 'transparent')}
            className="btn-secondary"
            style={{
              padding: '5px 12px',
              fontSize: '0.8rem',
              borderColor: bgMode === 'transparent' ? 'var(--primary-accent)' : 'var(--panel-border)',
              color: bgMode === 'transparent' ? 'var(--primary-accent)' : 'var(--text-main)'
            }}
          >
            {bgMode === 'transparent' ? <SunMedium size={14} /> : <Moon size={14} />}
            {bgMode === 'transparent' ? 'Clear Canvas' : 'Dark Mode'}
          </button>
        </div>
      </div>

      {/* Mic Record Button & Audio Level Stream */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <button
            onClick={onToggleMic}
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              border: 'none',
              background: isStreaming ? '#ef4444' : 'var(--primary-accent)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: isStreaming ? '0 0 15px rgba(239, 68, 68, 0.4)' : '0 0 15px var(--primary-glow)',
              transition: 'all 0.2s ease'
            }}
          >
            {isStreaming ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {isStreaming ? 'Live Audio Stream Active (ASR)' : 'Click Mic to Start Audio Stream'}
              </span>
              {isStreaming && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.75rem',
                    color: '#ef4444',
                    fontWeight: 600,
                    background: 'rgba(239, 68, 68, 0.1)',
                    padding: '2px 8px',
                    borderRadius: '10px'
                  }}
                >
                  <Radio size={12} className="animate-pulse" /> LIVE STREAM
                </span>
              )}
            </div>
            <p
              style={{
                fontSize: '0.75rem',
                color: liveTranscript ? '#10b981' : 'var(--text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {liveTranscript ? `[ASR Detected]: "${liveTranscript}"` : 'Direct microphone to ASR speech pipeline'}
            </p>
          </div>
        </div>

        {/* Audio Waveform Animation Bars */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '36px' }}>
          {bars.map((height, i) => (
            <div
              key={i}
              style={{
                width: '4px',
                height: isStreaming ? `${height}%` : '8px',
                background: isStreaming ? 'linear-gradient(to top, #10b981, #34d399)' : 'rgba(255, 255, 255, 0.2)',
                borderRadius: '3px',
                transition: 'height 0.12s ease'
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
