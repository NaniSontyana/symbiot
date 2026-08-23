import React, { useState, useRef } from 'react';
import { Sparkles, ChevronDown, X } from 'lucide-react';
import SymbiotLogo from './SymbiotLogo';

export default function FloatingPoint({ onExpand, onExitApp, isGenerating, isStreaming, stealthMode }) {
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const [isDragging, setIsDragging] = useState(false);
  const isMovedRef = useRef(false);
  const startPosRef = useRef({ startX: 0, startY: 0, initialX: 24, initialY: 24 });

  // Handle Dragging in Browser Mode
  const handleDragStart = (e) => {
    // Left click only
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

  const handleClick = (e) => {
    e.stopPropagation();
    if (!isMovedRef.current) {
      onExpand();
    }
    isMovedRef.current = false;
  };

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    if (onExitApp) {
      onExitApp();
    }
  };

  return (
    <div
      onMouseDown={handleDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className="glass-panel"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 16px',
        borderRadius: '30px',
        cursor: isDragging ? 'grabbing' : 'pointer',
        border: '1px solid rgba(16, 185, 129, 0.45)',
        background: 'rgba(15, 23, 42, 0.85)',
        boxShadow: isGenerating ? '0 0 25px rgba(16, 185, 129, 0.6)' : '0 10px 30px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(16px)',
        WebkitAppRegion: 'drag',
        zIndex: 9999,
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.2s ease, transform 0.15s ease'
      }}
      title="Single Click to open, Double Click to Exit/Close application, Drag to move"
    >
      {/* Glowing Symbiot Logo Emblem */}
      {!stealthMode && (
        <SymbiotLogo size={28} />
      )}

      <div style={{ pointerEvents: 'none' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
          Symbiot
          {isStreaming && (
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#ef4444',
              display: 'inline-block',
              boxShadow: '0 0 8px #ef4444'
            }} />
          )}
        </div>
        <span style={{ fontSize: '0.7rem', color: isGenerating ? '#10b981' : 'var(--text-muted)' }}>
          {isGenerating ? 'Generating Answer...' : 'Click Open • 2xClick Exit'}
        </span>
      </div>

      {/* Quick Close Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (onExitApp) onExitApp();
        }}
        style={{
          border: 'none',
          background: 'rgba(239, 68, 68, 0.2)',
          color: '#ef4444',
          borderRadius: '50%',
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          WebkitAppRegion: 'no-drag'
        }}
        title="Close Application"
      >
        <X size={14} />
      </button>

      <ChevronDown size={16} color="var(--text-muted)" style={{ transform: 'rotate(-90deg)', pointerEvents: 'none' }} />
    </div>
  );
}
