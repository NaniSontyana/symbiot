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
        padding: '6px 14px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        WebkitAppRegion: 'drag',
        cursor: 'grab',
        height: '42px',
        boxSizing: 'border-box',
        background: '#000000',
        border: '1px solid #262626'
      }}
    >
      {/* 1. Left Branding */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'drag' }}>
        <SymbiotLogo size={24} />
        <h1 style={{ fontSize: '1.02rem', fontWeight: 800, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '6px', margin: 0, color: '#ffffff' }}>
          Symbiot
          <span style={{ fontSize: '0.62rem', fontWeight: 600, padding: '1px 5px', borderRadius: '6px', background: '#171717', color: '#ffffff', border: '1px solid #333333' }}>
            v2.0
          </span>
        </h1>
      </div>

      {/* 2. Right System Action Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', WebkitAppRegion: 'no-drag' }}>
        {/* Connection Status Pill */}
        <div 
          title={isConnected ? "Copilot Gateway Online (ws://localhost:5000)" : "Copilot Gateway Offline"}
          style={{
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '0 8px',
            borderRadius: '6px',
            background: isConnected ? '#171717' : '#0a0a0a',
            border: isConnected ? '1px solid #525252' : '1px solid #262626',
            color: isConnected ? '#ffffff' : '#a3a3a3',
            fontSize: '0.72rem',
            fontWeight: 600
          }}
        >
          {isConnected ? <Wifi size={12} color="#ffffff" /> : <WifiOff size={12} color="#a3a3a3" />}
          <span>{isConnected ? 'Online' : 'Offline'}</span>
        </div>

        {/* Display / Screen Selector Button */}
        <button
          onClick={handleCycleDisplay}
          className="btn-secondary"
          title={`Switch Display Screen (Alt+D) - Current: Screen ${activeDisplayIndex + 1}`}
          style={{
            height: '26px',
            width: '28px',
            padding: 0,
            borderRadius: '6px',
            borderColor: '#333333',
            color: '#ffffff',
            background: '#0a0a0a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Monitor size={13} color="#ffffff" />
        </button>

        {/* Click-Through Pass-Through Toggle */}
        <button
          onClick={() => {
            const nextVal = !clickThrough;
            if (setClickThrough) setClickThrough(nextVal);
            if (window.electronAPI && window.electronAPI.toggleClickThrough) {
              window.electronAPI.toggleClickThrough(nextVal);
            }
          }}
          className="btn-secondary"
          title={`Toggle Mouse Pass-Through (Alt+C) - ${clickThrough ? 'ON' : 'OFF'}`}
          style={{
            height: '26px',
            width: '28px',
            padding: 0,
            borderRadius: '6px',
            borderColor: clickThrough ? '#ffffff' : '#333333',
            color: clickThrough ? '#ffffff' : '#a3a3a3',
            background: clickThrough ? '#262626' : '#0a0a0a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <MousePointerClick size={13} color={clickThrough ? '#ffffff' : '#a3a3a3'} />
        </button>

        {/* Stealth Mode Toggle */}
        <button
          onClick={() => setStealthMode(!stealthMode)}
          className="btn-secondary"
          title={`Toggle Stealth Teleprompter Mode (Alt+S) - ${stealthMode ? 'Stealth ON' : 'Standard'}`}
          style={{
            height: '26px',
            width: '28px',
            padding: 0,
            borderRadius: '6px',
            borderColor: stealthMode ? '#ffffff' : '#333333',
            color: stealthMode ? '#ffffff' : '#a3a3a3',
            background: stealthMode ? '#262626' : '#0a0a0a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Shield size={13} color={stealthMode ? '#ffffff' : '#a3a3a3'} />
        </button>

        {/* Candidate Resume & Settings Modal Button */}
        <button
          onClick={onOpenSettings}
          className="btn-secondary"
          title="Candidate Resume & Context Settings"
          style={{
            height: '26px',
            padding: '0 8px',
            fontSize: '0.72rem',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: '#ffffff',
            borderColor: '#333333',
            background: '#0a0a0a'
          }}
        >
          <Settings size={12} color="#ffffff" />
          <span>Resume</span>
        </button>

        {/* Collapse Button */}
        <button
          onClick={onCollapse}
          className="btn-secondary"
          title="Collapse to Floating Badge"
          style={{
            height: '26px',
            width: '26px',
            padding: 0,
            borderRadius: '6px',
            background: '#0a0a0a',
            borderColor: '#333333',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Minimize2 size={12} color="#ffffff" />
        </button>

        {/* Exit Application Button */}
        <button
          onClick={onExitApp}
          className="btn-secondary"
          title="Close Application"
          style={{
            height: '26px',
            width: '26px',
            padding: 0,
            borderRadius: '6px',
            background: '#0a0a0a',
            borderColor: '#404040',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <X size={12} color="#ffffff" />
        </button>
      </div>
    </header>
  );
}
