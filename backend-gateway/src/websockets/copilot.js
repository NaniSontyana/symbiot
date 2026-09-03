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

          // 1. Strip leading non-alphanumeric noise (. , - ... etc.)
          let cleanQ = questionText.trim().replace(/^[^a-zA-Z0-9]+/, '').trim();

          // 2. Strip unnecessary filler words & farewell pleasantries ("thank you", "see you soon", "good job", etc.)
          const unnecessaryPhrases = [
            /see\s+you(?:\s+soon|\s+later)?/gi,
            /see\s+ya/gi,
            /talk\s+to\s+you\s+later/gi,
            /catch\s+you\s+later/gi,
            /take\s+care/gi,
            /have\s+a\s+(?:good|great|nice)\s+(?:day|evening|night|time)/gi,
            /thank\s+you(?:\s+very\s+much|\s+so\s+much|\s+again)?/gi,
            /thanks(?:\s+a\s+lot|\s+again)?/gi,
            /good\s+job/gi,
            /great\s+job/gi,
            /nice\s+job/gi,
            /good\s+morning/gi,
            /good\s+afternoon/gi,
            /good\s+evening/gi,
            /good\s+night/gi,
            /nice\s+(?:to\s+meet\s+you|meeting\s+you)/gi,
            /glad\s+(?:to\s+meet\s+you|meeting\s+you)/gi,
            /\b(?:hello|hi|hey|bye|goodbye|thanks|thankyou|thx|cheers|noida|delhi|mumbai|city|location)\b/gi,
            /\b(?:okay|ok)\s+(?:cool|awesome|great|perfect|thanks|thank\s+you)\b/gi
          ];

          for (const pRegex of unnecessaryPhrases) {
            cleanQ = cleanQ.replace(pRegex, ' ');
          }
          cleanQ = cleanQ.replace(/[,\s]+/g, ' ').replace(/\s+([?.!])/g, '$1').replace(/^[^a-zA-Z0-9]+/, '').trim();

          // 3. Strip repetitive leading/trailing pleasantry noise ("Thank you", "Thanks", "See you soon")
          const leadingFillersPattern = /^(?:thank\s+you|thanks|thank|ok|okay|hi|hello|hey|good\s+job|great|awesome|perfect|ah|aha|yeah|yes|sure|right|alright|fine|nice|so|and|then|noida|delhi|mumbai|city|location|bye)[.,!\s]*/gi;
          let prevLen = 0;
          while (cleanQ.length !== prevLen) {
            prevLen = cleanQ.length;
            cleanQ = cleanQ.replace(leadingFillersPattern, '').trim();
          }

          const trailingFillersPattern = /[.,!\s]*(?:thank\s+you(?:\s+very\s+much)?|thanks|thank|ok|okay|bye|good\s+job|great|awesome|perfect|ah|aha|yeah|yes|sure|right|alright|fine|nice|noida|delhi|mumbai|city|location|see\s+you|see\s+you\s+soon|see\s+ya)[.,!\s]*$/gi;
          prevLen = 0;
          while (cleanQ.length !== prevLen) {
            prevLen = cleanQ.length;
            cleanQ = cleanQ.replace(trailingFillersPattern, '').trim();
          }

          // 4. Deduplicate repeated consecutive words/phrases (1-5 words long, e.g. "What is What is CSS?" -> "What is CSS?")
          let prevText = '';
          while (cleanQ !== prevText) {
            prevText = cleanQ;
            cleanQ = cleanQ.replace(/\b(\w+(?:\s+\w+){0,4})([?.,!\s]+)\1\b/gi, '$1$2');
          }

          // 5. Deduplicate repeated identical consecutive sentences
          const sentenceArr = cleanQ.split(/(?<=[?.!])\s+/).filter(Boolean);
          const uniqArr = [];
          for (const s of sentenceArr) {
            const cleanS = s.trim();
            if (uniqArr.length === 0 || uniqArr[uniqArr.length - 1].toLowerCase() !== cleanS.toLowerCase()) {
              uniqArr.push(cleanS);
            }
          }
          cleanQ = uniqArr.join(' ').trim() || cleanQ;
          cleanQ = cleanQ.replace(/^[^a-zA-Z0-9]+/, '').trim();

          if (cleanQ.length > 0) {
            cleanQ = cleanQ.charAt(0).toUpperCase() + cleanQ.slice(1);
          }

          if (!cleanQ) return;

          const lowerQ = cleanQ.toLowerCase();
          const normQ = lowerQ.replace(/[^a-z0-9\s]/g, ' ').trim();
          const words = normQ.split(/\s+/).filter(Boolean);

          const hasQuestionMark = cleanQ.includes('?');

          // Filter out short 1-3 word noise unless ending with explicit ?
          if (words.length < 4 && !hasQuestionMark) {
            console.log(`[Copilot WS] Ignored short noise utterance (${words.length} words): "${cleanQ}"`);
            return;
          }

          // Meeting setup & audio check blocklist
          const setupBlocklist = [
            'can you hear me', 'hear me okay', 'am i audible', 'can you see my screen',
            'is my screen visible', 'screen is visible', 'let me share my screen',
            'sharing my screen', 'how are you', 'how is it going', 'nice to meet you',
            'what is up', "what's up", 'testing mic', 'audio check', 'testing 1 2 3',
            'one moment', 'give me a second', 'just a minute', 'hang on', 'stand by'
          ];
          if (setupBlocklist.some(phrase => lowerQ.includes(phrase))) {
            console.log(`[Copilot WS] Ignored meeting setup chatter: "${cleanQ}"`);
            return;
          }

          // Ignore interviewer pleasantries & casual background chatter ("Thank you", "Good job", etc.)
          const fillerWords = new Set([
            'thank', 'thanks', 'you', 'very', 'much', 'so', 'ok', 'okay', 'great',
            'good', 'job', 'awesome', 'perfect', 'cool', 'got', 'it', 'ah', 'aha',
            'yeah', 'yes', 'sure', 'right', 'alright', 'fine', 'nice', 'sounds',
            'makes', 'sense', 'bye', 'hello', 'hi', 'hey', 'there', 'doing', 'back',
            'well', 'noida', 'delhi', 'bangalore', 'mumbai', 'location', 'city',
            'know', 'happy', 'day', 'one', 'did', 'leg', 'now', 'what', 'this',
            'question', 'questioon', 'testing', 'check', 'audio', 'mic'
          ]);

          if (words.length > 0 && words.every(w => fillerWords.has(w))) {
            console.log(`[Copilot WS] Ignored interviewer pleasantry/acknowledgment/noise: "${cleanQ}"`);
            return;
          }

          // Ignore meta-questions about the transcription system
          const isMetaQuestion = /^(?:what\s+(?:is\s+)?(?:this\s+)?questio+n\??|what\??\s*what\??|can\s+you\s+hear\s+me\??|testing\s+audio\??)$/i.test(normQ);
          if (isMetaQuestion) {
            console.log(`[Copilot WS] Ignored meta-question noise: "${cleanQ}"`);
            return;
          }

          // Candidate self-talk & first-person candidate answer phrases ("I'm going to...", "I'm trying to...", "Let me see...")
          const candidateSpeechBlocklist = [
            "i'm going to", "i am going to", "i'm trying to", "i am trying to",
            "i'm not sure", "i am not sure", "i just want to", "let me see",
            "let me check", "what i'm doing", "what i am doing", "i'm ready to",
            "i will explain", "i'm going to tell you", "i'm going to go",
            "so i'm", "so i am", "my experience is", "in my project", "i'll tell you",
            "we're not going to", "we are not going to", "i just looking",
            "what i meant", "what i mean", "what i did", "what we did", "what we have",
            "how we solved", "how we handled", "how we built", "why we chose", "why we used"
          ];
          if (candidateSpeechBlocklist.some(d => lowerQ.includes(d))) {
            console.log(`[Copilot WS] Ignored candidate speech/self-talk: "${cleanQ}"`);
            return;
          }

          // Must contain a question mark OR explicit interview question trigger
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
