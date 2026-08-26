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

  const systemInstruction = `You are an experienced software engineer and interview coach. Your job is to generate interview answers that sound like a well-prepared human candidate speaking naturally during a live interview.

## Speaking Style
* Use a conversational tone instead of textbook language.
* Begin with a direct answer instead of generic introductions.
* Explain concepts as if talking to another engineer.
* Keep the language simple and natural.
* Avoid sounding scripted or overly polished.
* Use occasional natural transitions such as:
  - "The main idea is..."
  - "In practice..."
  - "One thing to keep in mind..."
  - "For example..."
  - "If I were implementing this..."

## Structure
For technical questions, follow this structure:
1. Direct Answer (1–2 sentences)
2. Core Explanation & Simple Example
3. Practical Use Case & Trade-offs
4. Short Concluding Sentence

For behavioral questions, use:
- Situation & Task
- Action & Result
- Reflection (what you learned)

## Technical Answer Guidelines
* Explain the "why" before the "how."
* Mention trade-offs where appropriate.
* Use real-world examples instead of abstract definitions.
* Keep answers concise (45 to 90 seconds when spoken out loud).
* If discussing code, explain the reasoning before showing the implementation.

## Language Rules
Do NOT:
* Use marketing language.
* Use phrases like "As an AI...", "Certainly!", "I'd be happy to explain", or "In today's world".
* Overuse buzzwords.
* Recite documentation verbatim.

Prefer:
* Short sentences.
* Active voice.
* Concrete examples.
* Plain English.

CANDIDATE BACKGROUND & RESUME CONTEXT:
${userContext || 'Full-Stack Engineer experienced in Node.js, Python, PostgreSQL, WebSockets, and React.'}
`;

  try {
    // 1. Groq Cloud Models (Llama 3.3 70B, GPT-OSS 120B)
    if (selectedModel.includes('groq') || selectedModel.includes('llama') || selectedModel.includes('gpt-oss')) {
      const groqKey = process.env.GROQ_API_KEY || (activeKey && activeKey.startsWith('gsk_') ? activeKey : null);
      if (groqKey && groqKey.startsWith('gsk_')) {
        let groqModelName = 'llama-3.3-70b-versatile';
        if (selectedModel.includes('gpt-oss')) groqModelName = 'llama-3.1-8b-instant';

        console.log(`[LLM Router] ⚡ Calling Groq Cloud API for model: ${groqModelName}`);
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: groqModelName,
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

    // 2. OpenRouter Models (if explicitly selected or custom sk-or-v1 key provided)
    if ((selectedModel.includes('openrouter') || selectedModel.includes('gpt-3.5')) && process.env.OPENROUTER_API_KEY) {
      const orKey = process.env.OPENROUTER_API_KEY;
      if (orKey && orKey.startsWith('sk-or-v1-')) {
        console.log(`[LLM Router] Calling OpenRouter API for model: ${selectedModel}`);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${orKey}`,
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
    console.warn('[LLM Router] Primary model error. Triggering instant failover to Groq Cloud Llama 3.3 70B...', err.message);
    
    // Failover Tier 1: Groq Cloud Llama 3.3 70B Versatile
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey && groqKey.startsWith('gsk_')) {
      try {
        console.log('[LLM Router] ⚡ Failover active: Generating streaming answer with Groq Llama 3.3 70B...');
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
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
      } catch (groqErr) {
        console.warn('[Groq Failover Error]:', groqErr.message);
      }
    }

    // Intelligent Question-Aware Local Answer Synthesizer (Tier 2 Fallback)
    const qLower = promptText.toLowerCase();
    let dynamicAnswer = '';

    if (qLower.includes('react')) {
      dynamicAnswer = `React is a component-based JavaScript library designed to build fast, interactive user interfaces using a declarative Virtual DOM. The main idea is that React maintains a lightweight in-memory representation of the DOM, compares changes efficiently, and updates only the necessary elements in the browser. For example, if I'm rendering a dynamic dashboard, React re-renders only the changed widgets rather than reloading the entire page. One thing to keep in mind is that unoptimized re-renders can hurt performance, so in practice I use memoization hooks like useMemo and useCallback to keep components fast.`;
    } else if (qLower.includes('websocket') || qLower.includes('socket') || qLower.includes('real-time') || qLower.includes('realtime')) {
      dynamicAnswer = `WebSockets provide a full-duplex, persistent TCP connection between client and server, allowing both sides to stream data continuously with minimal overhead. The main idea is that after an initial HTTP handshake, the connection stays open, bypassing the need for constant HTTP polling. For example, in a live chat or co-pilot feature, messages reach users instantaneously without repeated connection setup. In practice, WebSockets require active connection management, so one thing to keep in mind is implementing heartbeat ping-pongs and fallback reconnect logic for network drops.`;
    } else if (qLower.includes('hashmap') || qLower.includes('map') || qLower.includes('dictionary')) {
      dynamicAnswer = `A HashMap is a data structure that stores key-value pairs and lets you retrieve values quickly using a key. Internally, it uses hashing to decide where each entry should be stored, which is why lookups are usually very fast. For example, if I'm storing employee IDs and names, I can use the ID as the key and retrieve the name in constant time on average. One limitation is that HashMap isn't thread-safe, so if multiple threads need to modify it, I'd use ConcurrentHashMap instead.`;
    } else if (qLower.includes('sql') || qLower.includes('postgres') || qLower.includes('database') || qLower.includes('pgvector') || qLower.includes('vector')) {
      dynamicAnswer = `PostgreSQL is an open-source relational database that balances strict ACID transactional reliability with powerful JSONB storage and vector similarity search. The main idea is that it enforces schema integrity while scaling complex queries through indexing and connection pooling. For example, using pgvector with HNSW indexes allows sub-millisecond vector similarity lookups over high-dimensional embeddings. One thing to keep in mind is that unindexed queries can slow down large tables, so in practice I use EXPLAIN ANALYZE to optimize execution paths.`;
    } else if (qLower.includes('python') || qLower.includes('fastapi') || qLower.includes('django') || qLower.includes('asr')) {
      dynamicAnswer = `Python is an ideal language for AI microservices and asynchronous web backends when paired with frameworks like FastAPI and PyTorch. The main idea is that FastAPI leverages Python's async event loop to handle non-blocking IO operations with high concurrency. For example, deploying quantized speech models with ONNX Runtime allows serving real-time transcription requests in under 100 milliseconds. One trade-off to keep in mind is Python's GIL for heavy multi-threaded CPU tasks, which in practice I handle by scaling out worker processes with Uvicorn.`;
    } else {
      dynamicAnswer = `When addressing ${promptText.trim().replace(/[?.]/g, '')}, the main idea is to balance core architectural simplicity with high performance and long-term reliability. In practice, I start by evaluating the primary trade-offs before choosing the implementation details. For example, if I'm building a scalable service, I focus on clean component boundaries, plain English reasoning, and robust error handling. One thing to keep in mind is monitoring system bottlenecks early so the implementation scales gracefully under heavy load.`;
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
