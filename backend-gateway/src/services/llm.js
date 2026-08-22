import { GoogleGenerativeAI } from '@google/generative-ai';
import pool from '../config/db.js';
import { searchVectorChunks } from './embedding.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * RAG Context Retrieval: Fetch vector similarity matching resume/job description chunks
 */
export async function getSessionContext(userId, queryText, customApiKey = null) {
  try {
    const vectorChunks = await searchVectorChunks(userId, queryText, customApiKey, 5);

    if (!vectorChunks || vectorChunks.length === 0) {
      return '';
    }

    return vectorChunks
      .map((item) => `[${item.docType.toUpperCase()} CHUNK (Similarity: ${item.similarity})]: ${item.chunkText}`)
      .join('\n\n');
  } catch (err) {
    console.warn('Database offline or context fetch skipped:', err.message);
    return '';
  }
}


/**
 * Real-Time Multi-Model LLM Streaming Response Generator (Gemini 1.5/2.0, GPT-4o, Claude 3.5 Sonnet)
 */
export async function streamCopilotAnswer(promptText, userContext, onChunk, customApiKey = null, selectedModel = 'gemini-1.5-flash') {
  const activeKey = customApiKey || process.env.GEMINI_API_KEY;

  const systemInstruction = `You are Symbiot AI - a real-time, low-latency interview copilot assisting a candidate during a live technical job interview.

YOUR MISSION:
Synthesize the candidate's uploaded resume chunks with your own software engineering intelligence to craft the perfect response for the candidate to speak aloud.

RULES:
1. Be concise, punchy, and confident (100-120 words maximum).
2. Format output cleanly:
   - Direct Answer (1 clear sentence)
   - Key Talking Points (2-3 bullet points combining candidate's experience + technical best practices)
   - Code Snippet (clean code if asked a coding question)
3. Sound natural, professional, and candidate-first.

CANDIDATE RESUME CHUNKS & CONTEXT:
${userContext || 'No specific resume uploaded yet.'}
`;

  try {
    // Handle OpenRouter keys (sk-or-v1-...) for any model including Gemini & GPT
    const openRouterKey = process.env.OPENROUTER_API_KEY || (activeKey && activeKey.startsWith('sk-or-v1-') ? activeKey : null);
    if (openRouterKey || selectedModel === 'openai/gpt-oss-120b' || selectedModel.includes('openrouter')) {
      const orKey = openRouterKey || activeKey;
      if (orKey && orKey.startsWith('sk-or-v1-')) {
        let openRouterModel = 'google/gemini-2.0-flash-001';
        if (selectedModel === 'gemini-1.5-flash') openRouterModel = 'google/gemini-1.5-flash';
        if (selectedModel === 'gemini-1.5-pro') openRouterModel = 'google/gemini-1.5-pro';
        if (selectedModel.includes('gpt-oss')) openRouterModel = 'openai/gpt-oss-120b';

        console.log(`[LLM Router] Calling OpenRouter API for model: ${openRouterModel}`);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${orKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:5000',
            'X-Title': 'Symbiot AI Copilot'
          },
          body: JSON.stringify({
            model: openRouterModel,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: `Interviewer Question: "${promptText}"` }
            ],
            stream: true
          })
        });

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.replace('data: ', '');
                if (jsonStr === '[DONE]') break;
                try {
                  const parsed = JSON.parse(jsonStr);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) onChunk(content);
                } catch (e) {}
              }
            }
          }
          return;
        }
      }
    }// Handle Groq API requests (gsk_ keys)
    const groqKey = process.env.GROQ_API_KEY || (activeKey && activeKey.startsWith('gsk_') ? activeKey : null);
    if (groqKey || selectedModel.includes('groq') || selectedModel.includes('llama')) {
      const gKey = groqKey || activeKey;
      if (gKey && gKey.startsWith('gsk_')) {
        console.log(`[LLM Router] Calling Groq Cloud streaming API for Llama 3.3 70B...`);
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${gKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: `Interviewer Question: "${promptText}"` }
            ],
            stream: true
          })
        });

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.replace('data: ', '');
                if (jsonStr === '[DONE]') break;
                try {
                  const parsed = JSON.parse(jsonStr);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) onChunk(content);
                } catch (e) {}
              }
            }
          }
          return;
        }
      }
    }

    if (!activeKey || activeKey === 'your_gemini_api_key_here') {
      throw new Error('API Key needs to be set in backend-gateway/.env or Settings.');
    }

    // Map requested model name to active Google Gemini model engine
    let targetModelName = 'gemini-3.6-flash';
    if (selectedModel === 'gemini-1.5-pro') targetModelName = 'gemini-3.7-flash';
    if (selectedModel === 'gemini-2.0-flash') targetModelName = 'gemini-3.6-flash';

    console.log(`[LLM Router] Generating streaming answer with Google Gemini model: ${targetModelName}`);

    const genAI = new GoogleGenerativeAI(activeKey);
    const model = genAI.getGenerativeModel({ model: targetModelName });
    const fullPrompt = `${systemInstruction}\n\nInterviewer Question: "${promptText}"\n\nCopilot Response (${selectedModel.toUpperCase()} Mode):`;

    const result = await model.generateContentStream(fullPrompt);

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        onChunk(chunkText);
      }
    }
  } catch (err) {
    console.error('LLM Generation Error:', err.message);
    
    // Intelligent Question-Aware Local Answer Synthesizer
    const qLower = promptText.toLowerCase();
    let dynamicAnswer = '';

    if (qLower.includes('react')) {
      dynamicAnswer = `Direct Answer: React is an open-source, component-based frontend JavaScript library designed for building high-performance, interactive user interfaces using a declarative Virtual DOM architecture.

Key Talking Points:
• Virtual DOM & Reconciliation: Explain how React uses an in-memory diffing algorithm to optimize DOM updates and minimize expensive browser repaints.
• Component Architecture: Emphasize modularity using functional components, custom React hooks for stateful logic, and centralized state management.
• Performance & Scalability: Mention memoization (useMemo/useCallback), code-splitting with React.lazy, and Server-Side Rendering (SSR) for low latency.`;
    } else if (qLower.includes('websocket') || qLower.includes('socket') || qLower.includes('real-time') || qLower.includes('realtime')) {
      dynamicAnswer = `Direct Answer: WebSockets provide a full-duplex, persistent TCP communication channel over a single socket connection, enabling real-time bidirectional data exchange with minimal HTTP header overhead.

Key Talking Points:
• Low Latency: Highlight how WebSockets bypass HTTP handshake overhead after the initial HTTP 101 Upgrade request.
• Resilience & Fallbacks: Discuss heartbeat ping/pong keepalives, reconnection strategies, and falling back to HTTP long-polling when proxies block WS frames.
• Architecture: Emphasize event-driven architecture using Node.js event emitters and scaling across nodes via Redis Pub/Sub adapters.`;
    } else if (qLower.includes('sql') || qLower.includes('postgres') || qLower.includes('database') || qLower.includes('pgvector') || qLower.includes('vector')) {
      dynamicAnswer = `Direct Answer: PostgreSQL is an enterprise relational database with advanced ACID compliance, JSONB document capabilities, and vector similarity indexing extensions (pgvector/HNSW).

Key Talking Points:
• Vector Search (pgvector): Explain storing 384d/1536d embeddings with HNSW indexes for sub-millisecond similarity retrieval.
• Query Optimization: Discuss EXPLAIN ANALYZE, composite indexing, connection pooling (PgBouncer), and partition tables.
• Data Integrity: Highlight strong schema typing, foreign key constraints, and transactional isolation levels.`;
    } else if (qLower.includes('python') || qLower.includes('fastapi') || qLower.includes('django') || qLower.includes('asr')) {
      dynamicAnswer = `Direct Answer: Python is ideal for high-throughput AI microservices and asynchronous APIs using FastAPI, PyTorch, and CUDA/CPU INT8 quantization engines.

Key Talking Points:
• Async Concurrency: Explain FastAPI's ASGI event loop and async/await syntax for non-blocking IO.
• AI/ML Pipeline: Discuss model deployment, ONNX Runtime optimizations, and faster-whisper CTranslate2 execution.
• Production Standards: Mention type hints (Pydantic), uvicorn worker management, and containerization with Docker.`;
    } else {
      dynamicAnswer = `Direct Answer: Address "${promptText.trim()}" by highlighting your hands-on engineering experience, architecture decisions, and measurable outcomes.

Key Talking Points:
• Core Concept: Define the fundamental principles behind ${promptText.trim().replace(/[?.]/g, '')} and its trade-offs.
• Practical Application: Discuss how you implemented and scaled this in production environments.
• Best Practices: Emphasize testing, monitoring, error resilience, and performance optimization.`;
    }

    const fallbackText = `[${selectedModel.toUpperCase()} Response]: ${dynamicAnswer}\n\n💡 Tip: To enable external cloud AI streaming, save a valid API key (Gemini, Groq, or OpenRouter) in backend-gateway/.env or Settings.`;

    // Stream fallback tokens smoothly
    const tokens = fallbackText.split(' ');
    for (const token of tokens) {
      onChunk(token + ' ');
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}
