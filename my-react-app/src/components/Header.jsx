import React from 'react';
import { Shield, Wifi, WifiOff, Settings, Minimize2, X } from 'lucide-react';
import SymbiotLogo from './SymbiotLogo';

export default function Header({
  isConnected,
  stealthMode,
  setStealthMode,
  onOpenSettings,
  onCollapse,
  onExitApp
}) {
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
      {/* 1. Left Branding */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'drag' }}>
        <SymbiotLogo size={30} />
        <h1 style={{ fontSize: '1.08rem', fontWeight: 800, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '6px', margin: 0, color: '#ffffff' }}>
          Symbiot
          <span style={{ fontSize: '0.64rem', fontWeight: 600, padding: '1px 6px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            v2.0
          </span>
        </h1>
      </div>

      {/* 2. Right System Action Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', WebkitAppRegion: 'no-drag' }}>
        {/* Connection Status */}
        <div style={{
          height: '28px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '0 10px',
          borderRadius: '7px',
          background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: isConnected ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
          color: isConnected ? '#10b981' : '#ef4444',
          fontSize: '0.74rem',
          fontWeight: 600
        }}>
          {isConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
          {isConnected ? 'Online' : 'Offline'}
        </div>

        {/* Stealth Overlay Toggle */}
        <button
          onClick={() => setStealthMode(!stealthMode)}
          className="btn-secondary"
          style={{
            height: '28px',
            padding: '0 10px',
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
          {stealthMode ? 'Stealth ON' : 'Standard'}
        </button>

        {/* Context Settings */}
        <button onClick={onOpenSettings} className="btn-secondary" style={{ height: '28px', padding: '0 10px', fontSize: '0.74rem', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Settings size={13} />
          Resume
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
