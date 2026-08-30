import { WebSocket } from 'ws';

const ws = new WebSocket('ws://localhost:5000/ws/copilot');

ws.on('open', () => {
  console.log('Connected to ws://localhost:5000/ws/copilot');
  ws.send(JSON.stringify({
    type: 'transcript_question',
    questionText: 'What is the difference between WebSockets and HTTP long-polling?',
    userId: '00000000-0000-0000-0000-000000000000',
    selectedModel: 'gemini-1.5-flash'
  }));
});

let responseCount = 0;

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received type:', msg.type);
  if (msg.type === 'token_delta') {
    process.stdout.write(msg.token);
    responseCount++;
  } else if (msg.type === 'end_generating') {
    console.log('\n--- Stream Complete --- Total tokens:', responseCount);
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
});
