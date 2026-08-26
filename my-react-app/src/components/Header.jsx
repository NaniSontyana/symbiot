import React, { useState, useEffect, useRef } from 'react';
import { Monitor, Mic, MicOff, MoreVertical, Move, ChevronDown, Maximize2, Minimize2, Settings, Trash2, Cpu, Check, Zap } from 'lucide-react';

const LLM_MODELS = [
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', badge: '180ms Fast', provider: 'Google AI' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', badge: 'Deep Reasoning', provider: 'Google AI' },
  { id: 'llama-3.3-70b-versatile', name: 'Groq Llama 3.3 70B', badge: '80ms Ultra', provider: 'Groq Cloud' },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', badge: 'Complex Code', provider: 'Anthropic' }
];

export default function Header({
  isStreaming,
  onToggleMic,
  audioLevel,
  isSystemAudioActive,
  onToggleSystemAudio,
  onTriggerAnswer,
  onTriggerScreenshot,
  onToggleChat,
  onOpenSettings,
  onCollapse,
  isFullscreen,
  onToggleFullscreen,
  onClearSession,
  selectedModel,
  setSelectedModel
}) {
  const [seconds, setSeconds] = useState(15);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [modelToast, setModelToast] = useState('');
  const dropdownRef = useRef(null);
  const modelMenuRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Click outside listener for 3-dots dropdown popover and model menu dismissal
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setShowModelMenu(false);
      }
    };
    if (showDropdown || showModelMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown, showModelMenu]);

  const handleSelectModel = (modelId, modelName) => {
    if (setSelectedModel) setSelectedModel(modelId);
    setModelToast(`Active Model: ${modelName}`);
    setTimeout(() => setModelToast(''), 2500);
  };

  const formatTimer = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <header
      className="top-pill-bar"
      onDoubleClick={onToggleFullscreen}
      style={{
        margin: '0 auto 12px auto',
        width: '100%',
        maxWidth: '920px',
        WebkitAppRegion: 'drag',
        cursor: 'grab',
        position: 'relative'
      }}
    >
      {/* Active Model Switch Toast */}
      {modelToast && (
        <div style={{
          position: 'absolute',
          top: '-38px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(16, 185, 129, 0.95)',
          color: '#ffffff',
          fontSize: '0.78rem',
          fontWeight: 600,
          padding: '4px 14px',
          borderRadius: '9999px',
          boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          zIndex: 1100
        }}>
          <Zap size={13} /> {modelToast}
        </div>
      )}

      {/* 1. Left Group: Audio Visualizer, System Audio & Mic */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' }}>
        {/* Dynamic Green Equalizer Bars */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '18px', padding: '0 4px' }} title="Voice Audio Activity">
          <span style={{
            width: '3px',
            height: `${Math.max(6, Math.min(16, (audioLevel || 0) * 0.35))}px`,
            background: isStreaming ? '#34d399' : 'rgba(255,255,255,0.3)',
            borderRadius: '2px',
            transition: 'height 0.08s ease'
          }} />
          <span style={{
            width: '3px',
            height: `${Math.max(10, Math.min(20, (audioLevel || 0) * 0.65))}px`,
            background: isStreaming ? '#10b981' : 'rgba(255,255,255,0.3)',
            borderRadius: '2px',
            transition: 'height 0.08s ease'
          }} />
          <span style={{
            width: '3px',
            height: `${Math.max(8, Math.min(18, (audioLevel || 0) * 0.5))}px`,
            background: isStreaming ? '#34d399' : 'rgba(255,255,255,0.3)',
            borderRadius: '2px',
            transition: 'height 0.08s ease'
          }} />
        </div>

        {/* System Audio Desktop Share Button */}
        <button
          onClick={onToggleSystemAudio}
          className="pill-action-btn"
          style={{
            padding: '5px 8px',
            borderColor: isSystemAudioActive ? '#34d399' : 'rgba(255,255,255,0.12)',
            color: isSystemAudioActive ? '#34d399' : '#f3f4f6',
            background: isSystemAudioActive ? 'rgba(52, 211, 153, 0.2)' : 'rgba(255,255,255,0.06)'
          }}
          title={isSystemAudioActive ? "System Desktop Audio Active (Click to stop)" : "Capture System Desktop Audio (Zoom/Meet)"}
        >
          <Monitor size={15} />
        </button>

        {/* Microphone Button */}
        <button
          onClick={onToggleMic}
          className="pill-action-btn"
          style={{
            padding: '5px 8px',
            borderColor: isStreaming ? '#10b981' : 'rgba(255,255,255,0.12)',
            color: isStreaming ? '#10b981' : '#f3f4f6',
            background: isStreaming ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.06)'
          }}
          title={isStreaming ? "Microphone ON" : "Microphone OFF"}
        >
          {isStreaming ? <Mic size={15} color="#10b981" /> : <MicOff size={15} color="rgba(255,255,255,0.6)" />}
        </button>
      </div>

      {/* 2. Center Group: Action Pills & Dedicated AI Model Switcher Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag', position: 'relative' }}>
        <button onClick={onTriggerAnswer} className="pill-action-btn">
          Answer <span className="key-badge">⌘↵</span>
        </button>

        <button onClick={onTriggerScreenshot} className="pill-action-btn">
          Screenshot <span className="key-badge">⌘⇧↵</span>
        </button>

        <button onClick={onToggleChat} className="pill-action-btn">
          Chat <span className="key-badge">⌘⇧_</span>
        </button>

        {/* Dedicated AI Model Switcher Pill Button */}
        <button
          onClick={() => setShowModelMenu(!showModelMenu)}
          className="pill-action-btn"
          style={{
            borderColor: showModelMenu ? '#34d399' : 'rgba(52, 211, 153, 0.4)',
            color: '#34d399',
            background: 'rgba(52, 211, 153, 0.12)'
          }}
          title="Switch AI LLM Engine (Gemini / Groq Llama / Claude)"
        >
          <Cpu size={13} color="#34d399" />
          <span>{LLM_MODELS.find(m => m.id === selectedModel)?.name || 'Gemini 1.5 Flash'}</span>
          <ChevronDown size={13} />
        </button>

        {/* Dedicated Model Selector Popover Menu */}
        {showModelMenu && (
          <div
            ref={modelMenuRef}
            style={{
              position: 'absolute',
              top: '36px',
              right: '0',
              width: '260px',
              background: 'rgba(15, 23, 42, 0.98)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              borderRadius: '14px',
              padding: '10px',
              boxShadow: '0 16px 40px rgba(0,0,0,0.9)',
              zIndex: 1200,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ padding: '4px 8px', fontSize: '0.72rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Cpu size={13} color="#34d399" /> AI Model Engine</span>
              <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>Select Model</span>
            </div>

            {LLM_MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  handleSelectModel(model.id, model.name);
                  setShowModelMenu(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: selectedModel === model.id ? 'rgba(52, 211, 153, 0.22)' : 'transparent',
                  border: selectedModel === model.id ? '1px solid rgba(52, 211, 153, 0.45)' : '1px solid transparent',
                  color: selectedModel === model.id ? '#34d399' : '#e2e8f0',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: selectedModel === model.id ? 600 : 400,
                  textAlign: 'left',
                  width: '100%',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  if (selectedModel !== model.id) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                }}
                onMouseLeave={(e) => {
                  if (selectedModel !== model.id) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selectedModel === model.id ? <Check size={14} color="#34d399" /> : <div style={{ width: '14px' }} />}
                  <div>
                    <div>{model.name}</div>
                    <div style={{ fontSize: '0.65rem', color: '#9ca3af' }}>{model.provider}</div>
                  </div>
                </div>
                <span style={{ fontSize: '0.65rem', background: 'rgba(0,0,0,0.45)', padding: '2px 6px', borderRadius: '4px', color: selectedModel === model.id ? '#34d399' : '#9ca3af', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {model.badge}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. Right Group: Timer Counter & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag', position: 'relative' }} ref={dropdownRef}>
        {/* Timer Badge matching 0:15 screenshot format */}
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.9)', padding: '0 4px' }}>
          {formatTimer(seconds)}
        </span>

        {/* Options Button (kebab menu ⋮) with Dropdown Popover */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="pill-action-btn"
          style={{ padding: '5px 7px', borderColor: showDropdown ? '#34d399' : 'rgba(255,255,255,0.14)' }}
          title="Options & Settings"
        >
          <MoreVertical size={15} color={showDropdown ? "#34d399" : "#fff"} />
        </button>

        {/* Options Dropdown Menu containing Fullscreen, Model Switcher & Settings */}
        {showDropdown && (
          <div style={{
            position: 'absolute',
            top: '36px',
            right: '0',
            width: '250px',
            background: 'rgba(15, 23, 42, 0.97)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            borderRadius: '14px',
            padding: '8px',
            boxShadow: '0 14px 40px rgba(0,0,0,0.9)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            {/* Fullscreen Option */}
            <button
              type="button"
              onClick={() => {
                setShowDropdown(false);
                if (onToggleFullscreen) onToggleFullscreen();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                background: 'transparent',
                border: 'none',
                color: '#f1f5f9',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: 500,
                textAlign: 'left',
                width: '100%'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(52, 211, 153, 0.15)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {isFullscreen ? <Minimize2 size={14} color="#34d399" /> : <Maximize2 size={14} color="#34d399" />}
              <span>{isFullscreen ? "Exit Fullscreen Mode" : "Toggle Full Screen"}</span>
            </button>

            {/* Divider */}
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

            {/* Model Switching Section Header */}
            <div style={{ padding: '4px 8px', fontSize: '0.72rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Cpu size={13} color="#34d399" /> AI LLM Model Selection
            </div>

            {/* Model Options List with Active Check & Provider Badges */}
            {LLM_MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => handleSelectModel(model.id, model.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: selectedModel === model.id ? 'rgba(52, 211, 153, 0.2)' : 'transparent',
                  border: selectedModel === model.id ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid transparent',
                  color: selectedModel === model.id ? '#34d399' : '#e2e8f0',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: selectedModel === model.id ? 600 : 400,
                  textAlign: 'left',
                  width: '100%',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  if (selectedModel !== model.id) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                }}
                onMouseLeave={(e) => {
                  if (selectedModel !== model.id) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {selectedModel === model.id ? <Check size={14} color="#34d399" /> : <div style={{ width: '14px' }} />}
                  <span>{model.name}</span>
                </div>
                <span style={{ fontSize: '0.65rem', background: 'rgba(0,0,0,0.45)', padding: '2px 6px', borderRadius: '4px', color: selectedModel === model.id ? '#34d399' : '#9ca3af', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {model.badge}
                </span>
              </button>
            ))}

            {/* Divider */}
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

            {/* Resume & Context Settings Option */}
            <button
              type="button"
              onClick={() => {
                setShowDropdown(false);
                if (onOpenSettings) onOpenSettings();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                background: 'transparent',
                border: 'none',
                color: '#f1f5f9',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: 500,
                textAlign: 'left',
                width: '100%'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(52, 211, 153, 0.15)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Settings size={14} color="#34d399" />
              <span>Resume & Context Settings</span>
            </button>

            {/* Clear Session Option */}
            {onClearSession && (
              <button
                type="button"
                onClick={() => {
                  setShowDropdown(false);
                  onClearSession();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  background: 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  textAlign: 'left',
                  width: '100%'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <Trash2 size={14} color="#ef4444" />
                <span>Clear Transcript Buffer</span>
              </button>
            )}
          </div>
        )}

        {/* Drag Handle */}
        <button className="pill-action-btn" style={{ padding: '5px 7px', cursor: 'grab' }} title="Drag Window">
          <Move size={15} />
        </button>

        {/* Collapse Button */}
        <button onClick={onCollapse} className="pill-action-btn" style={{ padding: '5px 7px' }} title="Collapse Window">
          <ChevronDown size={15} />
        </button>
      </div>
    </header>
  );
}
