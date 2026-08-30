import React, { useState, useEffect } from 'react';
import { Monitor, X, Check, RefreshCw, Layers, Volume2, Shield } from 'lucide-react';

export default function DesktopScreenModal({
  isOpen,
  onClose,
  displaysList = [],
  activeDisplayIndex = 0,
  onSelectDisplay,
  isSystemAudioActive,
  onToggleSystemAudio
}) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState(null);

  const fetchDesktopSources = async () => {
    setLoading(true);
    try {
      if (window.electronAPI && window.electronAPI.getDesktopSources) {
        const res = await window.electronAPI.getDesktopSources();
        setSources(res || []);
      } else {
        // Fallback for browser mode
        setSources(displaysList.map((d, idx) => ({
          id: d.id || `display-${idx}`,
          name: d.label || `Display ${idx + 1}`,
          thumbnail: '',
          display_id: d.id
        })));
      }
    } catch (err) {
      console.error('Error loading screen sources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDesktopSources();
    }
  }, [isOpen, displaysList]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width: '640px',
          maxWidth: '95vw',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '24px',
          borderRadius: '16px',
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(167, 139, 250, 0.35)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.9)',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', paddingBottom: '12px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ padding: '8px', borderRadius: '10px', background: 'rgba(167, 139, 250, 0.15)', border: '1px solid rgba(167, 139, 250, 0.3)' }}>
              <Monitor size={22} color="#c084fc" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Desktop Screen & Monitor Selector
                <span style={{ fontSize: '0.66rem', padding: '2px 6px', borderRadius: '6px', background: 'rgba(167, 139, 250, 0.2)', color: '#c084fc', border: '1px solid rgba(167, 139, 250, 0.4)' }}>
                  Parakeet AI Mode
                </span>
              </h2>
              <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '2px 0 0 0' }}>
                Select target screen to position teleprompter overlay & stream interviewer system audio
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Action Controls Top Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Available Displays & Windows ({sources.length || displaysList.length})
          </span>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={fetchDesktopSources}
              className="btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <RefreshCw size={12} className={loading ? 'spin' : ''} />
              <span>Refresh Previews</span>
            </button>
          </div>
        </div>

        {/* Displays Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px', marginBottom: '20px' }}>
          {(sources.length > 0 ? sources : displaysList).map((source, index) => {
            const isCurrentDisplay = activeDisplayIndex === index;
            const isSelected = selectedSourceId === source.id || isCurrentDisplay;

            return (
              <div
                key={source.id || index}
                onClick={() => {
                  setSelectedSourceId(source.id);
                  if (onSelectDisplay) onSelectDisplay(index, source);
                }}
                style={{
                  background: isSelected ? 'rgba(167, 139, 250, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  border: isSelected ? '2px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  padding: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative'
                }}
              >
                {/* Thumbnail / Mock Display */}
                <div style={{
                  height: '130px',
                  borderRadius: '8px',
                  background: '#090d16',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  marginBottom: '10px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  position: 'relative'
                }}>
                  {source.thumbnail ? (
                    <img src={source.thumbnail} alt={source.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ textAlign: 'center', color: '#64748b' }}>
                      <Monitor size={42} color={isSelected ? '#c084fc' : '#475569'} />
                      <div style={{ fontSize: '0.72rem', marginTop: '6px', fontWeight: 600 }}>
                        {source.label || `Display ${index + 1}`}
                      </div>
                    </div>
                  )}

                  {isSelected && (
                    <div style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      background: '#c084fc',
                      color: '#000',
                      borderRadius: '50%',
                      width: '22px',
                      height: '22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <Check size={14} strokeWidth={3} />
                    </div>
                  )}
                </div>

                {/* Display Label */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0, color: isSelected ? '#c084fc' : '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>
                      {source.name || source.label || `Screen ${index + 1}`}
                    </h4>
                    <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
                      {source.bounds ? `${source.bounds.width} x ${source.bounds.height}` : 'Active Desktop Screen'}
                    </span>
                  </div>

                  <button
                    className="btn-primary"
                    style={{
                      padding: '4px 8px',
                      fontSize: '0.7rem',
                      borderRadius: '6px',
                      background: isSelected ? '#c084fc' : 'rgba(255,255,255,0.1)',
                      color: isSelected ? '#000' : '#fff',
                      border: 'none',
                      fontWeight: 700
                    }}
                  >
                    {isSelected ? 'Active' : 'Switch'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Info & System Audio Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => onToggleSystemAudio && onToggleSystemAudio(selectedSourceId)}
              style={{
                padding: '6px 12px',
                fontSize: '0.78rem',
                borderRadius: '8px',
                border: isSystemAudioActive ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.15)',
                background: isSystemAudioActive ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                color: isSystemAudioActive ? '#34d399' : '#e2e8f0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 600
              }}
            >
              <Volume2 size={14} color={isSystemAudioActive ? "#34d399" : "#fff"} />
              <span>{isSystemAudioActive ? 'System Audio Stream ON' : 'Share Screen Audio (Interviewer)'}</span>
            </button>
          </div>

          <div style={{ fontSize: '0.72rem', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', color: '#c084fc', fontWeight: 700 }}>
              Alt + D
            </span>
            <span>Quick Cycle Shortcut</span>
          </div>
        </div>
      </div>
    </div>
  );
}
