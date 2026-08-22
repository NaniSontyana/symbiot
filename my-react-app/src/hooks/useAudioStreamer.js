import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom React Hook for Real-Time Microphone Audio Capture & WebSocket Streaming
 */
export function useAudioStreamer(asrWsUrl, onTranscriptReceived) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  const socketRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);

  // Initialize WebSocket connection to ASR Microservice
  const connectAsrSocket = useCallback(() => {
    try {
      const ws = new WebSocket(asrWsUrl || 'ws://localhost:8000/ws/transcribe');
      socketRef.current = ws;

      ws.onopen = () => {
        console.log('[ASR Streamer] Connected to Python ASR Service');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'transcript_chunk' && data.text) {
            setLiveTranscript(data.text);
            if (onTranscriptReceived) {
              onTranscriptReceived(data.text);
            }
          }
        } catch (err) {
          console.error('[ASR Streamer] Error parsing ASR message:', err);
        }
      };

      ws.onclose = () => {
        console.log('[ASR Streamer] Disconnected from ASR Service');
      };

      ws.onerror = (err) => {
        console.warn('[ASR Streamer] ASR WS Error:', err);
      };
    } catch (e) {
      console.warn('[ASR Streamer] Could not connect to ASR WS:', e);
    }
  }, [asrWsUrl, onTranscriptReceived]);

  useEffect(() => {
    connectAsrSocket();

    return () => {
      stopStreaming();
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connectAsrSocket]);

  // Convert Float32 audio samples to Int16 PCM ArrayBuffer
  const convertFloat32ToInt16 = (buffer) => {
    let l = buffer.length;
    let buf = new Int16Array(l);
    while (l--) {
      let s = Math.max(-1, Math.min(1, buffer[l]));
      buf[l] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return buf.buffer;
  };

  // Start real-time audio streaming from user microphone
  const [micError, setMicError] = useState(null);
  const recognitionRef = useRef(null);

  // Start real-time audio streaming from user microphone
  const startStreaming = async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });

      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // Dummy zero-gain node prevents audio feedback out of speakers
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);

        // Calculate RMS audio level for visualizer
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const level = Math.min(100, Math.floor(rms * 500));
        setAudioLevel(level);

        // Send binary PCM chunk over WebSocket if open
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          const pcmData = convertFloat32ToInt16(inputData);
          socketRef.current.send(pcmData);
        }
      };

      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(audioCtx.destination);

      // Initialize WebSpeech SpeechRecognition fallback if available in browser/Electron
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';

          rec.onresult = (event) => {
            let interim = '';
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const transcriptText = event.results[i][0].transcript;
              if (event.results[i].isFinal) {
                final += transcriptText;
              } else {
                interim += transcriptText;
              }
            }
            if (interim) {
              setLiveTranscript(interim);
            }
            if (final && final.trim()) {
              setLiveTranscript(final);
              if (onTranscriptReceived) {
                onTranscriptReceived(final);
              }
            }
          };

          rec.start();
          recognitionRef.current = rec;
        } catch (recErr) {
          console.log('[WebSpeech] SpeechRecognition init skipped:', recErr.message);
        }
      }

      setIsStreaming(true);
      console.log('[ASR Streamer] Live mic streaming active');
    } catch (err) {
      console.error('[ASR Streamer] Microphone access error:', err);
      setMicError(err.name === 'NotAllowedError' ? 'Microphone permission denied. Please allow mic access.' : err.message);
      setIsStreaming(false);
    }
  };

  // Stop audio streaming
  const stopStreaming = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsStreaming(false);
    setAudioLevel(0);
    console.log('[ASR Streamer] Live mic streaming stopped');
  };

  return {
    isStreaming,
    startStreaming,
    stopStreaming,
    liveTranscript,
    audioLevel,
    micError,
  };
}
