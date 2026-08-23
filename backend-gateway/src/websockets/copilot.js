import { WebSocketServer } from 'ws';
import { streamCopilotAnswer, getSessionContext } from '../services/llm.js';

export function setupCopilotWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);
    if (pathname === '/ws/copilot') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    console.log('[Copilot WS] Client connected');
    let currentAbortSignal = null;

    ws.send(
      JSON.stringify({
        type: 'status',
        message: 'Connected to Symbiot Copilot WebSocket Engine',
      })
    );

    ws.on('message', async (data) => {
      try {
        const payload = JSON.parse(data.toString());

        if (payload.type === 'transcript_question') {
          const { questionText, userId, apiKey, resumeContext, selectedModel } = payload;
          
          const words = questionText ? questionText.trim().split(/\s+/) : [];
          if (words.length < 2 && !questionText.includes('?')) {
            console.log(`[Copilot WS] Skipped single-word filler speech noise: "${questionText}"`);
            return;
          }

          // Rapid question change interruption: cancel previous active stream immediately
          if (currentAbortSignal) {
            currentAbortSignal.aborted = true;
            console.log('[Copilot WS] ⚡ Rapid question change! Cancelled previous streaming answer.');
          }

          const abortHandle = { aborted: false };
          currentAbortSignal = abortHandle;

          console.log(`[Copilot WS] Received Question: "${questionText}" [Model: ${selectedModel || 'gemini-1.5-flash'}]`);

          // Notify frontend that generation started
          ws.send(JSON.stringify({ type: 'start_generating' }));

          // 1. Fetch Database RAG Context
          const dbContext = await getSessionContext(userId || '00000000-0000-0000-0000-000000000000', questionText, apiKey);
          if (abortHandle.aborted) return;

          const fullContext = [dbContext, resumeContext ? `[CLIENT RESUME]: ${resumeContext}` : '']
            .filter(Boolean)
            .join('\n\n');

          // 2. Stream tokens back via WebSocket using requested AI Model + Resume RAG synthesis
          await streamCopilotAnswer(
            questionText,
            fullContext,
            (token) => {
              if (abortHandle.aborted) return;
              if (ws.readyState === ws.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'token_delta',
                    token: token,
                  })
                );
              }
            },
            apiKey,
            selectedModel || 'gemini-1.5-flash'
          );

          // Notify completion
          if (!abortHandle.aborted && ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'end_generating' }));
          }
        }
      } catch (err) {
        console.error('[Copilot WS] Error processing message:', err.message);
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Failed to process copilot query',
          })
        );
      }
    });

    ws.onclose = () => {
      console.log('[Copilot WS] Client disconnected');
    };
  });

  return wss;
}
