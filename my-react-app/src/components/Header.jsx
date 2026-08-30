import React from 'react';
import { Shield, Wifi, WifiOff, Settings, Minimize2, X, MousePointerClick, Monitor } from 'lucide-react';
import SymbiotLogo from './SymbiotLogo';

export default function Header({
  isConnected,
  stealthMode,
  setStealthMode,
  clickThrough,
  setClickThrough,
  displaysList = [],
  activeDisplayIndex = 0,
  onSwitchDisplay,
  onOpenScreenModal,
  onOpenSettings,
  onCollapse,
  onExitApp
}) {
  const handleCycleDisplay = () => {
    if (onOpenScreenModal) {
      onOpenScreenModal();
    } else if (onSwitchDisplay) {
      onSwitchDisplay();
    } else if (window.electronAPI && displaysList.length > 1) {
      const nextIndex = (activeDisplayIndex + 1) % displaysList.length;
      const targetDisplay = displaysList[nextIndex];
      if (targetDisplay && window.electronAPI.switchDisplay) {
        window.electronAPI.switchDisplay(targetDisplay.id);
      }
    }
  };

  return (
    <header
      className="glass-panel"
      style={{
        padding: '8px 14px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        WebkitAppRegion: 'drag',
        cursor: 'grab',
        height: '46px',
        boxSizing: 'border-box'
      }}
    >
      {/* 1. Left Branding & Hotkey Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', WebkitAppRegion: 'drag' }}>
        <SymbiotLogo size={30} />
        <h1 style={{ fontSize: '1.08rem', fontWeight: 800, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '6px', margin: 0, color: '#ffffff' }}>
          Symbiot
          <span style={{ fontSize: '0.64rem', fontWeight: 600, padding: '1px 6px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            v2.0
          </span>
        </h1>

        {/* Global Hotkeys Legend Badge */}
        <div className="hotkey-legend-badge" style={{
          fontSize: '0.66rem',
          color: 'rgba(255, 255, 255, 0.5)',
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '2px 8px',
          borderRadius: '6px',
          display: 'flex',
          gap: '8px'
        }}>
          <span><strong style={{ color: '#34d399' }}>Alt+S</strong> Stealth</span>
          <span><strong style={{ color: '#60a5fa' }}>Alt+C</strong> Pass-Through</span>
          <span><strong style={{ color: '#a78bfa' }}>Alt+D</strong> Switch Screen</span>
          <span><strong style={{ color: '#f59e0b' }}>Alt+H</strong> Hide</span>
        </div>
      </div>

      {/* 2. Right System Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', WebkitAppRegion: 'no-drag' }}>
        {/* Connection Status */}
        <div style={{
          height: '28px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '0 8px',
          borderRadius: '7px',
          background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: isConnected ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
          color: isConnected ? '#10b981' : '#ef4444',
          fontSize: '0.74rem',
          fontWeight: 600
        }}>
          {isConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span className="btn-label-desktop">{isConnected ? 'Online' : 'Offline'}</span>
        </div>

        {/* Desktop Screen Switcher Toggle Button */}
        <button
          onClick={handleCycleDisplay}
          className="btn-secondary"
          title="Switch Desktop Screen (Alt+D)"
          style={{
            height: '28px',
            padding: '0 8px',
            fontSize: '0.74rem',
            borderRadius: '7px',
            borderColor: 'rgba(167, 139, 250, 0.4)',
            color: '#c084fc',
            background: 'rgba(167, 139, 250, 0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Monitor size={13} />
          <span className="btn-label-desktop">
            {displaysList && displaysList.length > 1 ? `Screen ${activeDisplayIndex + 1}` : 'Screen'}
          </span>
        </button>

        {/* Click-Through Mouse Pass-Through Toggle */}
        <button
          onClick={() => {
            const nextVal = !clickThrough;
            if (setClickThrough) setClickThrough(nextVal);
            if (window.electronAPI && window.electronAPI.toggleClickThrough) {
              window.electronAPI.toggleClickThrough(nextVal);
            }
          }}
          className="btn-secondary"
          title="Toggle Mouse Click-Through Pass-Through (Alt+C)"
          style={{
            height: '28px',
            padding: '0 8px',
            fontSize: '0.74rem',
            borderRadius: '7px',
            borderColor: clickThrough ? '#60a5fa' : 'var(--panel-border)',
            color: clickThrough ? '#60a5fa' : 'var(--text-main)',
            background: clickThrough ? 'rgba(96, 165, 250, 0.15)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <MousePointerClick size={13} />
          <span className="btn-label-desktop">{clickThrough ? 'Pass-Through ON' : 'Pass-Through'}</span>
        </button>

        {/* Stealth Overlay Toggle */}
        <button
          onClick={() => setStealthMode(!stealthMode)}
          className="btn-secondary"
          title="Toggle Teleprompter Size (Alt+S)"
          style={{
            height: '28px',
            padding: '0 8px',
            fontSize: '0.74rem',
            borderRadius: '7px',
            borderColor: stealthMode ? 'var(--primary-accent)' : 'var(--panel-border)',
            color: stealthMode ? 'var(--primary-accent)' : 'var(--text-main)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Shield size={13} />
          <span className="btn-label-desktop">{stealthMode ? 'Stealth ON' : 'Standard'}</span>
        </button>

        {/* Context Settings */}
        <button onClick={onOpenSettings} className="btn-secondary" style={{ height: '28px', padding: '0 8px', fontSize: '0.74rem', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Settings size={13} />
          <span className="btn-label-desktop">Resume</span>
        </button>

        {/* Collapse to Floating Point Button */}
        <button
          onClick={onCollapse}
          className="btn-secondary"
          title="Collapse to Floating Badge"
          style={{ height: '28px', padding: '0 8px', borderRadius: '7px', background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#10b981', display: 'flex', alignItems: 'center' }}
        >
          <Minimize2 size={13} />
        </button>

        {/* Exit Application Button */}
        <button
          onClick={onExitApp}
          className="btn-secondary"
          title="Close Application"
          style={{ height: '28px', padding: '0 8px', borderRadius: '7px', background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#ef4444', display: 'flex', alignItems: 'center' }}
        >
          <X size={13} />
        </button>
      </div>
    </header>
  );
}
