import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Linear Interpolation Resampler: Float32 (inRate) -> Int16 PCM (16000 Hz)
 */
function resampleAndConvertToInt16(float32Array, inRate, outRate = 16000) {
  if (inRate === outRate) {
    const pcm = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
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
    const clamped = Math.max(-1, Math.min(1, interpolated));
    result[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  return result.buffer;
}

/**
 * Custom React Hook for Real-Time Microphone & Desktop Audio Capture & WebSocket Streaming
 */
// Channel byte for microphone audio:
//  - system audio shared: mic = applicant (0x02); the interviewer arrives on system audio (0x01)
//  - mic only + auto:     0x03 "mixed" -> the ASR service separates the two voices (Streaming Sortformer)
//  - mic only + manual:   the speaker toggle decides (0x01 interviewer / 0x02 applicant)
function micChannelFor(systemAudioActive, manualSpeaker, autoSeparation = false) {
  if (systemAudioActive) return 0x02;
  if (autoSeparation) return 0x03;
  return manualSpeaker === 'applicant' ? 0x02 : 0x01;
}

function loadSpeakerMode() {
  try {
    return window.localStorage.getItem('symbiot.speakerMode') === 'manual' ? 'manual' : 'auto';
  } catch {
    return 'auto';
  }
}

export function useAudioStreamer(asrWsUrl, onTranscriptReceived) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSystemAudioActive, setIsSystemAudioActive] = useState(false);
  const [isSwitchingMic, setIsSwitchingMic] = useState(false);
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

  // Speaker segregation:
  //  - dual-source mode (system audio shared): system audio = interviewer (0x01), mic = applicant (0x02)
  //  - mic-only mode: the mic is labelled by the manual speaker toggle
  const isSystemAudioActiveRef = useRef(false);

  // Mic-only speaker mode: 'auto' (separate voices with diarization) or 'manual' (toggle)
  const [speakerMode, setSpeakerModeState] = useState(loadSpeakerMode);
  const speakerModeRef = useRef(speakerMode);
  // Diarization status from the ASR service: 'ready' | 'loading' | 'error' | 'disabled' | 'too_slow'
  const [diarStatus, setDiarStatus] = useState(null);
  const diarStatusRef = useRef(null);
  const [diarRoles, setDiarRoles] = useState(null);

  const autoSeparationActive = () => speakerModeRef.current === 'auto' && diarStatusRef.current === 'ready';
  const micChannelByte = () =>
    micChannelFor(isSystemAudioActiveRef.current, activeSpeakerRef.current, autoSeparationActive());

  // ASR model status reported by the service ('loading' | 'ready' | 'error'); null = not connected
  const [asrStatus, setAsrStatus] = useState(null);
  const asrReadyRef = useRef(false);

  // Send one mic PCM frame. When the mic's channel changes (mode switch, toggle, diarizer
  // becoming ready / too slow) the service's per-channel state is reset first, so half an
  // utterance is never glued onto audio labelled differently.
  const lastMicChannelRef = useRef(null);
  const sendMicFrame = (pcmBytes) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || pcmBytes.byteLength === 0) return;
    const channelByte = micChannelByte();
    if (lastMicChannelRef.current !== null && lastMicChannelRef.current !== channelByte) {
      socket.send(JSON.stringify({ type: 'reset_buffer' }));
    }
    lastMicChannelRef.current = channelByte;
    const framedBuffer = new Uint8Array(1 + pcmBytes.byteLength);
    framedBuffer[0] = channelByte;
    framedBuffer.set(pcmBytes, 1);
    socket.send(framedBuffer);
  };

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
          if (data.type === 'asr_status') {
            asrReadyRef.current = data.status === 'ready';
            setAsrStatus(data.status);
            diarStatusRef.current = data.diarization || null;
            setDiarStatus(data.diarization || null);
            if (data.diarization === 'too_slow') {
              console.warn('[ASR Streamer] Live voice separation is too slow on this machine; using the manual speaker toggle.');
            }
          } else if (data.type === 'diar_roles') {
            setDiarRoles(data);
          } else if ((data.type === 'transcript_chunk' || data.type === 'transcript_partial') && typeof data.text === 'string') {
            const isFinal = data.type === 'transcript_chunk';
            const speaker = data.speaker === 'applicant' ? 'applicant' : 'interviewer';
            if (data.text) {
              const voice = data.diarized && data.speaker_index !== null && data.speaker_index !== undefined
                ? ` (voice ${data.speaker_index + 1})`
                : '';
              setLiveTranscript(`${speaker === 'applicant' ? 'You' : 'Interviewer'}${voice}: ${data.text}`);
            }
            if (onTranscriptRef.current) {
              onTranscriptRef.current(data.text, speaker, data.engine || 'parakeet', isFinal);
            }
          }
        } catch (err) {
          console.error('[ASR Streamer] Error parsing ASR message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[ASR Streamer] Disconnected from ASR Service. Reconnecting in 2s...');
        socketRef.current = null;
        asrReadyRef.current = false;
        setAsrStatus(null);
        diarStatusRef.current = null;
        setDiarStatus(null);
        lastMicChannelRef.current = null; // fresh connection, fresh per-channel state
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
        // Fallback only: when the Parakeet ASR service is up it already transcribes the mic,
        // and forwarding both would duplicate every utterance.
        if (trimmed && !asrReadyRef.current) {
          const speaker = micChannelFor(isSystemAudioActiveRef.current, activeSpeakerRef.current) === 0x02 ? 'applicant' : 'interviewer';
          setLiveTranscript(`${speaker === 'applicant' ? 'You' : 'Interviewer'}: ${trimmed}`);
          if (onTranscriptRef.current) {
            onTranscriptRef.current(trimmed, speaker, 'web-speech-api', true);
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

  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState('');

  // Fetch microphone input devices
  const loadAudioDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      setAudioDevices(inputs);
      
      // Auto-prefer physical Microphone Array over silent generic mic
      const preferredMic = inputs.find(d => d.label && d.label.toLowerCase().includes('array')) ||
                           inputs.find(d => d.label && d.label.toLowerCase().includes('realtek')) ||
                           inputs[0];
      if (preferredMic && preferredMic.deviceId && !selectedMicId) {
        setSelectedMicId(preferredMic.deviceId);
      }
    } catch (e) {}
  }, [selectedMicId]);

  useEffect(() => {
    loadAudioDevices();
  }, [loadAudioDevices]);

  // Start real-time audio streaming from user microphone
  const startStreaming = async (targetDeviceId = null) => {
    setMicError(null);
    if (isStreamingRef.current && mediaStreamRef.current && audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      console.log('[ASR Streamer] Microphone streaming is already active');
      return;
    }

    if (mediaStreamRef.current || audioCtxRef.current) {
      stopStreaming();
    }

    try {
      let stream;
      const targetId = targetDeviceId || selectedMicId;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(d => d.kind === 'audioinput');
        setAudioDevices(audioInputs);

        // Targeted hardware search for Microphone Array
        const preferredMic = (targetId && audioInputs.find(d => d.deviceId === targetId)) ||
                             audioInputs.find(d => d.label && d.label.toLowerCase().includes('array')) ||
                             audioInputs.find(d => d.label && d.label.toLowerCase().includes('realtek')) ||
                             audioInputs[0];

        let audioConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };

        if (preferredMic && preferredMic.deviceId && preferredMic.deviceId !== 'default') {
          audioConstraints.deviceId = { exact: preferredMic.deviceId };
          setSelectedMicId(preferredMic.deviceId);
          console.log(`[ASR Streamer] Targeted physical microphone: "${preferredMic.label || 'Microphone Array'}" (${preferredMic.deviceId})`);
        }

        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (e) {
        console.warn('[ASR Streamer] Standard getUserMedia failed, retrying with raw audio:true constraint:', e);
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      // Force enable all audio tracks and log track state
      stream.getAudioTracks().forEach(track => {
        track.enabled = true;
        if (track.muted) {
          console.warn(`[ASR Streamer WARNING] Microphone track "${track.label}" is MUTED by Windows OS Privacy/Hardware setting!`);
        } else {
          console.log(`[ASR Streamer] Track: ${track.label || 'Microphone'}, Enabled: ${track.enabled}, Muted: ${track.muted}`);
        }
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
            console.log('[ASR Streamer] AudioContext resumed successfully (state: ' + audioCtx.state + ')');
          } catch (e) {}
        }
      };

      await resumeAudio();
      ['click', 'keydown', 'pointerdown', 'mousemove', 'focus', 'mouseenter'].forEach(evt => {
        window.addEventListener(evt, resumeAudio, { passive: true });
      });

      // Active auto-resume poll to unblock WebAudio in Electron background windows
      const resumeInterval = setInterval(() => {
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        } else if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
          clearInterval(resumeInterval);
        }
      }, 400);

      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        connectAsrSocket();
      }

      const source = audioCtx.createMediaStreamSource(stream);

      // Pre-amp gain boost (3.0x / +10dB) for weak/quiet laptop and headset microphones
      const inputGain = audioCtx.createGain();
      inputGain.gain.value = 3.0;
      source.connect(inputGain);

      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0.001; // Low gain to keep WebAudio engine awake in Chromium/Electron without power-save sleeping

      // Handle OS level microphone mute/unmute events
      stream.getAudioTracks().forEach(track => {
        track.onunmute = () => {
          console.log('[ASR Streamer] Microphone track unmuted by OS, resuming WebAudio graph...');
          if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => {});
          }
        };
        track.onmute = () => {
          console.warn('[ASR Streamer WARNING] Microphone track muted by OS privacy setting!');
        };
      });

      // Global window references to prevent V8 Garbage Collector from evicting active Web Audio nodes
      window._symbiotAudioCtx = audioCtx;
      window._symbiotStream = stream;
      window._symbiotSource = source;
      window._symbiotInputGain = inputGain;
      window._symbiotMuteGain = muteGain;

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
                sendMicFrame(pcmBytes);
              }
            }
          }
        };

        inputGain.connect(workletNode);
        workletNode.connect(muteGain);
        muteGain.connect(audioCtx.destination);
        console.log('[ASR Streamer] AudioWorklet 16kHz resampler active (+10dB input boost)');
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
              sendMicFrame(pcmBytes);
            }
          }
        };

        inputGain.connect(processor);
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

  // Switch between dual-source and mic-only labelling. The mic's channel byte changes with it;
  // sendMicFrame() notices and resets the ASR service's per-channel state.
  const setCaptureMode = (systemAudioActive) => {
    isSystemAudioActiveRef.current = systemAudioActive;
    setIsSystemAudioActive(systemAudioActive);
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

      setCaptureMode(true);
      console.log('[ASR Streamer] Dual-source mode: system audio -> interviewer (0x01), microphone -> applicant (0x02)');
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
    setCaptureMode(false);
    console.log('[ASR Streamer] System audio share stopped (mic-only mode, manual speaker toggle)');
  };

  // Stop audio streaming (async to properly await AudioContext.close())
  const stopStreaming = async () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch (e) {}
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      try { await audioCtxRef.current.close(); } catch (e) {}
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
    if (isSystemAudioActiveRef.current) {
      // Dual-source mode labels audio by source; the manual toggle must not reset the interviewer stream.
      return;
    }
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'set_speaker', speaker }));
      socketRef.current.send(JSON.stringify({ type: 'reset_buffer' }));
      console.log(`[ASR Streamer] Switched active speaker to: ${speaker}`);
    }
  };

  // Mic-only speaker mode: 'auto' (voice separation) or 'manual' (toggle)
  const setSpeakerMode = (mode) => {
    const next = mode === 'manual' ? 'manual' : 'auto';
    speakerModeRef.current = next;
    setSpeakerModeState(next);
    setLiveTranscript('');
    try {
      window.localStorage.setItem('symbiot.speakerMode', next);
    } catch {
      // storage unavailable (private mode): the choice just isn't remembered
    }
  };

  // Correct the voice -> role mapping using the most recent utterance ("That was me")
  const assignLastSpeaker = (role) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'assign_last_speaker', role }));
      console.log(`[ASR Streamer] Last voice assigned to: ${role}`);
    }
  };

  const resetAsrBuffer = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'reset_buffer' }));
      console.log('[ASR Streamer] Sent reset_buffer signal to ASR service');
    }
  };

  const switchMicrophone = async (deviceId) => {
    if (isSwitchingMic) return; // Prevent overlapping switches
    console.log(`[ASR Streamer] Switching microphone device to: ${deviceId}`);
    setSelectedMicId(deviceId);
    if (isStreaming) {
      setIsSwitchingMic(true);
      try {
        await stopStreaming();
        await startStreaming(deviceId);
        console.log(`[ASR Streamer] Microphone switch complete: ${deviceId}`);
      } catch (err) {
        console.error('[ASR Streamer] Microphone switch failed:', err);
        setMicError('Microphone switch failed. Please try again.');
      } finally {
        setIsSwitchingMic(false);
      }
    }
  };

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    isSystemAudioActive,
    startSystemAudioShare,
    stopSystemAudioShare,
    isSwitchingMic,
    liveTranscript,
    audioLevel,
    micError,
    activeSpeaker,
    switchSpeaker,
    resetAsrBuffer,
    asrStatus,
    speakerMode,
    setSpeakerMode,
    diarStatus,
    diarRoles,
    assignLastSpeaker,
    audioDevices,
    selectedMicId,
    switchMicrophone,
  };
}
