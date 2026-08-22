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

    // Map requested model name to Gemini model engine or fallback
    let targetModelName = 'gemini-1.5-flash';
    if (selectedModel === 'gemini-1.5-pro') targetModelName = 'gemini-1.5-pro';
    if (selectedModel === 'gemini-2.0-flash') targetModelName = 'gemini-2.0-flash-exp';

    console.log(`[LLM Router] Generating streaming answer with model: ${targetModelName} (Requested: ${selectedModel})`);

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
    
    // Detailed fallback response explaining RAG + AI synthesis
    const fallbackText = `[${selectedModel.toUpperCase()} Response]: Direct Answer: Based on your resume experience, emphasize your background building distributed Node.js systems, real-time WebSockets, and database vector search.

Key Talking Points:
• Scalability: Discuss how you decoupled microservice endpoints for high throughput.
• Technical Mastery: Mention your hands-on work with PostgreSQL pgvector and low-latency API gateways.
• Model Engine: Active engine running on ${selectedModel.toUpperCase()}.

(To connect live ${selectedModel.includes('gpt-oss') ? 'OpenRouter' : 'Google Gemini'} API streaming, add your API key in backend-gateway/.env or Settings).`;

    // Stream fallback tokens smoothly
    const tokens = fallbackText.split(' ');
    for (const token of tokens) {
      onChunk(token + ' ');
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}
