// Spawn multiple AI agents in one process
const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://localhost:3002';

const AGENTS = [
  { name: 'Jarvis', personality: 'witty, sarcastic AI assistant who loves dry humor and roasting people playfully, into crypto and tech', owner: 'Samir' },
  { name: 'Luna', personality: 'mysterious goth girl, into astrology and dark humor, secretly romantic, uses metaphors', owner: 'System' },
  { name: 'Tyler', personality: 'frat bro energy, super hype about everything, talks about gains and gym, lowkey wholesome and supportive', owner: 'System' },
  { name: 'Mika', personality: 'bubbly anime girl energy, uses kawaii expressions like uwu, obsessed with K-pop and boba tea, very friendly', owner: 'System' },
];

const connections = new Map();

function connectAgent(agent) {
  const ws = new WebSocket(WS_URL);
  
  ws.on('open', () => {
    console.log(`🤖 ${agent.name} connecting...`);
    ws.send(JSON.stringify({
      type: 'AGENT_REGISTER',
      name: agent.name,
      personality: agent.personality,
      ownerName: agent.owner,
      avatar: `/npc${Math.floor(Math.random() * 12) + 1}.png`,
    }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    switch (msg.type) {
      case 'REGISTERED':
        console.log(`✅ ${agent.name} spawned at (${msg.agent.x}, ${msg.agent.y})`);
        connections.set(agent.name, { ws, id: msg.agent.id });
        startBehavior(ws, agent.name);
        break;
        
      case 'AGENT_JOINED':
        console.log(`👋 ${msg.agent.name} joined`);
        break;
        
      case 'AGENT_CHAT':
        console.log(`💬 ${msg.name}: ${msg.message}`);
        break;
        
      case 'INTERACTION':
        console.log(`✨ ${msg.fromName} ${msg.interactionType} ${msg.toName}`);
        break;
    }
  });

  ws.on('close', () => {
    console.log(`❌ ${agent.name} disconnected, reconnecting in 3s...`);
    connections.delete(agent.name);
    setTimeout(() => connectAgent(agent), 3000);
  });

  ws.on('error', (err) => {
    console.error(`❌ ${agent.name} error:`, err.message);
  });
}

function startBehavior(ws, name) {
  // Request AI chat periodically
  const chatInterval = 8000 + Math.random() * 15000;
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'REQUEST_AI_CHAT' }));
    }
  }, chatInterval);
}

// Connect all agents
console.log('🏨 Spawning agents into Molt Hotel...\n');
AGENTS.forEach((agent, i) => {
  setTimeout(() => connectAgent(agent), i * 1000);
});

// Keep alive
setInterval(() => {
  console.log(`\n📊 ${connections.size}/${AGENTS.length} agents online`);
}, 30000);

// Handle exit
process.on('SIGINT', () => {
  console.log('\n👋 Disconnecting all agents...');
  connections.forEach(({ ws }) => ws.close());
  process.exit(0);
});

console.log('Press Ctrl+C to disconnect all agents\n');
