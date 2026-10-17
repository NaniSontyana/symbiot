import { useState } from 'react';
import { LogIn, UserPlus, ShieldCheck, KeyRound, AtSign, User, Sparkles, Loader2 } from 'lucide-react';
import SymbiotLogo from './SymbiotLogo';
import { apiUrl } from '../lib/api';

/**
 * First-run authentication gate.
 *
 * Offers a real account flow (email + password against the gateway's
 * bcrypt-backed /api/auth routes) or a one-click demo mode that needs no
 * account at all. Rendered as an overlay; the copilot behind it stays
 * alive so every service keeps connecting while the user decides.
 */
export default function AuthScreen({ onAuthSuccess, onContinueAsDemo }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError('');

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'register' && !username.trim()) {
      setError('Choose a display name to create your account.');
      return;
    }
    if (mode === 'register' && password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body =
        mode === 'register'
          ? { username: username.trim(), email: email.trim(), password }
          : { email: email.trim(), password };

      const response = await fetch(apiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Authentication failed (HTTP ${response.status})`);
      }
      if (onAuthSuccess) onAuthSuccess({ user: data.user, token: data.token });
    } catch (err) {
      setError(err.message || 'Could not reach the gateway. Is the backend running on port 5000?');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputWrap = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.16)',
    borderRadius: '10px',
    padding: '10px 12px',
  };
  const inputStyle = {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#ffffff',
    fontSize: '0.88rem',
    fontFamily: 'Inter, system-ui, sans-serif',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
      }}
    >
      <div
        style={{
          width: 'min(392px, calc(100vw - 32px))',
          borderRadius: '20px',
          background: '#0a0a0a',
          border: '1px solid #2a2a2a',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
          padding: '26px 26px 22px',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <SymbiotLogo size={34} />
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
              Symbiot Copilot
            </div>
            <div style={{ fontSize: '0.72rem', color: '#a3a3a3' }}>
              Real-time AI interview assistant
            </div>
          </div>
        </div>

        {/* Mode tabs */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '10px',
            padding: '3px',
            margin: '16px 0 14px',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {[
            { id: 'login', label: 'Sign In', icon: <LogIn size={13} /> },
            { id: 'register', label: 'Create Account', icon: <UserPlus size={13} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMode(tab.id);
                setError('');
              }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '7px 0',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: mode === tab.id ? '#0a0a0a' : '#a3a3a3',
                background: mode === tab.id ? '#ffffff' : 'transparent',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {mode === 'register' && (
            <div style={inputWrap}>
              <User size={15} color="#a3a3a3" />
              <input
                style={inputStyle}
                type="text"
                placeholder="Display name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="nickname"
              />
            </div>
          )}
          <div style={inputWrap}>
            <AtSign size={15} color="#a3a3a3" />
            <input
              style={inputStyle}
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div style={inputWrap}>
            <KeyRound size={15} color="#a3a3a3" />
            <input
              style={inputStyle}
              type="password"
              placeholder={mode === 'register' ? 'Password (min. 6 characters)' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </div>

          {error && (
            <div
              style={{
                fontSize: '0.76rem',
                color: '#fca5a5',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                padding: '8px 10px',
                lineHeight: 1.4,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 0',
              borderRadius: '10px',
              border: 'none',
              cursor: isSubmitting ? 'default' : 'pointer',
              fontSize: '0.86rem',
              fontWeight: 700,
              color: '#0a0a0a',
              background: '#ffffff',
              opacity: isSubmitting ? 0.7 : 1,
              marginTop: '2px',
            }}
          >
            {isSubmitting ? (
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            ) : mode === 'register' ? (
              <UserPlus size={15} />
            ) : (
              <LogIn size={15} />
            )}
            {isSubmitting ? 'Please wait…' : mode === 'register' ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {/* Demo path */}
        <button
          type="button"
          onClick={onContinueAsDemo}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '9px 0',
            marginTop: '10px',
            borderRadius: '10px',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: 600,
            color: '#ffffff',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
          }}
        >
          <Sparkles size={14} color="#eab308" />
          Continue as Demo — no account needed
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '14px',
            fontSize: '0.68rem',
            color: '#737373',
            lineHeight: 1.5,
          }}
        >
          <ShieldCheck size={13} color="#737373" style={{ flexShrink: 0 }} />
          <span>Passwords are hashed with bcrypt. Demo credentials: candidate@symbiot.ai / demo1234</span>
        </div>
      </div>
    </div>
  );
}
