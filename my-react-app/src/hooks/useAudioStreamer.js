import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Linear Interpolation Resampler: Float32 (inRate) -> Int16 PCM (16000 Hz)
 */
function resampleAndConvertToInt16(float32Array, inRate, outRate = 16000) {
  if (inRate === outRate) {
    const pcm = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i] * 5.0));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm.buffer;
  }

  const ratio = inRate / outRate;
  const newLength = Math.round(float32Array.length / ratio);
  const result = new Int16Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const originPos = i * ratio;
    const index = Math.floor(originPos);
    const decimal = originPos - index;

    const current = float32Array[index] || 0;
    const next = float32Array[index + 1] !== undefined ? float32Array[index + 1] : current;

    const interpolated = current + (next - current) * decimal;
    const boosted = interpolated * 5.0; // Boost microphone input volume (14dB gain)
    const clamped = Math.max(-1, Math.min(1, boosted));
    result[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return result.buffer;
}

/**
 * Custom React Hook for Real-Time Microphone & Desktop Audio Capture & WebSocket Streaming
 */
export function useAudioStreamer(asrWsUrl, onTranscriptReceived) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSystemAudioActive, setIsSystemAudioActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [micError, setMicError] = useState(null);

  const lastLevelUpdateRef = useRef(0);
  const updateAudioLevelThrottled = useCallback((newLevel) => {
    const now = Date.now();
    // Throttle React state update to ~15 FPS (every 66ms) to prevent 60 FPS root re-renders
    if (now - lastLevelUpdateRef.current >= 66) {
      lastLevelUpdateRef.current = now;
      setAudioLevel(newLevel);
    }
  }, []);

  const socketRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const recognitionRef = useRef(null);

  const systemStreamRef = useRef(null);
  const systemAudioCtxRef = useRef(null);
  const systemProcessorRef = useRef(null);

  const onTranscriptRef = useRef(onTranscriptReceived);
  useEffect(() => {
    onTranscriptRef.current = onTranscriptReceived;
  }, [onTranscriptReceived]);

  const [activeSpeaker, setActiveSpeaker] = useState('interviewer');
  const activeSpeakerRef = useRef(activeSpeaker);
  useEffect(() => {
    activeSpeakerRef.current = activeSpeaker;
  }, [activeSpeaker]);

  const reconnectTimerRef = useRef(null);

  // Initialize WebSocket connection to ASR Microservice
  const connectAsrSocket = useCallback(() => {
    try {
      if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
        return; // Socket is already active or connecting, do not re-create
      }

      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

      const ws = new WebSocket(asrWsUrl || 'ws://localhost:8000/ws/transcribe');
      socketRef.current = ws;

      ws.onopen = () => {
        console.log('[ASR Streamer] Connected to Python ASR Service on port 8000');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript_chunk' && data.text) {
            setLiveTranscript(data.text);
            if (onTranscriptRef.current) {
              onTranscriptRef.current(data.text, data.speaker || 'interviewer', data.engine || 'whisper');
            }
          }
        } catch (err) {
          console.error('[ASR Streamer] Error parsing ASR message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[ASR Streamer] Disconnected from ASR Service. Reconnecting in 2s...');
        socketRef.current = null;
        reconnectTimerRef.current = setTimeout(() => {
          connectAsrSocket();
        }, 2000);
      };

      ws.onerror = (err) => {
        console.warn('[ASR Streamer] ASR WS Error:', err);
      };
    } catch (e) {
      console.warn('[ASR Streamer] Could not connect to ASR WS, retrying in 2s:', e);
      reconnectTimerRef.current = setTimeout(() => {
        connectAsrSocket();
      }, 2000);
    }
  }, [asrWsUrl]);

  useEffect(() => {
    connectAsrSocket();

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connectAsrSocket]);

  const isStreamingRef = useRef(false);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Start Web Speech API as instant client-side fallback (Web browsers only)
  const startWebSpeechRecognition = useCallback(() => {
    // Electron apps do not have built-in Google Speech API keys in Chromium network stack.
    // Skip Web Speech API in Electron to prevent repeated ChunkedDataPipeUploadDataStream network errors.
    const isElectron = typeof window !== 'undefined' && (!!window.electronAPI || (navigator.userAgent && navigator.userAgent.includes('Electron')));
    if (isElectron) {
      console.log('[Web Speech API] Skipped in Electron environment (ASR handled via Python microservice)');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += chunk + ' ';
          }
        }
        const trimmed = finalTranscript.trim();
        if (trimmed) {
          setLiveTranscript(trimmed);
          if (onTranscriptRef.current) {
            onTranscriptRef.current(trimmed, activeSpeakerRef.current, 'web-speech-api');
          }
        }
      };

      recognition.onerror = (e) => {
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[Web Speech API] Error:', e.error);
        }
      };

      recognition.onend = () => {
        if (isStreamingRef.current) {
          try { recognition.start(); } catch (err) {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      console.log('[Web Speech API] Client-side STT initialized successfully');
    } catch (e) {
      console.warn('[Web Speech API] Could not initialize:', e);
    }
  }, []);

  // Start real-time audio streaming from user microphone
  const startStreaming = async () => {
    setMicError(null);
    if (isStreamingRef.current && mediaStreamRef.current && audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      console.log('[ASR Streamer] Microphone streaming is already active');
      return;
    }

    if (mediaStreamRef.current || audioCtxRef.current) {
      stopStreaming();
    }

    try {
      let audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      };

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        const physicalMic = audioInputs.find(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
        if (physicalMic && physicalMic.deviceId) {
          audioConstraints.deviceId = { ideal: physicalMic.deviceId };
          console.log(`[ASR Streamer] Selected microphone hardware: "${physicalMic.label || physicalMic.deviceId}"`);
        }
      } catch (e) {}

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

      // Force enable all audio tracks
      stream.getAudioTracks().forEach(track => {
        track.enabled = true;
        console.log(`[ASR Streamer] Track: ${track.label || 'Microphone'}, Enabled: ${track.enabled}, Muted: ${track.muted}`);
      });

      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
        } catch (e) {}
      }

      const resumeAudio = async () => {
        if (audioCtx && audioCtx.state === 'suspended') {
          try {
            await audioCtx.resume();
            console.log('[ASR Streamer] AudioContext resumed successfully');
          } catch (e) {}
        }
      };

      await resumeAudio();
      ['click', 'keydown', 'pointerdown', 'mousemove', 'focus', 'mouseenter'].forEach(evt => {
        window.addEventListener(evt, resumeAudio, { passive: true });
      });

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        connectAsrSocket();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0.000001; // Inaudible non-zero gain to prevent Chromium WebAudio graph sleeping

      // Global window references to prevent V8 Garbage Collector from evicting active Web Audio nodes
      window._symbiotAudioCtx = audioCtx;
      window._symbiotStream = stream;

      // Try AudioWorklet first for glitch-free main-thread decoupled audio streaming
      try {
        await audioCtx.audioWorklet.addModule('/pcm-processor.js');
        const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
        processorRef.current = workletNode;
        window._symbiotProcessor = workletNode;

        workletNode.port.onmessage = (event) => {
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }
          if (event.data.type === 'pcm_data') {
            updateAudioLevelThrottled(event.data.audioLevel);

            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              const pcmBytes = new Uint8Array(event.data.pcmBuffer);
              if (pcmBytes.byteLength > 0) {
                const channelByte = 0x01; // 0x01 = Interviewer Question Stream
                const framedBuffer = new Uint8Array(1 + pcmBytes.byteLength);
                framedBuffer[0] = channelByte;
                framedBuffer.set(pcmBytes, 1);
                socketRef.current.send(framedBuffer);
              }
            }
          }
        };

        source.connect(workletNode);
        workletNode.connect(muteGain);
        muteGain.connect(audioCtx.destination);
        console.log('[ASR Streamer] AudioWorklet 16kHz resampler active');
      } catch (workletErr) {
        console.warn('[ASR Streamer] AudioWorklet fallback to ScriptProcessor:', workletErr.message);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        window._symbiotProcessor = processor;

        processor.onaudioprocess = (e) => {
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }
          const inputData = e.inputBuffer.getChannelData(0);

          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          const level = Math.min(100, Math.floor(rms * 500));
          updateAudioLevelThrottled(level);

          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            const pcmBuffer = resampleAndConvertToInt16(inputData, audioCtx.sampleRate, 16000);
            const pcmBytes = new Uint8Array(pcmBuffer);
            if (pcmBytes.byteLength > 0) {
              const channelByte = 0x01; // 0x01 = Interviewer Question Stream
              const framedBuffer = new Uint8Array(1 + pcmBytes.byteLength);
              framedBuffer[0] = channelByte;
              framedBuffer.set(pcmBytes, 1);
              socketRef.current.send(framedBuffer);
            }
          }
        };

        source.connect(processor);
        processor.connect(muteGain);
        muteGain.connect(audioCtx.destination);
      }

      setIsStreaming(true);
      startWebSpeechRecognition();
      console.log('[ASR Streamer] Live mic streaming active (16kHz PCM Groq Whisper ASR + Browser Web Speech Fallback)');
    } catch (err) {
      console.error('[ASR Streamer] Microphone access error:', err);
      setMicError(err.name === 'NotAllowedError' ? 'Microphone permission denied.' : err.message);
      setIsStreaming(false);
    }
  };

  // Start capture of System Audio (Zoom, Meet, Browser Tab) for pure interviewer audio
  const startSystemAudioShare = async (sourceId = null) => {
    try {
      let displayStream;
      if (sourceId && navigator.mediaDevices.getUserMedia) {
        displayStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          }
        });
      } else {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        alert('No audio track selected! Please make sure to check "Share audio" when selecting tab or screen.');
        displayStream.getTracks().forEach((t) => t.stop());
        return;
      }

      systemStreamRef.current = displayStream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const sysCtx = new AudioCtx();
      systemAudioCtxRef.current = sysCtx;

      if (sysCtx.state === 'suspended') {
        await sysCtx.resume();
      }

      const sysSource = sysCtx.createMediaStreamSource(new MediaStream([audioTracks[0]]));
      const sysProcessor = sysCtx.createScriptProcessor(4096, 1, 1);
      systemProcessorRef.current = sysProcessor;

      const sysMute = sysCtx.createGain();
      sysMute.gain.value = 0;

      sysProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const level = Math.min(100, Math.floor(rms * 500));
        updateAudioLevelThrottled(level);

        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          const pcmBuffer = resampleAndConvertToInt16(inputData, sysCtx.sampleRate, 16000);
          const pcmBytes = new Uint8Array(pcmBuffer);
          if (pcmBytes.byteLength > 0) {
            const framedBuffer = new Uint8Array(1 + pcmBytes.byteLength);
            framedBuffer[0] = 0x01; // Channel 0x01 = Interviewer / System Audio
            framedBuffer.set(pcmBytes, 1);
            socketRef.current.send(framedBuffer);
          }
        }
      };

      sysSource.connect(sysProcessor);
      sysProcessor.connect(sysMute);
      sysMute.connect(sysCtx.destination);

      audioTracks[0].onended = () => {
        stopSystemAudioShare();
      };

      setIsSystemAudioActive(true);
      console.log('[ASR Streamer] System Audio capture active (Interviewer Channel 0x01)');
    } catch (err) {
      console.error('[ASR Streamer] System Audio share error:', err);
    }
  };

  const stopSystemAudioShare = () => {
    if (systemProcessorRef.current) {
      systemProcessorRef.current.disconnect();
      systemProcessorRef.current = null;
    }
    if (systemAudioCtxRef.current) {
      systemAudioCtxRef.current.close();
      systemAudioCtxRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((track) => track.stop());
      systemStreamRef.current = null;
    }
    setIsSystemAudioActive(false);
    console.log('[ASR Streamer] System audio share stopped');
  };

  // Stop audio streaming
  const stopStreaming = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch (e) {}
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch (e) {}
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    delete window._symbiotAudioCtx;
    delete window._symbiotStream;
    delete window._symbiotProcessor;
    setIsStreaming(false);
    setAudioLevel(0);
    console.log('[ASR Streamer] Live mic streaming stopped');
  };

  const switchSpeaker = (speaker) => {
    setActiveSpeaker(speaker);
    activeSpeakerRef.current = speaker;
    setLiveTranscript('');
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'set_speaker', speaker }));
      socketRef.current.send(JSON.stringify({ type: 'reset_buffer' }));
      console.log(`[ASR Streamer] Switched active speaker to: ${speaker}`);
    }
  };

  const resetAsrBuffer = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'reset_buffer' }));
      console.log('[ASR Streamer] Sent reset_buffer signal to ASR service');
    }
  };

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    isSystemAudioActive,
    startSystemAudioShare,
    stopSystemAudioShare,
    liveTranscript,
    audioLevel,
    micError,
    activeSpeaker,
    switchSpeaker,
    resetAsrBuffer,
  };
}
