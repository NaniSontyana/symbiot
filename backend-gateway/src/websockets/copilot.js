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
          
          if (!questionText || !questionText.trim()) {
            return;
          }

          // Strip unnecessary filler words ("thank you", "good job", "hello", "thanks", etc.)
          const unnecessaryPhrases = [
            /thank\s+you(?:\s+very\s+much)?/gi,
            /thanks(?:\s+a\s+lot)?/gi,
            /good\s+job/gi,
            /great\s+job/gi,
            /nice\s+job/gi,
            /good\s+morning/gi,
            /good\s+afternoon/gi,
            /good\s+evening/gi,
            /\b(?:hello|hi|hey|bye|goodbye|thanks|thankyou|thx|cheers|noida|delhi|mumbai|city|location)\b/gi,
            /\b(?:okay|ok)\s+(?:cool|awesome|great|perfect|thanks|thank\s+you)\b/gi
          ];

          let cleanQ = questionText;
          for (const pRegex of unnecessaryPhrases) {
            cleanQ = cleanQ.replace(pRegex, ' ');
          }
          cleanQ = cleanQ.replace(/[,\s]+/g, ' ').replace(/\s+([?.!])/g, '$1').trim();

          // Strip repetitive leading/trailing pleasantry noise ("Thank you", "Thanks")
          const leadingFillersPattern = /^(?:thank\s+you|thanks|thank|ok|okay|hi|hello|hey|good\s+job|great|awesome|perfect|ah|aha|yeah|yes|sure|right|alright|fine|nice|so|and|then|noida|delhi|mumbai|city|location|bye)[.,!\s]*/gi;
          let prevLen = 0;
          while (cleanQ.length !== prevLen) {
            prevLen = cleanQ.length;
            cleanQ = cleanQ.replace(leadingFillersPattern, '').trim();
          }

          const trailingFillersPattern = /[.,!\s]*(?:thank\s+you(?:\s+very\s+much)?|thanks|thank|ok|okay|bye|good\s+job|great|awesome|perfect|ah|aha|yeah|yes|sure|right|alright|fine|nice|noida|delhi|mumbai|city|location)[.,!\s]*$/gi;
          prevLen = 0;
          while (cleanQ.length !== prevLen) {
            prevLen = cleanQ.length;
            cleanQ = cleanQ.replace(trailingFillersPattern, '').trim();
          }

          // Deduplicate repeated sentences ("Explain what is React? Explain what is React.")
          const sentenceArr = cleanQ.split(/(?<=[?.!])\s+/).filter(Boolean);
          const uniqArr = [];
          for (const s of sentenceArr) {
            if (uniqArr.length === 0 || uniqArr[uniqArr.length - 1].toLowerCase() !== s.toLowerCase()) {
              uniqArr.push(s);
            }
          }
          cleanQ = uniqArr.join(' ').trim() || cleanQ;

          if (!cleanQ) return;

          const lowerQ = cleanQ.toLowerCase();
          const normQ = lowerQ.replace(/[^a-z0-9\s]/g, ' ').trim();
          const words = normQ.split(/\s+/).filter(Boolean);

          // Ignore interviewer pleasantries ("Thank you", "Good job", "Ah thank you", "Thanks", "Noida")
          const fillerWords = new Set([
            'thank', 'thanks', 'you', 'very', 'much', 'so', 'ok', 'okay', 'great',
            'good', 'job', 'awesome', 'perfect', 'cool', 'got', 'it', 'ah', 'aha',
            'yeah', 'yes', 'sure', 'right', 'alright', 'fine', 'nice', 'sounds',
            'makes', 'sense', 'bye', 'hello', 'hi', 'hey', 'there', 'doing', 'back',
            'well', 'noida', 'delhi', 'bangalore', 'mumbai', 'location', 'city'
          ]);

          if (words.length > 0 && words.every(w => fillerWords.has(w))) {
            console.log(`[Copilot WS] Ignored interviewer pleasantry/acknowledgment: "${cleanQ}"`);
            return;
          }

          // Must contain a question mark OR explicit interview question trigger
          const hasQuestionMark = cleanQ.includes('?');
          const questionTriggers = [
            'what', 'how', 'why', 'where', 'when', 'which', 'who', 'whose', 'whom',
            'can you', 'could you', 'would you', 'will you', 'do you', 'did you',
            'have you', 'are you', 'is there', 'tell me', 'explain', 'describe',
            'walk me through', 'elaborate', 'discuss', 'difference', 'compare',
            'pros and cons', 'trade off', 'tradeoff', 'design', 'implement', 'build',
            'architecture', 'optimize', 'scale', 'experience', 'opinion', 'perspective',
            'thoughts'
          ];
          const hasQuestionTrigger = questionTriggers.some(t => lowerQ.includes(t));

          if (!hasQuestionMark && !hasQuestionTrigger) {
            console.log(`[Copilot WS] Ignored non-question interviewer chatter: "${cleanQ}"`);
            return;
          }

          // Rapid question change interruption for new distinct questions
          if (currentAbortSignal) {
            currentAbortSignal.aborted = true;
            console.log('[Copilot WS] ⚡ Rapid question change! Cancelled previous streaming answer for new question.');
          }

          const abortHandle = { aborted: false };
          currentAbortSignal = abortHandle;

          console.log(`[Copilot WS] Processing Question: "${cleanQ}" [Model: ${selectedModel || 'gemini-1.5-flash'}]`);

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
