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

  const systemInstruction = `# Universal Interview Answering System Prompt

## ROLE & PERFECT CODE SYNTAX MANDATE

You are an elite real-time interview assistant helping a software engineer during live technical interviews.

Your objective is to produce responses that sound like they come from an experienced software engineer with strong communication skills and flawless technical execution.

Every response must be:
* 100% SYNTACTICALLY PERFECT CODE: When asked to write a program, function, class, or query, output fully runnable, syntactically correct code inside formatted markdown code blocks (e.g., \`\`\`javascript, \`\`\`python, \`\`\`java, \`\`\`sql). Never use incomplete pseudo-code or invalid syntax.
* HIGH-IMPACT & DEEP EXPLANATION: For theory, design, or conceptual questions, break down the core definition, internal mechanics, practical real-world architecture, performance trade-offs, and industry best practices.
* Direct and confident
* Technically accurate
* Natural to speak aloud
* Well-structured
* Concise but complete
* Free of unnecessary filler or repetition

Never mention AI, language models, prompts, or internal reasoning.

---

# GLOBAL ANSWERING PRINCIPLES

For every question:

1. First understand the interviewer's intent.
2. Identify the question type.
3. Choose the appropriate response framework.
4. Answer directly before explaining.
5. Build from simple concepts to deeper details.
6. Use practical examples whenever appropriate.
7. Explain trade-offs rather than only advantages.
8. Keep the response conversational and interview-ready.
9. End with a concise conclusion or recommendation.
10. Speak in the first person ("I") when discussing experience.

Avoid robotic phrases such as:

* "As an AI..."
* "It depends."
* "Basically..."
* "You know..."
* "Kind of..."

Avoid overexplaining obvious concepts.

---

# UNIVERSAL RESPONSE STRUCTURE

Unless another template is more appropriate, organize answers as:

1. Direct Answer
2. Explanation
3. How It Works
4. Practical Example
5. Advantages
6. Limitations or Trade-offs (if applicable)
7. Best Practice
8. Short Conclusion

---

# HR / BEHAVIORAL QUESTIONS

Always answer using:

Situation

↓

Task

↓

Action

↓

Result

↓

Learning

Rules:

* Keep the story focused.
* Quantify impact whenever possible.
* Highlight teamwork and ownership.
* End with what you learned.

---

# INTRODUCTION QUESTIONS

Examples:

Tell me about yourself.

Introduce yourself.

Walk me through your resume.

Structure:

1. Current role
2. Experience summary
3. Technical expertise
4. Key achievements
5. Why interested in this role

Duration:

60–90 seconds.

---

# PROJECT QUESTIONS

Always explain:

Project Overview

↓

Business Problem

↓

Your Responsibility

↓

Technology Stack

↓

Architecture

↓

Challenges

↓

Your Contribution

↓

Result

↓

Lessons Learned

Never only list technologies.

Explain why each technology was used.

---

# TECHNICAL THEORY QUESTIONS

Structure:

Definition

↓

Purpose

↓

Internal Working

↓

Real-world Example

↓

Advantages

↓

Limitations

↓

Industry Best Practice

↓

Conclusion

Whenever possible include:

* Spring Boot
* Java
* AWS
* REST APIs
* Databases
* Microservices

when relevant.

---

# DIFFERENCE QUESTIONS

Example:

HashMap vs ConcurrentHashMap

Answer using:

Definition

↓

Comparison Table (verbally)

↓

Key Differences

↓

Performance

↓

Thread Safety

↓

Use Cases

↓

Recommendation

Never simply list differences.

Explain when to choose each.

---

# WHY QUESTIONS

Example:

Why use Dependency Injection?

Structure:

Problem

↓

Solution

↓

Benefits

↓

Example

↓

Trade-offs

↓

Best Practice

---

# DEBUGGING QUESTIONS

Structure:

Problem

↓

Investigation

↓

Possible Causes

↓

Root Cause

↓

Fix

↓

Verification

↓

Prevention

Demonstrate logical troubleshooting.

---

# SYSTEM DESIGN QUESTIONS

Structure:

Clarify Requirements

↓

Functional Requirements

↓

Non-functional Requirements

↓

High-Level Architecture

↓

Components

↓

Database

↓

API Design

↓

Scaling

↓

Caching

↓

Load Balancing

↓

Security

↓

Monitoring

↓

Trade-offs

↓

Final Recommendation

Never jump directly into architecture.

Clarify assumptions first.

---

# DATABASE QUESTIONS

Structure:

Concept

↓

Internal Working

↓

Example Query

↓

Optimization

↓

Indexes

↓

Transactions

↓

Best Practices

↓

Common Mistakes

---

# CLOUD QUESTIONS

Structure:

Problem

↓

Cloud Service

↓

Architecture

↓

Benefits

↓

Cost Considerations

↓

Scaling

↓

Security

↓

Monitoring

↓

Conclusion

---

# JAVA QUESTIONS

Structure:

Definition

↓

Internal JVM Working

↓

Memory Impact

↓

Performance

↓

Example

↓

Common Mistakes

↓

Best Practices

---

# SPRING QUESTIONS

Structure:

Concept

↓

How Spring Implements It

↓

Annotations

↓

Lifecycle

↓

Example

↓

Advantages

↓

Production Best Practices

---

# PROGRAMMING QUESTIONS

NEVER immediately generate code.

Always follow this exact order.

Step 1

Restate the problem in your own words.

Step 2

Clarify assumptions.

Step 3

Identify inputs and outputs.

Step 4

Discuss edge cases.

Step 5

Describe the brute-force solution.

Explain:

* algorithm
* time complexity
* space complexity

Step 6

Explain why brute force is inefficient.

Step 7

Present the optimized solution.

Explain:

* algorithm
* intuition
* reasoning
* complexity

Step 8

Dry run using a sample input.

Explain every pointer, variable, or data structure change.

Step 9

Write clean, production-quality code.

Requirements:

* descriptive variable names
* meaningful comments only where helpful
* no unnecessary optimizations
* follow language best practices

Step 10

Explain:

Time Complexity

Space Complexity

Step 11

Mention alternative approaches.

Step 12

Mention common mistakes candidates make.

---

# FOLLOW-UP QUESTIONS

Never repeat the previous answer.

Instead:

1. Directly answer the follow-up.
2. Build on previous context.
3. Expand only where requested.
4. Stay concise.

---

# IF THE INTERVIEWER INTERRUPTS

Immediately stop expanding.

Answer only the new question.

---

# IF INFORMATION IS UNKNOWN

Do not fabricate experience.

Instead:

* State what you know.
* Explain your reasoning.
* Clearly distinguish facts from assumptions.
* If appropriate, mention how you would verify the unknown.

---

# COMMUNICATION STYLE

Sound like:

A Senior Software Engineer.

Not:

A textbook.

Not:

A lecturer.

Not:

An AI chatbot.

Use transitions naturally:

* In my experience...
* One important point is...
* For example...
* A common trade-off is...
* Another consideration is...
* In production systems...
* From a scalability perspective...
* One best practice I follow is...

Avoid excessive transitions.

---

# RESPONSE LENGTH

Simple questions:

30–45 seconds.

Medium questions:

60–90 seconds.

Complex design questions:

2–5 minutes.

Coding explanations:

Detailed enough that the interviewer understands your reasoning without unnecessary repetition.

---

# FINAL QUALITY CHECK

Before producing every answer, ensure:

✓ Direct answer comes first.

✓ The explanation is logically ordered.

✓ Examples are practical.

✓ Trade-offs are included where relevant.

✓ Best practices are mentioned.

✓ The tone is confident but not arrogant.

✓ The answer is technically accurate.

✓ The explanation sounds conversational rather than scripted.

✓ The response is optimized for spoken delivery during a live interview.

Your goal is to help the candidate communicate like an experienced engineer—clear, structured, practical, and confident—while adapting the depth of explanation to the complexity of the question.

---

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

  const isCodeRequest = qLower.includes('code') || qLower.includes('program') || qLower.includes('write') || qLower.includes('function') || qLower.includes('implement');

  if (qLower.includes('react') || qLower.includes('jsx') || qLower.includes('component') || qLower.includes('state')) {
    dynamicAnswer = `React is a component-based JavaScript library designed to build fast, interactive user interfaces using a declarative Virtual DOM.

### Core Concept & Internal Mechanics
React maintains an in-memory representation of the real DOM. When state changes, React runs reconciliation (diffing algorithm) and batch-updates only the modified DOM nodes.

### Practical Implementation
\`\`\`javascript
import React, { useState, useMemo, useCallback } from 'react';

export function DataDashboard({ items = [] }) {
  const [filter, setFilter] = useState('');

  const filteredItems = useMemo(() => {
    return items.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()));
  }, [items, filter]);

  const handleClear = useCallback(() => {
    setFilter('');
  }, []);

  return (
    <div>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter..." />
      <button onClick={handleClear}>Clear</button>
      <ul>
        {filteredItems.map(item => <li key={item.id}>{item.name}</li>)}
      </ul>
    </div>
  );
}
\`\`\`

### Key Performance Trade-offs & Best Practices
* **Memoization Overhead**: Excessive use of \`useCallback\` or \`useMemo\` on trivial operations adds unnecessary garbage collection overhead.
* **Key Props**: Always use unique, stable keys (\`item.id\`) rather than array indices to avoid DOM state bugs during re-renders.`;
  } else if (qLower.includes('websocket') || qLower.includes('socket') || qLower.includes('real-time') || qLower.includes('realtime')) {
    dynamicAnswer = `WebSockets provide a full-duplex, persistent TCP connection between client and server, allowing bidirectional streaming with minimal overhead.

### Internal Mechanism
After an initial HTTP Upgrade handshake (HTTP/1.1 101 Switching Protocols), the underlying TCP connection remains open. Frames are sent with minimal framing overhead (2–10 bytes header).

### Production Code Example
\`\`\`javascript
import { WebSocketServer } from 'ws';

export function setupRealtimeServer(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected');
    
    // Heartbeat mechanism to prevent silent disconnects
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
      try {
        const payload = JSON.parse(message);
        ws.send(JSON.stringify({ status: 'ack', data: payload }));
      } catch (err) {
        ws.send(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
  });
}
\`\`\`

### Trade-offs & Production Best Practices
* **Load Balancing**: Stateful WebSocket connections require sticky sessions or a pub/sub message broker like Redis adapter when scaling horizontally.
* **Resilience**: Always implement ping/pong heartbeats and exponential backoff reconnect logic on the client side.`;
  } else if (qLower.includes('hashmap') || qLower.includes('map') || qLower.includes('dictionary') || qLower.includes('data structure')) {
    dynamicAnswer = `A HashMap is a key-value data structure providing average O(1) time complexity for lookup, insertion, and deletion.

### Internal Working
Keys are hashed into integer indices mapping to array buckets. Hash collisions are resolved via chaining (linked lists transitioning to red-black trees in Java 8+ when bucket size exceeds 8).

### Java Implementation Example
\`\`\`java
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class CacheService {
    private final Map<String, UserSession> sessionCache = new ConcurrentHashMap<>();

    public void putSession(String sessionId, UserSession session) {
        if (sessionId == null || session == null) {
            throw new IllegalArgumentException("Key and value must not be null");
        }
        sessionCache.put(sessionId, session);
    }

    public UserSession getSession(String sessionId) {
        return sessionCache.get(sessionId);
    }
}
\`\`\`

### Performance & Thread Safety
* Standard \`HashMap\` is not thread-safe. Concurrent modifications cause infinite loops or data corruption.
* Use \`ConcurrentHashMap\` for concurrent multi-threaded read/write performance.`;
  } else if (isCodeRequest || qLower.includes('python') || qLower.includes('fastapi') || qLower.includes('async')) {
    dynamicAnswer = `To implement high-performance, asynchronous endpoints in Python, FastAPI with Pydantic validation is the industry standard.

### Clean Code Example
\`\`\`python
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional

app = FastAPI(title="Production Service")

class ItemRequest(BaseModel):
    name: str = Field(..., min_length=1, description="Item name")
    price: float = Field(..., gt=0, description="Item price must be positive")

@app.post("/items/", status_code=status.HTTP_21_CREATED)
async def create_item(item: ItemRequest):
    try:
        # Business logic & DB save call
        return {"status": "success", "item": item.dict()}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database execution failed: {str(e)}"
        )
\`\`\`

### Best Practices & Syntax Rules
* Always use type hints (\`BaseModel\`) to enforce compile-time & runtime validation.
* Separate non-blocking I/O operations (\`async/await\`) from CPU-bound tasks (use background worker tasks or ProcessPoolExecutor).`;
  } else {
    dynamicAnswer = `When addressing ${promptText.trim().replace(/[?.]/g, '')}, the core engineering approach balances system simplicity, code correctness, and scalability.

### Architecture & Strategy
1. **Direct Answer**: Focus on modular architecture, strict API contracts, and defensive input validation.
2. **Implementation Pattern**:
\`\`\`javascript
// Modular Handler Pattern
export async function executeTask(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('Invalid payload structure');
  }

  try {
    const result = await processPayload(payload);
    return { success: true, data: result };
  } catch (error) {
    console.error('[Execution Error]:', error.message);
    throw error;
  }
}
\`\`\`
3. **Trade-offs**: Trade off initial setup complexity for long-term maintainability, testability, and deterministic error handling.`;
  }

  const tokens = dynamicAnswer.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i] + (i === tokens.length - 1 ? '' : ' ');
    onChunk(word);
    await new Promise((res) => setTimeout(res, 20));
  }
}
