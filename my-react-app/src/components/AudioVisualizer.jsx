import React, { useState } from 'react';
import { Mic, MicOff, Radio, Bot, Eye, ChevronDown, Volume2, User } from 'lucide-react';

function AudioVisualizer({
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
        flexWrap: 'wrap',
        background: '#000000',
        border: '1px solid #262626'
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
            background: isStreaming ? '#ffffff' : '#171717',
            color: isStreaming ? '#000000' : '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: isStreaming ? '0 0 14px rgba(255, 255, 255, 0.4)' : 'none',
            transition: 'all 0.2s ease',
            flexShrink: 0
          }}
          title={isStreaming ? "Microphone ON (Click to mute)" : "Microphone OFF (Click to turn ON)"}
        >
          {isStreaming ? <Mic size={18} color="#000000" /> : <MicOff size={16} color="#ffffff" />}
        </button>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff' }}>
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
                  color: '#ffffff',
                  background: '#171717',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  border: '1px solid #404040'
                }}
              >
                <Radio size={10} color="#ffffff" /> LIVE ON
              </span>
            )}
          </div>
          {liveTranscript && (
            <p style={{ fontSize: '0.72rem', color: '#a3a3a3', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
              "{liveTranscript}"
            </p>
          )}
        </div>
      </div>

      {/* 2. Middle: Sequential Dual-Turn Speaker Protocol Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <button
          onClick={() => onSwitchSpeaker && onSwitchSpeaker('interviewer')}
          style={{
            padding: '4px 10px',
            fontSize: '0.72rem',
            fontWeight: activeSpeaker === 'interviewer' ? 700 : 500,
            borderRadius: '6px',
            border: activeSpeaker === 'interviewer' ? '1px solid #ffffff' : '1px solid #262626',
            background: activeSpeaker === 'interviewer' ? '#ffffff' : '#0a0a0a',
            color: activeSpeaker === 'interviewer' ? '#000000' : '#a3a3a3',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          title="Step 1: Listening for Interviewer Question"
        >
          <Volume2 size={12} color={activeSpeaker === 'interviewer' ? '#000000' : '#a3a3a3'} />
          <span>1. Listening for Interviewer</span>
        </button>

        <button
          onClick={() => onSwitchSpeaker && onSwitchSpeaker('applicant')}
          style={{
            padding: '4px 10px',
            fontSize: '0.72rem',
            fontWeight: activeSpeaker === 'applicant' ? 700 : 500,
            borderRadius: '6px',
            border: activeSpeaker === 'applicant' ? '1px solid #ffffff' : '1px solid #262626',
            background: activeSpeaker === 'applicant' ? '#ffffff' : '#0a0a0a',
            color: activeSpeaker === 'applicant' ? '#000000' : '#a3a3a3',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
          title="Step 2: Candidate Answering (Click when done speaking)"
        >
          <User size={12} color={activeSpeaker === 'applicant' ? '#000000' : '#a3a3a3'} />
          <span>2. Candidate Answering</span>
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
              border: '1px solid #333333',
              color: '#ffffff',
              background: '#000000',
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            {modelList.map((m) => (
              <option key={m.id} value={m.id} style={{ background: '#000000', color: '#ffffff' }}>
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
            style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', color: '#ffffff', border: '1px solid #333333' }}
          >
            <Eye size={13} color="#ffffff" />
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
                background: '#000000',
                border: '1px solid #404040',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.9)'
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
                      border: opacity === val ? '1px solid #ffffff' : '1px solid #333333',
                      background: opacity === val ? '#ffffff' : '#0a0a0a',
                      color: opacity === val ? '#000000' : '#ffffff',
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
      </div>
    </div>
  );
}

export default React.memo(AudioVisualizer);
