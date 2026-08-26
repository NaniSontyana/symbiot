import React, { useState } from 'react';
import { SlidersHorizontal, CornerDownLeft, X, ArrowLeft, ArrowRight, Camera, Trash2 } from 'lucide-react';

export default function CopilotAnswerCard({
  activeQuestion,
  responseText,
  isGenerating,
  onSendMessage,
  onClearSession,
  onAddScreenshot,
  onOpenSettings,
  onClose,
  onPrevHistory,
  onNextHistory,
  screenshotAttached,
  inputRef,
  opacity,
  setOpacity,
  stealthMode,
  setStealthMode,
  bgMode,
  setBgMode
}) {
  const [inputText, setInputText] = useState('');
  const [showStealthPopover, setShowStealthPopover] = useState(false);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    if (onSendMessage) {
      onSendMessage(inputText.trim());
    }
    setInputText('');
  };

  // Convert raw STAR response into clean bulleted output matching the target screenshot
  const formatResponse = (text) => {
    if (!text) return null;

    const lines = text.split('\n').filter(Boolean);
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
        return (
          <li key={idx} style={{ marginBottom: '8px', color: '#e2e8f0', listStyleType: 'disc' }}>
            {trimmed.replace(/^[-*•]\s*/, '')}
          </li>
        );
      }
      return (
        <p key={idx} style={{ marginBottom: '12px', color: '#f1f5f9', lineHeight: 1.6 }}>
          {trimmed}
        </p>
      );
    });
  };

  return (
    <div
      className="glass-panel"
      style={{
        padding: '16px 20px',
        width: '100%',
        maxWidth: '920px',
        margin: '0 auto',
        borderRadius: '16px',
        background: 'rgba(15, 23, 42, 0.88)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        position: 'relative'
      }}
    >
      {/* 1. Sub-Header Action Bar matching screenshot */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Navigation History Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={onPrevHistory} className="pill-action-btn" style={{ padding: '4px 10px' }} title="Previous Question (⌘←)">
            ⌘←
          </button>
          <button onClick={onNextHistory} className="pill-action-btn" style={{ padding: '4px 10px' }} title="Next Question (⌘→)">
            ⌘→
          </button>
        </div>

        {/* Right Actions: Add Screenshot, Clear, Close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={onAddScreenshot} className="pill-action-btn" style={{ borderColor: screenshotAttached ? '#34d399' : 'rgba(255,255,255,0.14)' }}>
            <Camera size={13} color={screenshotAttached ? "#34d399" : "#fff"} />
            Add Screenshot <span className="key-badge">⌘⌥↵</span>
          </button>

          <button onClick={onClearSession} className="pill-action-btn">
            Clear <span className="key-badge">⌘⌫</span>
          </button>

          <button
            onClick={onClose || onClearSession}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            title="Close Panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Screenshot Attached Preview Tag */}
      {screenshotAttached && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', padding: '3px 10px', borderRadius: '6px', border: '1px solid rgba(52, 211, 153, 0.3)', width: 'fit-content' }}>
          <Camera size={12} /> Active Screen Capture Snippet Attached
        </div>
      )}

      {/* 2. Message Input Bar matching screenshot with Stealth Adjuster Popover */}
      <form onSubmit={handleSend} style={{ position: 'relative', width: '100%' }}>
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Enter a message..."
          style={{
            width: '100%',
            padding: '12px 70px 12px 16px',
            fontSize: '0.94rem',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            background: 'rgba(5, 12, 22, 0.65)',
            color: '#ffffff',
            outline: 'none',
            transition: 'border-color 0.2s ease'
          }}
        />

        <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SlidersHorizontal
            size={16}
            color={showStealthPopover ? "#10b981" : "#34d399"}
            style={{ cursor: 'pointer', transition: 'color 0.2s ease' }}
            onClick={() => setShowStealthPopover(!showStealthPopover)}
            title="Adjust Stealth & Overlay Transparency"
          />
          <button
            type="submit"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#34d399',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center'
            }}
            title="Send Message (↵)"
          >
            <CornerDownLeft size={16} />
          </button>
        </div>

        {/* Inline Stealth & Opacity Adjuster Popover */}
        {showStealthPopover && (
          <div style={{
            position: 'absolute',
            bottom: '50px',
            right: '0',
            width: '260px',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(52, 211, 153, 0.3)',
            borderRadius: '12px',
            padding: '14px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', fontWeight: 600, color: '#34d399' }}>
              <span>Stealth & Transparency</span>
              <button type="button" onClick={() => setShowStealthPopover(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
                <X size={14} />
              </button>
            </div>

            {/* Opacity Slider */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#9ca3af', marginBottom: '4px' }}>
                <span>Overlay Opacity</span>
                <span>{Math.round((opacity || 0.85) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={opacity || 0.85}
                onChange={(e) => setOpacity && setOpacity(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#10b981', cursor: 'pointer' }}
              />
            </div>

            {/* Stealth Mode Toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#e2e8f0' }}>
              <span>Stealth Screen Mode</span>
              <button
                type="button"
                onClick={() => setStealthMode && setStealthMode(!stealthMode)}
                style={{
                  padding: '3px 8px',
                  fontSize: '0.7rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: stealthMode ? 'rgba(52, 211, 153, 0.25)' : 'rgba(255,255,255,0.06)',
                  color: stealthMode ? '#34d399' : '#9ca3af',
                  cursor: 'pointer'
                }}
              >
                {stealthMode ? 'ACTIVE' : 'OFF'}
              </button>
            </div>

            {/* Background Mode Toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#e2e8f0' }}>
              <span>Background Blur</span>
              <button
                type="button"
                onClick={() => setBgMode && setBgMode(bgMode === 'transparent' ? 'dark' : 'transparent')}
                style={{
                  padding: '3px 8px',
                  fontSize: '0.7rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: bgMode === 'dark' ? 'rgba(52, 211, 153, 0.25)' : 'rgba(255,255,255,0.06)',
                  color: bgMode === 'dark' ? '#34d399' : '#9ca3af',
                  cursor: 'pointer'
                }}
              >
                {bgMode === 'dark' ? 'DARK' : 'GLASS'}
              </button>
            </div>
          </div>
        )}
      </form>

      {/* 3. Response Content Box matching target screenshot formatting */}
      <div
        style={{
          background: 'rgba(3, 8, 16, 0.75)',
          padding: '20px 24px',
          borderRadius: '12px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          fontSize: '0.96rem',
          lineHeight: 1.65,
          color: '#e2e8f0',
          maxHeight: 'calc(100vh - 220px)',
          overflowY: 'auto'
        }}
      >
        {responseText ? (
          <ul style={{ paddingLeft: '20px', margin: 0 }}>
            {formatResponse(responseText)}
          </ul>
        ) : (
          <div style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
            <p style={{ marginBottom: '12px' }}>
              Lorem ipsum dolor sit amet consectetur. In arcu vivamus orci scelerisque purus sed et. Nisi cursus tortor commodo nibh velit nulla. Metus mauris diam id scelerisque commodo in faucibus purus. Lacus proin ipsum sed iaculis eget nunc eu imperdiet.
            </p>
            <ul style={{ paddingLeft: '20px', margin: 0 }}>
              <li style={{ marginBottom: '8px' }}>Lorem ipsum dolor sit amet consectetur.</li>
              <li style={{ marginBottom: '8px' }}>In arcu vivamus orci scelerisque purus sed et.</li>
              <li style={{ marginBottom: '8px' }}>Nisi cursus tortor commodo nibh velit nulla.</li>
              <li>Metus mauris diam id scelerisque commodo in faucibus purus.</li>
            </ul>
          </div>
        )}

        {isGenerating && (
          <span style={{ display: 'inline-block', width: '8px', height: '18px', background: '#34d399', marginLeft: '6px', borderRadius: '2px', animation: 'pulse 0.8s infinite' }} />
        )}
      </div>
    </div>
  );
}
