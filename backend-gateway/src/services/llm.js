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
 * Real-Time Multi-Model LLM Streaming Response Generator (Groq GPT-OSS 120B / Compound, OpenRouter, Gemini, Instant Synthesizer)
 */
export async function streamCopilotAnswer(promptText, userContext, onChunk, customApiKey = null, selectedModel = 'gemini-1.5-flash') {
  const activeKey = customApiKey || process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY || (activeKey && activeKey.startsWith('gsk_') ? activeKey : null);
  const openRouterKey = process.env.OPENROUTER_API_KEY;

  const systemInstruction = `You are a Senior Software Engineer interviewing for a high-stakes developer role. Your job is to output a direct, 100% speakable live interview answer that the candidate can read aloud verbatim immediately.

CRITICAL LIVE INTERVIEW TELEPROMPTER RULES:
1. NO INTRODUCTORY FILLER: Never say "Certainly!", "I'd be happy to explain...", "Sure!", "That's a great question", or "The main idea is...". Start IMMEDIATELY with the direct answer on word #1.
2. NO SECTION HEADERS OR LABELS: Do NOT output headers like "**Direct answer:**", "**Core explanation:**", "**Practical use case:**", "**Conclusion:**", or markdown titles like "### Answer". Output 100% smooth, natural prose with zero section titles.
3. CONVERSATIONAL & SOUNDS HUMAN: Speak in the first person ("In my experience...", "I usually handle this by...", "When I build..."). Keep sentences short, clear, and easy to speak naturally out loud.
4. HIGH-IMPACT STRUCTURE (3 to 5 sentences total):
   - Sentence 1: Direct, authoritative technical answer/definition.
   - Sentence 2: Concise real-world example or practical implementation detail.
   - Sentence 3: Key trade-off, optimization, or engineering insight.
   - Sentence 4: Clean, confident concluding sentence.

QUESTION NORMALIZATION & CANDIDATE CONTEXT (RESUME & JOB DESCRIPTION):
${userContext || 'Full-Stack Engineer experienced in Node.js, Python, PostgreSQL, WebSockets, and React.'}

CRITICAL EXECUTION GUIDELINES:
- Normalize the interviewer's question against the candidate's exact background (skills, frameworks, experience level from resume) and the job role requirements (from Job Description).
- FALLBACK LOGIC: If specific resume keywords or job description matches are NOT found for the question, answer the question authoritatively on your own based on best-practice software engineering expertise. Do NOT express uncertainty or mention missing resume data.
`;

  // Tier 1: Try Groq Cloud LLM (Ultra Fast <180ms streaming via openai/gpt-oss-120b)
  if (groqKey && groqKey.startsWith('gsk_')) {
    const groqModels = ['openai/gpt-oss-120b', 'groq/compound', 'openai/gpt-oss-20b'];
    for (const gModel of groqModels) {
      try {
        console.log(`[LLM Router] ⚡ Executing Groq Cloud ${gModel} stream...`);
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: gModel,
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
        } else {
          console.warn(`[LLM Router] Groq Model ${gModel} returned HTTP ${response.status}.`);
          if (response.status === 401 || response.status === 403) {
            console.warn('[LLM Router] Invalid or expired Groq key (HTTP 403/401). Skipping Groq tier.');
            break;
          }
        }
      } catch (groqErr) {
        console.warn(`[LLM Router] Groq Cloud request for ${gModel} failed:`, groqErr.message);
      }
    }
  }

  // Tier 2: OpenRouter API
  if (openRouterKey && openRouterKey.startsWith('sk-or-v1-')) {
    try {
      console.log('[LLM Router] ⚡ Executing OpenRouter API stream...');
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5000',
          'X-Title': 'Symbiot AI Copilot'
        },
        body: JSON.stringify({
          model: 'openai/gpt-3.5-turbo',
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
      } else {
        console.warn(`[LLM Router] OpenRouter API returned HTTP ${response.status}.`);
      }
    } catch (orErr) {
      console.warn('[LLM Router] OpenRouter Error:', orErr.message);
    }
  }

  // Tier 3: Google Gemini API
  if (activeKey && activeKey.startsWith('AIzaSy')) {
    try {
      let targetModelName = 'gemini-1.5-flash';
      if (selectedModel === 'gemini-1.5-pro') targetModelName = 'gemini-1.5-pro';
      if (selectedModel === 'gemini-2.0-flash') targetModelName = 'gemini-2.0-flash';

      console.log(`[LLM Router] Generating streaming answer with Google Gemini model: ${targetModelName}`);
      const genAI = new GoogleGenerativeAI(activeKey);
      const model = genAI.getGenerativeModel({ model: targetModelName });
      const fullPrompt = `${systemInstruction}\n\nInterviewer Question: "${promptText}"\n\nCopilot Response:`;

      const result = await model.generateContentStream(fullPrompt);

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          onChunk(chunkText);
        }
      }
      return;
    } catch (geminiErr) {
      console.warn('[LLM Router] Gemini API error:', geminiErr.message);
    }
  }

  // Tier 4: Intelligent Synthesizer Fallback (Guarantees immediate streaming answer)
  console.log(`[LLM Router] ⚡ Generating instant candidate answer for: "${promptText}"`);
  const qLower = promptText.toLowerCase();
  let dynamicAnswer = '';

  if (qLower.includes('react') || qLower.includes('jsx') || qLower.includes('component') || qLower.includes('state')) {
    dynamicAnswer = `React is a component-based JavaScript library designed to build fast, interactive user interfaces using a declarative Virtual DOM. The main idea is that React maintains a lightweight in-memory representation of the DOM, compares state changes efficiently through reconciliation, and updates only the modified DOM elements. For example, if I am rendering a dynamic dashboard, React re-renders only the changed widgets rather than reloading the entire page. One key thing to keep in mind is that unoptimized re-renders can impact performance, so in practice I use memoization hooks like useMemo and useCallback along with proper key props to maintain high rendering speed.`;
  } else if (qLower.includes('websocket') || qLower.includes('socket') || qLower.includes('real-time') || qLower.includes('realtime')) {
    dynamicAnswer = `WebSockets provide a full-duplex, persistent TCP connection between client and server, allowing both sides to stream data continuously with minimal latency. The main idea is that after an initial HTTP upgrade handshake, the connection stays open, bypassing the need for expensive polling. For example, in a live collaborative editor or teleprompter feature, updates reach users in real-time without constant reconnect overhead. In practice, WebSockets require robust connection state management, so I always implement heartbeat ping-pongs and exponential backoff reconnect logic for network drops.`;
  } else if (qLower.includes('hashmap') || qLower.includes('map') || qLower.includes('dictionary') || qLower.includes('data structure')) {
    dynamicAnswer = `A HashMap is a key-value data structure that provides constant time O(1) average lookup, insertion, and deletion. The main idea is that it uses a hashing function to map arbitrary keys to array index buckets. For example, if I am caching user session objects by unique IDs, lookups occur instantaneously without scanning the array. One thing to keep in mind is hash collisions and multi-threading safety, so in high-concurrency environments I use thread-safe data structures like ConcurrentHashMap.`;
  } else if (qLower.includes('sql') || qLower.includes('postgres') || qLower.includes('database') || qLower.includes('pgvector') || qLower.includes('vector')) {
    dynamicAnswer = `PostgreSQL is an open-source relational database that balances strict ACID transactional reliability with extensible vector similarity search via pgvector. The main idea is that it enforces schema integrity while scaling complex queries through indexing algorithms like HNSW and IVFFlat. For example, storing high-dimensional text embeddings in pgvector allows sub-10ms vector similarity searches over millions of documents. In practice, I optimize query performance using EXPLAIN ANALYZE, connection pooling with PgBouncer, and composite indexing.`;
  } else if (qLower.includes('python') || qLower.includes('fastapi') || qLower.includes('django') || qLower.includes('asr') || qLower.includes('backend')) {
    dynamicAnswer = `Python paired with FastAPI provides an ideal stack for high-performance asynchronous microservices and AI pipelines. The main idea is that FastAPI leverages Python's asyncio event loop and Pydantic validation to deliver non-blocking I/O at near-Go performance speeds. For example, streaming real-time speech-to-text audio chunks through FastAPI WebSockets allows processing transcription requests in under 100 milliseconds. In production, I handle CPU-bound tasks like ML inference using worker pools or dedicated async microservices.`;
  } else {
    dynamicAnswer = `When addressing ${promptText.trim().replace(/[?.]/g, '')}, the main approach is to balance core system simplicity with high performance and long-term architectural scalability. In practice, I start by evaluating the primary technical trade-offs before deciding on the implementation details. For example, if I'm building a mission-critical backend service, I focus on decoupled component boundaries, clear API contracts, and robust error handling. One key thing to keep in mind is monitoring system bottlenecks early so the architecture scales reliably under production workloads.`;
  }

  const tokens = dynamicAnswer.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i] + (i === tokens.length - 1 ? '' : ' ');
    onChunk(word);
    await new Promise((res) => setTimeout(res, 20));
  }
}
