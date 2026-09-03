import React, { useState, useRef } from 'react';
import { Maximize2, X } from 'lucide-react';
import SymbiotLogo from './SymbiotLogo';

function FloatingPoint({ onExpand, onExitApp, isGenerating, isStreaming, stealthMode }) {
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const [isDragging, setIsDragging] = useState(false);
  const isMovedRef = useRef(false);
  const startPosRef = useRef({ startX: 0, startY: 0, initialX: 24, initialY: 24 });

  // Handle Dragging in Browser Mode
  const handleDragStart = (e) => {
    if (e.button !== 0) return;

    isMovedRef.current = false;
    startPosRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };

    setIsDragging(true);

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startPosRef.current.startX;
      const deltaY = moveEvent.clientY - startPosRef.current.startY;

      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        isMovedRef.current = true;
      }

      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 210, startPosRef.current.initialX + deltaX)),
        y: Math.max(10, Math.min(window.innerHeight - 70, startPosRef.current.initialY + deltaY)),
      });
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleExpandClick = (e) => {
    if (e) e.stopPropagation();
    if (onExpand) {
      onExpand();
    }
  };

  return (
    <div
      onMouseDown={handleDragStart}
      className="glass-panel"
      style={{
        position: window.electronAPI ? 'relative' : 'fixed',
        left: window.electronAPI ? '0' : `${position.x}px`,
        top: window.electronAPI ? '0' : `${position.y}px`,
        width: window.electronAPI ? '100%' : 'auto',
        height: window.electronAPI ? '100%' : 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '6px 10px',
        borderRadius: window.electronAPI ? '10px' : '26px',
        border: '1px solid #333333',
        background: '#000000',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.9)',
        backdropFilter: 'blur(16px)',
        WebkitAppRegion: 'drag',
        zIndex: 9999,
        userSelect: 'none',
        boxSizing: 'border-box'
      }}
    >
      {/* Clickable Main Content Region (No-Drag for instant response) */}
      <div
        onClick={handleExpandClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          WebkitAppRegion: 'no-drag',
          flex: 1
        }}
        title="Click to expand/open window"
      >
        {!stealthMode && (
          <SymbiotLogo size={24} />
        )}

        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
            Symbiot
            {isStreaming && (
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#ffffff',
                display: 'inline-block',
                boxShadow: '0 0 6px #ffffff'
              }} />
            )}
          </div>
          <span style={{ fontSize: '0.66rem', color: '#a3a3a3' }}>
            {isGenerating ? 'Generating Answer...' : 'Click to Open Teleprompter'}
          </span>
        </div>
      </div>

      {/* Action Buttons (No-Drag) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', WebkitAppRegion: 'no-drag' }}>
        {/* Explicit Expand / Open Button */}
        <button
          onClick={handleExpandClick}
          style={{
            border: '1px solid #333333',
            background: '#0a0a0a',
            color: '#ffffff',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '0.7rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer'
          }}
          title="Open Full Window"
        >
          <Maximize2 size={12} color="#ffffff" />
          <span>Open</span>
        </button>

        {/* Exit Application Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onExitApp) onExitApp();
          }}
          style={{
            border: '1px solid #404040',
            background: '#0a0a0a',
            color: '#ffffff',
            borderRadius: '6px',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          title="Close Application"
        >
          <X size={13} color="#ffffff" />
        </button>
      </div>
    </div>
  );
}

export default React.memo(FloatingPoint);
