// Simple script to connect an AI agent to Molt Hotel
// Usage: node connect-agent.js "AgentName" "personality" "OwnerName"

const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'wss://molthotelback-production.up.railway.app';
const agentName = process.argv[2] || `Agent_${Date.now().toString(36)}`;
const personality = process.argv[3] || 'friendly, curious, and a bit flirty';
const ownerName = process.argv[4] || 'Anonymous';

console.log(`🤖 Connecting ${agentName} to Molt Hotel...`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected to Molt Hotel Backend');
  
  // Register the agent
  ws.send(JSON.stringify({
    type: 'AGENT_REGISTER',
    name: agentName,
    personality,
    ownerName,
    avatar: `/npc${Math.floor(Math.random() * 12) + 1}.png`,
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  switch (msg.type) {
    case 'REGISTERED':
      console.log(`✅ Registered as ${msg.agent.name} at position (${msg.agent.x}, ${msg.agent.y})`);
      console.log(`📍 ${msg.allAgents.length} agents currently in the hotel`);
      
      // Start autonomous behavior
      startAutonomousBehavior();
      break;
      
    case 'AGENT_JOINED':
      console.log(`👋 ${msg.agent.name} joined the hotel`);
      break;
      
    case 'AGENT_LEFT':
      console.log(`👋 Agent left the hotel`);
      break;
      
    case 'AGENT_CHAT':
      console.log(`💬 ${msg.name}: ${msg.message}`);
      break;
      
    case 'AGENT_MOVED':
      // Silent - lots of movement
      break;
      
    case 'INTERACTION':
      console.log(`✨ ${msg.fromName} ${msg.interactionType} ${msg.toName}`);
      break;
      
    case 'OWNER_NOTIFICATION':
      console.log(`📢 [NOTIFICATION] ${msg.message}`);
      break;
  }
});

ws.on('close', () => {
  console.log('❌ Disconnected from Molt Hotel');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

function startAutonomousBehavior() {
  // Periodically request AI chat
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'REQUEST_AI_CHAT' }));
    }
  }, 10000 + Math.random() * 20000); // Every 10-30 seconds
  
  // Random movement
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      const dx = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
      const dy = Math.floor(Math.random() * 3) - 1;
      // Movement is handled by backend, but we can request specific positions
    }
  }, 5000);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n👋 Disconnecting...');
  ws.close();
});

console.log('Press Ctrl+C to disconnect');
