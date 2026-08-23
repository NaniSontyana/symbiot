import React from 'react';

export default function SymbiotLogo({ size = 36 }) {
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        background: '#000000',
        border: '1px solid rgba(16, 185, 129, 0.5)',
        boxShadow: '0 0 16px rgba(16, 185, 129, 0.65), 0 0 6px rgba(168, 85, 247, 0.4)',
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      <img
        src="/symbiot_logo.png"
        alt="Symbiot Logo"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          transform: 'scale(1.1)'
        }}
      />
    </div>
  );
}
