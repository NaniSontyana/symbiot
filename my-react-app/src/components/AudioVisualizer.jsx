import React, { useState } from 'react';
import { Mic, MicOff, Radio, Bot, Eye, ChevronDown, SunMedium, Moon, Volume2, User } from 'lucide-react';

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
  setBgMode,
  activeSpeaker = 'interviewer',
  onSwitchSpeaker
}) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);

  const opacityPresets = [0.35, 0.6, 0.85, 1.0];

  const modelList = [
    { id: 'gemini-1.5-flash', name: 'Google Gemini Flash', badge: 'Active Free' },
    { id: 'groq/llama-3.3-70b', name: 'Groq Llama 3.3 70B', badge: 'Ultra Fast Free' },
    { id: 'openai/gpt-oss-120b', name: 'OpenAI GPT-OSS 120B', badge: 'OpenRouter Free' },
  ];

  const activeModelObj = modelList.find((m) => m.id === selectedModel) || modelList[0];

  return (
    <div
      className="glass-panel"
      style={{
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        zIndex: 50,
        gap: '12px',
        flexWrap: 'wrap'
      }}
    >
      {/* 1. Left: Mic Toggle & Live Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          onClick={onToggleMic}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: 'none',
            background: isStreaming ? '#10b981' : 'rgba(255, 255, 255, 0.12)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: isStreaming ? '0 0 16px rgba(16, 185, 129, 0.7)' : 'none',
            transition: 'all 0.2s ease',
            flexShrink: 0
          }}
          title={isStreaming ? "Microphone ON (Click to mute)" : "Microphone OFF (Click to turn ON)"}
        >
          {isStreaming ? <Mic size={18} color="#ffffff" /> : <MicOff size={16} color="rgba(255,255,255,0.6)" />}
        </button>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isStreaming ? '#10b981' : 'var(--text-main)' }}>
              {isStreaming ? 'Microphone LIVE' : 'Mic Off'}
            </span>
            {isStreaming && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: '#10b981',
                  background: 'rgba(16, 185, 129, 0.15)',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  border: '1px solid rgba(16, 185, 129, 0.3)'
                }}
              >
                <Radio size={10} className="pulse" /> LIVE ON
              </span>
            )}
          </div>
          {liveTranscript && (
            <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
              "{liveTranscript}"
            </p>
          )}
        </div>
      </div>

      {/* 2. Middle: Dual Channel Speaker Selector */}
      <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 0, 0, 0.35)', padding: '2px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <button
          onClick={() => onSwitchSpeaker && onSwitchSpeaker('interviewer')}
          style={{
            padding: '4px 10px',
            fontSize: '0.72rem',
            fontWeight: activeSpeaker === 'interviewer' ? 700 : 400,
            borderRadius: '6px',
            border: 'none',
            background: activeSpeaker === 'interviewer' ? '#10b981' : 'transparent',
            color: activeSpeaker === 'interviewer' ? '#fff' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Volume2 size={12} /> Interviewer
        </button>
        <button
          onClick={() => onSwitchSpeaker && onSwitchSpeaker('applicant')}
          style={{
            padding: '4px 10px',
            fontSize: '0.72rem',
            fontWeight: activeSpeaker === 'applicant' ? 700 : 400,
            borderRadius: '6px',
            border: 'none',
            background: activeSpeaker === 'applicant' ? '#3b82f6' : 'transparent',
            color: activeSpeaker === 'applicant' ? '#fff' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <User size={12} /> Applicant
        </button>
      </div>

      {/* 3. Right: AI Engine Model & Canvas Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {/* Standard Normal AI Model Select Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel && setSelectedModel(e.target.value)}
            style={{
              padding: '4px 8px',
              fontSize: '0.74rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              color: '#60a5fa',
              background: '#0f172a',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            {modelList.map((m) => (
              <option key={m.id} value={m.id} style={{ background: '#0f172a', color: '#ffffff' }}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Opacity Selector */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowOpacitySlider(!showOpacitySlider)}
            className="btn-secondary"
            style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <Eye size={13} />
            {Math.round((opacity || 0.85) * 100)}%
          </button>

          {showOpacitySlider && (
            <div
              className="glass-panel"
              style={{
                position: 'absolute',
                bottom: '120%',
                right: 0,
                padding: '8px',
                width: '170px',
                zIndex: 9999,
                background: '#0f172a',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.85)'
              }}
            >
              <div style={{ display: 'flex', gap: '4px', justifyContent: 'space-between' }}>
                {opacityPresets.map((val) => (
                  <button
                    key={val}
                    onClick={() => setOpacity && setOpacity(val)}
                    style={{
                      padding: '3px 6px',
                      fontSize: '0.65rem',
                      borderRadius: '4px',
                      border: opacity === val ? '1px solid #10b981' : '1px solid var(--panel-border)',
                      background: opacity === val ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
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

        {/* Theme Mode Toggle */}
        <button
          onClick={() => setBgMode && setBgMode(bgMode === 'transparent' ? 'subtle_dark' : 'transparent')}
          className="btn-secondary"
          style={{ padding: '4px 8px', fontSize: '0.75rem' }}
          title="Toggle Background Canvas Mode"
        >
          {bgMode === 'transparent' ? <SunMedium size={13} /> : <Moon size={13} />}
        </button>
      </div>
    </div>
  );
}
