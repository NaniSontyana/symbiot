import React, { useState } from 'react';
import { GEMINI_MODELS } from '../lib/models';
import { Mic, MicOff, Radio, Bot, Eye, ChevronDown, Volume2, User } from 'lucide-react';

const chipStyle = (active) => ({
  padding: '4px 10px',
  fontSize: '0.72rem',
  fontWeight: active ? 700 : 600,
  borderRadius: '6px',
  border: active ? '1px solid #ffffff' : '1px solid #262626',
  background: active ? '#ffffff' : '#0a0a0a',
  color: active ? '#000000' : '#a3a3a3',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
});

const DIAR_STATUS_TEXT = {
  ready: 'Separate the two voices automatically (one microphone)',
  loading: 'Voice separation model is loading…',
  error: 'Voice separation model failed to load (see asr-service /health)',
  too_slow: 'This computer is too slow for live voice separation (a GPU helps). Using the manual toggle.',
};

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
  onSwitchSpeaker,
  isSystemAudioActive = false,
  asrStatus = null,
  speakerMode = 'auto',
  onChangeSpeakerMode,
  diarStatus = null,
  onAssignLastSpeaker,
  audioDevices = [],
  selectedMicId = '',
  onSwitchMicrophone,
  isSwitchingMic = false
}) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);

  const opacityPresets = [0.35, 0.6, 0.85, 1.0];

  // Voice separation is used in mic-only mode when chosen and the service's diarizer is ready
  const autoSeparation = !isSystemAudioActive && speakerMode === 'auto' && diarStatus === 'ready';

  const modelList = [
    ...GEMINI_MODELS,
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
          disabled={isSwitchingMic}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: 'none',
            background: isSwitchingMic ? '#333333' : isStreaming ? '#ffffff' : '#171717',
            color: isStreaming ? '#000000' : '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isSwitchingMic ? 'wait' : 'pointer',
            boxShadow: isStreaming && !isSwitchingMic ? '0 0 14px rgba(255, 255, 255, 0.4)' : 'none',
            transition: 'all 0.2s ease',
            flexShrink: 0,
            opacity: isSwitchingMic ? 0.6 : 1
          }}
          title={isSwitchingMic ? 'Switching microphone…' : isStreaming ? "Microphone ON (Click to mute)" : "Microphone OFF (Click to turn ON)"}
        >
          {isStreaming ? <Mic size={18} color="#000000" /> : <MicOff size={16} color="#ffffff" />}
        </button>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff' }}>
              {isSwitchingMic ? 'Switching Mic…' : isStreaming ? 'Microphone LIVE' : 'Mic Off'}
            </span>
            {audioDevices.length > 1 && (
              <select
                value={selectedMicId}
                onChange={(e) => onSwitchMicrophone && onSwitchMicrophone(e.target.value)}
                disabled={isSwitchingMic}
                style={{
                  padding: '2px 6px',
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: isSwitchingMic ? '1px solid #ffffff' : '1px solid #404040',
                  color: '#ffffff',
                  background: isSwitchingMic ? '#262626' : '#171717',
                  cursor: isSwitchingMic ? 'wait' : 'pointer',
                  outline: 'none',
                  maxWidth: '160px',
                  opacity: isSwitchingMic ? 0.5 : 1,
                  transition: 'all 0.2s ease'
                }}
                title="Select Microphone Hardware Device"
              >
                {audioDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId} style={{ background: '#000000', color: '#ffffff' }}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            {isSwitchingMic && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#171717', padding: '2px 10px', borderRadius: '10px', border: '1px solid #525252' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#ffffff',
                    animation: 'pulse 0.8s ease-in-out infinite alternate'
                  }}
                />
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#ffffff' }}>
                  SWITCHING…
                </span>
              </div>
            )}
            {!isSwitchingMic && isStreaming && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#171717', padding: '2px 8px', borderRadius: '10px', border: '1px solid #404040' }}>
                {/* 5-Bar Live Animated Audio Signal Level Meter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', height: '12px' }}>
                  {[0.4, 0.8, 1.0, 0.7, 0.5].map((factor, idx) => {
                    const h = Math.max(3, Math.min(12, Math.round((audioLevel || 0) * 0.12 * factor)));
                    return (
                      <span
                        key={idx}
                        style={{
                          width: '2px',
                          height: `${h}px`,
                          borderRadius: '1px',
                          background: audioLevel > 3 ? '#ffffff' : '#666666',
                          transition: 'height 0.05s ease',
                        }}
                      />
                    );
                  })}
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Radio size={10} color="#ffffff" /> LIVE SIGNAL
                </span>
              </div>
            )}
          </div>
          {asrStatus && asrStatus !== 'ready' && (
            <p style={{ fontSize: '0.68rem', color: asrStatus === 'error' ? '#f87171' : '#a3a3a3', margin: 0 }}>
              {asrStatus === 'error' ? 'Speech model failed to load (see asr-service /health)' : 'Loading speech model…'}
            </p>
          )}
          {liveTranscript && (
            <p style={{ fontSize: '0.72rem', color: '#a3a3a3', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
              "{liveTranscript}"
            </p>
          )}
        </div>
      </div>

      {/* 2. Middle: Speaker segregation
          - system audio shared: by source (system audio = interviewer, mic = you)
          - mic only + Auto:     by voice (Streaming Sortformer diarization in asr-service)
          - mic only + Manual:   speaker toggle */}
      {isSystemAudioActive ? (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          title="Automatic speaker separation: system audio (meeting app) is the interviewer and is answered by the AI; your microphone is you and is never sent to the AI."
        >
          <span style={chipStyle(true)}>
            <Volume2 size={12} color="#000000" />
            <span>Interviewer · System audio</span>
          </span>
          <span style={chipStyle(false)}>
            <User size={12} color="#a3a3a3" />
            <span>You · Mic</span>
          </span>
        </div>
      ) : autoSeparation ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={chipStyle(true)}
            title="One microphone, two voices: speech is separated by voice. Only the interviewer's questions are sent to the AI."
          >
            <Radio size={12} color="#000000" />
            <span>Auto · by voice</span>
          </span>
          <button
            onClick={() => onAssignLastSpeaker && onAssignLastSpeaker('applicant')}
            style={{ ...chipStyle(false), cursor: 'pointer' }}
            title="The last line was you, not the interviewer: remember this voice as yours"
          >
            <User size={12} color="#a3a3a3" />
            <span>That was me</span>
          </button>
          <button
            onClick={() => onAssignLastSpeaker && onAssignLastSpeaker('interviewer')}
            style={{ ...chipStyle(false), cursor: 'pointer' }}
            title="The last line was the interviewer: remember this voice as the interviewer"
          >
            <Volume2 size={12} color="#a3a3a3" />
            <span>That was interviewer</span>
          </button>
          <button
            onClick={() => onChangeSpeakerMode && onChangeSpeakerMode('manual')}
            style={{ ...chipStyle(false), cursor: 'pointer', padding: '4px 8px' }}
            title="Switch to the manual speaker toggle"
          >
            Manual
          </button>
        </div>
      ) : (
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

        {diarStatus && diarStatus !== 'disabled' && (
          <button
            onClick={() => onChangeSpeakerMode && onChangeSpeakerMode('auto')}
            disabled={diarStatus !== 'ready'}
            style={{ ...chipStyle(false), cursor: diarStatus === 'ready' ? 'pointer' : 'not-allowed', opacity: diarStatus === 'ready' ? 1 : 0.6, padding: '4px 8px' }}
            title={DIAR_STATUS_TEXT[diarStatus] || 'Separate the two voices automatically'}
          >
            <Radio size={12} color="#a3a3a3" />
            <span>{diarStatus === 'loading' ? 'Auto (loading…)' : 'Auto'}</span>
          </button>
        )}
      </div>
      )}

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
