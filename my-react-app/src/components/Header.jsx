import React from 'react';
import { Cpu, Shield, Wifi, WifiOff, Settings, Minimize2, X } from 'lucide-react';

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
        padding: '14px 24px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        WebkitAppRegion: 'drag',
        cursor: 'grab'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', WebkitAppRegion: 'drag' }}>
        {/* Symbiot AI Custom Logo Emblem (Hidden when Stealth / Optimized mode is ON) */}
        {!stealthMode && (
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px rgba(16, 185, 129, 0.45)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            transition: 'all 0.2s ease'
          }}>
            <Cpu size={24} color="#ffffff" />
          </div>
        )}

        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {stealthMode ? 'System Monitor' : 'Symbiot AI'}{' '}
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              {stealthMode ? 'v2.0' : 'v2.0 Copilot'}
            </span>
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {stealthMode ? 'Telemetry & Diagnostics' : 'Real-Time Live Interview Assistant'}
          </p>
        </div>
      </div>

      {/* Non-drag region for interactive buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', WebkitAppRegion: 'no-drag' }}>
        {/* Connection Status */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '20px',
          background: isConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: isConnected ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
          color: isConnected ? '#10b981' : '#ef4444',
          fontSize: '0.8rem',
          fontWeight: 600
        }}>
          {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {isConnected ? 'Engine Online' : 'Offline'}
        </div>

        {/* Stealth Overlay Toggle */}
        <button
          onClick={() => setStealthMode(!stealthMode)}
          className="btn-secondary"
          style={{
            borderColor: stealthMode ? 'var(--primary-accent)' : 'var(--panel-border)',
            color: stealthMode ? 'var(--primary-accent)' : 'var(--text-main)'
          }}
        >
          <Shield size={16} />
          {stealthMode ? 'Stealth Mode ON' : 'Standard View'}
        </button>

        {/* Context Settings */}
        <button onClick={onOpenSettings} className="btn-secondary">
          <Settings size={16} />
          Resume Context
        </button>

        {/* Collapse to Floating Point Button */}
        <button
          onClick={onCollapse}
          className="btn-secondary"
          title="Collapse to Floating Point Badge"
          style={{ padding: '8px 10px', background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#10b981' }}
        >
          <Minimize2 size={16} />
        </button>

        {/* Exit Application Button */}
        <button
          onClick={onExitApp}
          className="btn-secondary"
          title="Emergency Exit / Close Application"
          style={{ padding: '8px 10px', background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#ef4444' }}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
