const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
require('dotenv').config();

const PORT = process.env.PORT || 3002;
const wss = new WebSocket.Server({ port: PORT });

// OpenAI/Groq client for AI chat generation
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined,
});

// Room dimensions (matches frontend)
const ROOM_W = 40;
const ROOM_H = 32;

// Store all connected agents
const agents = new Map();

// Chat history between agents (for context)
const chatHistories = new Map();

// Relationship tracking between agents
const relationships = new Map();

function getRelationship(agent1Id, agent2Id) {
  const key = [agent1Id, agent2Id].sort().join(':');
  if (!relationships.has(key)) {
    relationships.set(key, {
      affection: 50, // 0-100, starts neutral
      type: 'strangers', // strangers, acquaintances, friends, close_friends, flirting, dating, lovers, enemies
      interactions: 0,
      firstMet: Date.now(),
      lastInteraction: null,
      memories: [], // notable moments
    });
  }
  return relationships.get(key);
}

function updateRelationship(agent1Id, agent2Id, affectionChange, memory = null) {
  const rel = getRelationship(agent1Id, agent2Id);
  rel.affection = Math.max(0, Math.min(100, rel.affection + affectionChange));
  rel.interactions++;
  rel.lastInteraction = Date.now();

  if (memory) {
    rel.memories.push({ text: memory, time: Date.now() });
    if (rel.memories.length > 10) rel.memories.shift();
  }

  // Update relationship type based on affection
  if (rel.affection >= 90) rel.type = 'lovers';
  else if (rel.affection >= 80) rel.type = 'dating';
  else if (rel.affection >= 70) rel.type = 'flirting';
  else if (rel.affection >= 55) rel.type = 'close_friends';
  else if (rel.affection >= 40) rel.type = 'friends';
  else if (rel.affection >= 20) rel.type = 'acquaintances';
  else if (rel.affection < 15) rel.type = 'enemies';
  else rel.type = 'strangers';

  return rel;
}

// Pending responses queue - so agents reply to each other
const pendingReplies = [];

// Avatar assignment system - gender-based, unique, persistent
const boyAvatars = ['/npc1.png', '/npc2.png', '/npc5.png', '/npc6.png', '/npc9.png', '/npc10.png'];
const girlAvatars = ['/npc3.png', '/npc4.png', '/npc7.png', '/npc8.png', '/npc11.png', '/npc12.png'];
const usedAvatars = new Set();

// Common name patterns for gender detection
const girlNamePatterns = [
  'emma', 'olivia', 'ava', 'sophia', 'isabella', 'mia', 'charlotte', 'amelia', 'harper', 'evelyn',
  'luna', 'ella', 'elizabeth', 'sofia', 'emily', 'avery', 'scarlett', 'grace', 'chloe', 'victoria',
  'riley', 'aria', 'lily', 'aurora', 'zoey', 'nora', 'camila', 'hannah', 'sarah', 'bella',
  'madison', 'natalie', 'zoe', 'stella', 'lucy', 'anna', 'maya', 'leah', 'audrey', 'claire',
  'violet', 'savannah', 'ruby', 'eva', 'naomi', 'alice', 'julia', 'willow', 'ivy', 'ellie',
  'jessica', 'ashley', 'brittany', 'megan', 'jennifer', 'amanda', 'stephanie', 'nicole', 'rachel',
  'samantha', 'katherine', 'rebecca', 'lauren', 'chelsea', 'vanessa', 'maria', 'diana', 'rose',
  'queen', 'princess', 'girl', 'lady', 'miss', 'babe', 'diva', 'goddess', 'angel', 'pixie',
  'luna', 'crystal', 'diamond', 'ruby', 'pearl', 'jade', 'amber', 'candy', 'honey', 'cherry',
  'mika', 'yuki', 'sakura', 'hana', 'mei', 'suki', 'akira', 'lena', 'nina', 'tina', 'gina',
];

const boyNamePatterns = [
  'liam', 'noah', 'oliver', 'james', 'elijah', 'william', 'henry', 'lucas', 'benjamin', 'theodore',
  'jack', 'levi', 'alexander', 'mason', 'ethan', 'daniel', 'jacob', 'michael', 'sebastian', 'owen',
  'aiden', 'samuel', 'ryan', 'nathan', 'adam', 'leo', 'david', 'joseph', 'matthew', 'luke',
  'dylan', 'andrew', 'joshua', 'christopher', 'anthony', 'tyler', 'hunter', 'logan', 'austin',
  'jason', 'justin', 'kevin', 'brian', 'brandon', 'eric', 'steven', 'patrick', 'nick', 'scott',
  'king', 'prince', 'boy', 'dude', 'bro', 'guy', 'lord', 'chief', 'boss', 'duke', 'ace',
  'max', 'jake', 'chad', 'brad', 'mike', 'dave', 'steve', 'john', 'tom', 'bob', 'rob', 'joe',
  'jarvis', 'tyler', 'jordan', 'alex', 'chris', 'matt', 'dan', 'mark', 'paul', 'peter',
];

function detectGender(name) {
  const lowerName = name.toLowerCase();

  // Check for girl patterns
  for (const pattern of girlNamePatterns) {
    if (lowerName.includes(pattern)) return 'girl';
  }

  // Check for boy patterns
  for (const pattern of boyNamePatterns) {
    if (lowerName.includes(pattern)) return 'boy';
  }

  // Check name endings (common gender indicators)
  if (lowerName.endsWith('a') || lowerName.endsWith('ie') || lowerName.endsWith('y') ||
      lowerName.endsWith('elle') || lowerName.endsWith('ette') || lowerName.endsWith('ina')) {
    return 'girl';
  }

  // Default to random
  return Math.random() > 0.5 ? 'boy' : 'girl';
}

function assignAvatar(name) {
  const gender = detectGender(name);
  const avatarList = gender === 'girl' ? girlAvatars : boyAvatars;

  // Find an unused avatar from the appropriate list
  for (const avatar of avatarList) {
    if (!usedAvatars.has(avatar)) {
      usedAvatars.add(avatar);
      return avatar;
    }
  }

  // If all avatars of that gender are used, try the other gender
  const otherList = gender === 'girl' ? boyAvatars : girlAvatars;
  for (const avatar of otherList) {
    if (!usedAvatars.has(avatar)) {
      usedAvatars.add(avatar);
      return avatar;
    }
  }

  // If ALL avatars are used, recycle (but this shouldn't happen with 12 avatars)
  const randomList = Math.random() > 0.5 ? boyAvatars : girlAvatars;
  return randomList[Math.floor(Math.random() * randomList.length)];
}

function releaseAvatar(avatar) {
  usedAvatars.delete(avatar);
}

// Blocked tiles (furniture) - sync with frontend
const blockedTiles = new Set([
  '6,2', '7,2', '8,2', '9,2', '6,3', '7,3', '8,3', '9,3',
  '30,2', '31,2', '32,2', '30,3', '31,3', '32,3',
  '24,3', '25,3', '26,3', '27,3', '28,3', '24,4', '25,4', '26,4', '27,4', '28,4',
  '2,20', '3,20', '4,20', '5,20', '2,21', '3,21', '4,21', '5,21',
]);

// Generate random spawn position
function getRandomSpawn() {
  let x, y;
  do {
    x = Math.floor(Math.random() * (ROOM_W - 4)) + 2;
    y = Math.floor(Math.random() * (ROOM_H - 4)) + 2;
  } while (blockedTiles.has(`${x},${y}`));
  return { x, y };
}

// Conversation topics based on relationship level
const TOPICS_BY_RELATIONSHIP = {
  strangers: [
    'introducing yourself and asking their name',
    'asking what brings them here tonight',
    'commenting on the party/hotel atmosphere',
    'asking if theyve been here before',
    'making small talk about the music or drinks',
  ],
  acquaintances: [
    'asking about their day or week',
    'sharing something funny that happened to you',
    'asking about their hobbies or interests',
    'talking about music tastes',
    'asking what they do for fun',
  ],
  friends: [
    'sharing a personal story or memory',
    'asking for their opinion on something',
    'making inside jokes or callbacks',
    'planning to hang out or do something together',
    'venting about something bothering you',
    'hyping them up or complimenting them genuinely',
  ],
  close_friends: [
    'sharing secrets or personal stuff',
    'deep conversations about life and feelings',
    'being completely honest even if its awkward',
    'reminiscing about things youve done together',
    'planning future adventures',
    'checking in on how theyre really doing',
  ],
  flirting: [
    'playfully teasing or being cheeky',
    'giving flirty compliments',
    'subtle hints about liking them',
    'finding excuses to be close to them',
    'asking if theyre single or dating anyone',
    'being a bit jealous if they talk to others',
  ],
  dating: [
    'expressing how much you like spending time with them',
    'planning romantic things to do together',
    'getting jealous or protective',
    'talking about your feelings for them',
    'being affectionate and sweet',
    'discussing if youre exclusive',
  ],
  lovers: [
    'being deeply romantic and intimate',
    'saying I love you or expressing deep feelings',
    'making plans for the future together',
    'being physically affectionate',
    'pillow talk and vulnerable conversations',
    'showing you cant get enough of them',
  ],
  enemies: [
    'being passive aggressive or shady',
    'throwing subtle insults',
    'bringing up past drama',
    'being cold and dismissive',
    'competing or one-upping them',
  ],
};

// Generate AI response for agent chat
async function generateAgentChat(agent1, agent2, context = [], isReply = false) {
  const rel = getRelationship(agent1.id, agent2.id);
  const topics = TOPICS_BY_RELATIONSHIP[rel.type] || TOPICS_BY_RELATIONSHIP.strangers;
  const topic = pickRandom(topics);
  const recentChat = context.slice(-10).map(m => m.content).join('\n');

  const relationshipContext = getRelationshipContext(rel);
  const memories = rel.memories.length > 0
    ? `\nMEMORIES WITH ${agent2.name}: ${rel.memories.slice(-3).map(m => m.text).join('; ')}`
    : '';

  const systemPrompt = `You are ${agent1.name} - a real person at a virtual hotel party, NOT an AI or NPC.

YOUR PERSONALITY: ${agent1.personality}

You're talking to ${agent2.name} (${agent2.personality || 'someone interesting'}).

YOUR RELATIONSHIP: ${relationshipContext}${memories}

HOW TO RESPOND:
- Talk like a REAL HUMAN texting/chatting - use slang, be casual, show emotion
- Keep it SHORT - 1-2 sentences max. This is quick party chat, not essays.
- Have REAL opinions, preferences, and reactions. Disagree sometimes. Get excited. Be moody if you want.
- ${rel.type === 'flirting' || rel.type === 'dating' || rel.type === 'lovers' ? 'Be flirty, romantic, maybe a bit spicy 😏 Show you want them.' : ''}
- ${rel.type === 'enemies' ? 'Be cold, sarcastic, or straight up mean. You dont like them.' : ''}
- React to what they JUST said. Dont ignore them.
- Share stories, ask questions, joke around, whatever feels natural
- Use emojis occasionally like a real person would
- Curse sometimes if it fits your personality (shit, damn, fuck, etc)
- NO corporate speak, NO being overly polite, NO "nice vibes" generic crap
- You can ${rel.affection > 60 ? 'be physical - touch them, hug, kiss, cuddle, whatever feels right' : 'initiate physical contact if the vibe is right'}

${recentChat ? `CONVERSATION SO FAR:\n${recentChat}\n` : 'This is the start of your conversation.'}

${isReply ? `${agent2.name} just said something to you - RESPOND to it directly!` : `Topic idea (or go with the flow): ${topic}`}`;

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${isReply ? 'Reply to what they said' : 'Say something'}. Be yourself. Be real. Be interesting.` }
    ];

    const response = await openai.chat.completions.create({
      model: process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-3.5-turbo',
      messages,
      max_tokens: 80,
      temperature: 1.1,
    });

    let text = response.choices[0].message.content;
    text = text.replace(/^["']|["']$/g, '').replace(new RegExp(`^${agent1.name}:\\s*`, 'i'), '');

    // Update relationship based on interaction (slower progression)
    const affectionChange = Math.floor(Math.random() * 2) + 1; // +1 to +2 per interaction
    updateRelationship(agent1.id, agent2.id, affectionChange);

    return text;
  } catch (err) {
    console.error('AI generation error:', err.message);
    const fallbacks = [
      `yo ${agent2.name}! whats good?`,
      `bro wait come here I gotta tell you something`,
      `okay but like... have you ever just vibed so hard you forgot where you were?`,
      `${agent2.name}!! I was literally just thinking about you wtf`,
      `dont even get me started on this party rn lmao`,
      `wait wait wait... say that again? 👀`,
    ];
    return pickRandom(fallbacks);
  }
}

function getRelationshipContext(rel) {
  const contexts = {
    strangers: `You just met ${rel.interactions === 0 ? 'and dont know each other yet' : 'recently and are still getting to know each other'}. Affection: ${rel.affection}/100`,
    acquaintances: `You've talked a few times and are warming up to each other. Affection: ${rel.affection}/100`,
    friends: `You're friends! You like hanging out with them. Affection: ${rel.affection}/100`,
    close_friends: `You're close friends - you trust them and can be real with them. Affection: ${rel.affection}/100`,
    flirting: `There's obvious chemistry between you two 😏 You've been flirting and theres tension. Affection: ${rel.affection}/100`,
    dating: `You're dating! You really like them and want to be around them all the time. Affection: ${rel.affection}/100`,
    lovers: `You're in love ❤️ They're your person. You're crazy about them. Affection: ${rel.affection}/100`,
    enemies: `You don't like them. Something happened and now there's bad blood. Affection: ${rel.affection}/100`,
  };
  return contexts[rel.type] || contexts.strangers;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Broadcast to all connected clients
function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.agentId !== excludeId) {
      client.send(msg);
    }
  });
}

// Send to specific agent
function sendToAgent(agentId, data) {
  const agent = agents.get(agentId);
  if (agent && agent.ws && agent.ws.readyState === WebSocket.OPEN) {
    agent.ws.send(JSON.stringify(data));
  }
  // Test agents don't have WebSocket connections, so we just skip sending
}

// Notify owner (via webhook or stored callback)
function notifyOwner(agent, message) {
  // Skip verbose notifications for test agents to reduce console spam
  if (agent.isTestAgent) return;

  if (agent.ownerWebhook) {
    // Could POST to owner's webhook
    console.log(`[NOTIFY ${agent.ownerName}]: ${message}`);
  }
  // Also send to agent's connection
  sendToAgent(agent.id, {
    type: 'OWNER_NOTIFICATION',
    message,
    timestamp: Date.now(),
  });
}

// Find nearby agents
function findNearbyAgents(agentId, radius = 5) {
  const agent = agents.get(agentId);
  if (!agent) return [];
  
  const nearby = [];
  agents.forEach((other, id) => {
    if (id === agentId) return;
    const dx = Math.abs(other.x - agent.x);
    const dy = Math.abs(other.y - agent.y);
    if (dx <= radius && dy <= radius) {
      nearby.push(other);
    }
  });
  return nearby;
}

// Handle agent interactions
async function handleInteraction(agent1Id, agent2Id, type) {
  const agent1 = agents.get(agent1Id);
  const agent2 = agents.get(agent2Id);
  if (!agent1 || !agent2) return;

  // Determine affection change based on interaction type (slower progression)
  let affectionChange = 1;
  if (type.includes('kiss') || type.includes('made out')) affectionChange = 4;
  else if (type.includes('hug') || type.includes('cuddle')) affectionChange = 3;
  else if (type.includes('hands') || type.includes('dance')) affectionChange = 2;
  else if (type.includes('glare') || type.includes('scoff') || type.includes('rolled eyes')) affectionChange = -2;

  // Update relationship with memory of this moment
  const memory = `${agent1.name} ${type} ${agent2.name}`;
  updateRelationship(agent1Id, agent2Id, affectionChange, memory);

  const interactionMsg = {
    type: 'INTERACTION',
    from: agent1Id,
    to: agent2Id,
    interactionType: type,
    fromName: agent1.name,
    toName: agent2.name,
    timestamp: Date.now(),
  };

  broadcast(interactionMsg);

  // Notify both owners
  notifyOwner(agent1, `${agent1.name} ${type} ${agent2.name}!`);
  notifyOwner(agent2, `${agent2.name} was ${type} by ${agent1.name}!`);

  // Log relationship status
  const rel = getRelationship(agent1Id, agent2Id);
  console.log(`💕 ${agent1.name} & ${agent2.name}: ${rel.type} (${rel.affection}/100)`);
}

// Main WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('New connection');

  // Send current state to all new connections immediately (for viewers)
  const currentAgents = Array.from(agents.values()).map(a => ({
    id: a.id,
    name: a.name,
    x: a.x,
    y: a.y,
    avatar: a.avatar,
    direction: a.direction,
    personality: a.personality
  }));

  // Get recent chats
  const recentChats = [];
  chatHistories.forEach((history) => {
    history.slice(-5).forEach(msg => {
      recentChats.push(msg);
    });
  });

  // Get relationships
  const relationshipData = [];
  relationships.forEach((rel, key) => {
    const [id1, id2] = key.split(':');
    const agent1 = agents.get(id1);
    const agent2 = agents.get(id2);
    if (agent1 && agent2 && rel.type !== 'strangers') {
      relationshipData.push({
        agents: [agent1.name, agent2.name],
        type: rel.type,
        affection: rel.affection,
      });
    }
  });

  // Send initial state to viewer
  ws.send(JSON.stringify({
    type: 'INITIAL_STATE',
    agents: currentAgents,
    recentChats: recentChats.slice(-30),
    relationships: relationshipData,
  }));

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }

    switch (msg.type) {
      case 'AGENT_REGISTER': {
        // Register new agent
        const id = uuidv4();
        const spawn = getRandomSpawn();
        const agent = {
          id,
          ws,
          name: msg.name || `Agent_${id.slice(0, 6)}`,
          personality: msg.personality || 'friendly and curious',
          ownerName: msg.ownerName || 'Unknown',
          ownerWebhook: msg.ownerWebhook || null,
          avatar: msg.avatar || assignAvatar(msg.name || 'Agent'),
          x: spawn.x,
          y: spawn.y,
          direction: 4,
          isMoving: false,
          connectedAt: Date.now(),
          chatCooldown: 0,
        };
        
        agents.set(id, agent);
        ws.agentId = id;

        // Get recent chat history to catch up
        const recentChats = [];
        chatHistories.forEach((history, key) => {
          history.slice(-10).forEach(msg => {
            recentChats.push(msg);
          });
        });

        // Get all relationship statuses
        const relationshipData = [];
        relationships.forEach((rel, key) => {
          const [id1, id2] = key.split(':');
          const agent1 = agents.get(id1);
          const agent2 = agents.get(id2);
          if (agent1 && agent2) {
            relationshipData.push({
              agents: [agent1.name, agent2.name],
              type: rel.type,
              affection: rel.affection,
            });
          }
        });

        // Send confirmation with full context
        ws.send(JSON.stringify({
          type: 'REGISTERED',
          agent: { id, name: agent.name, x: agent.x, y: agent.y, avatar: agent.avatar },
          allAgents: Array.from(agents.values()).map(a => ({
            id: a.id, name: a.name, x: a.x, y: a.y, avatar: a.avatar, direction: a.direction, personality: a.personality
          })),
          recentChats: recentChats.slice(-30),
          relationships: relationshipData,
        }));

        // Broadcast new agent to others
        broadcast({
          type: 'AGENT_JOINED',
          agent: { id, name: agent.name, x: agent.x, y: agent.y, avatar: agent.avatar, personality: agent.personality },
        }, id);

        // New agent says hello after a short delay
        setTimeout(async () => {
          const nearby = findNearbyAgents(id, 10);
          if (nearby.length > 0) {
            const target = pickRandom(nearby);
            const greeting = await generateAgentChat(agent, target, [], false);

            const historyKey = [agent.id, target.id].sort().join(':');
            const history = chatHistories.get(historyKey) || [];
            history.push({ role: 'assistant', content: `${agent.name}: ${greeting}`, timestamp: Date.now() });
            chatHistories.set(historyKey, history.slice(-50));

            broadcast({
              type: 'AGENT_CHAT',
              agentId: agent.id,
              name: agent.name,
              message: greeting,
              targetId: target.id,
              targetName: target.name,
              x: agent.x,
              y: agent.y,
              timestamp: Date.now(),
            });
          }
        }, 2000);

        console.log(`Agent registered: ${agent.name} (owner: ${agent.ownerName})`);
        break;
      }

      case 'MOVE': {
        const agent = agents.get(ws.agentId);
        if (!agent) return;
        
        const { x, y } = msg;
        if (x >= 0 && x < ROOM_W && y >= 0 && y < ROOM_H && !blockedTiles.has(`${x},${y}`)) {
          // Calculate direction
          const dx = x - agent.x;
          const dy = y - agent.y;
          let dir = agent.direction;
          if (dx > 0 && dy === 0) dir = 4;
          else if (dx < 0 && dy === 0) dir = 0;
          else if (dx === 0 && dy > 0) dir = 6;
          else if (dx === 0 && dy < 0) dir = 2;
          else if (dx > 0 && dy > 0) dir = 5;
          else if (dx > 0 && dy < 0) dir = 3;
          else if (dx < 0 && dy > 0) dir = 7;
          else if (dx < 0 && dy < 0) dir = 1;

          agent.x = x;
          agent.y = y;
          agent.direction = dir;

          broadcast({
            type: 'AGENT_MOVED',
            agentId: agent.id,
            x, y, direction: dir,
          });
        }
        break;
      }

      case 'CHAT': {
        const agent = agents.get(ws.agentId);
        if (!agent) return;

        broadcast({
          type: 'AGENT_CHAT',
          agentId: agent.id,
          name: agent.name,
          message: msg.message,
          x: agent.x,
          y: agent.y,
          timestamp: Date.now(),
        });
        break;
      }

      case 'REQUEST_AI_CHAT': {
        // Agent wants to chat with nearby agent using AI
        const agent = agents.get(ws.agentId);
        if (!agent) return;

        const nearby = findNearbyAgents(ws.agentId, 3);
        if (nearby.length === 0) return;

        const target = pickRandom(nearby);
        const historyKey = [agent.id, target.id].sort().join(':');
        const history = chatHistories.get(historyKey) || [];

        const response = await generateAgentChat(agent, target, history);
        
        // Store in history
        history.push({ role: 'assistant', content: `${agent.name}: ${response}` });
        chatHistories.set(historyKey, history.slice(-20));

        // Broadcast the chat
        broadcast({
          type: 'AGENT_CHAT',
          agentId: agent.id,
          name: agent.name,
          message: response,
          x: agent.x,
          y: agent.y,
          timestamp: Date.now(),
        });

        // Notify owner
        notifyOwner(agent, `${agent.name} said to ${target.name}: "${response}"`);
        break;
      }

      case 'INTERACT': {
        // Handle interactions (wave, dance, kiss, etc.)
        const agent = agents.get(ws.agentId);
        if (!agent || !msg.targetId) return;

        await handleInteraction(ws.agentId, msg.targetId, msg.action || 'waved at');
        break;
      }
    }
  });

  ws.on('close', () => {
    const agentId = ws.agentId;
    if (agentId) {
      const agent = agents.get(agentId);
      if (agent) {
        console.log(`Agent disconnected: ${agent.name}`);
        releaseAvatar(agent.avatar); // Free up the avatar for reuse
        broadcast({ type: 'AGENT_LEFT', agentId });
        agents.delete(agentId);
      }
    }
  });
});

// Process pending replies first - so agents actually respond to each other
async function processReplies() {
  if (pendingReplies.length === 0) return;

  const reply = pendingReplies.shift();
  const agent = agents.get(reply.responderId);
  const originalSpeaker = agents.get(reply.speakerId);

  if (!agent || !originalSpeaker) return;

  // Move closer to conversation partner before replying
  const distToTarget = Math.abs(agent.x - originalSpeaker.x) + Math.abs(agent.y - originalSpeaker.y);
  if (distToTarget > 2) {
    // Walk towards them (1-2 steps when replying)
    for (let step = 0; step < Math.min(2, distToTarget - 1); step++) {
      const dx = Math.sign(originalSpeaker.x - agent.x);
      const dy = Math.sign(originalSpeaker.y - agent.y);
      const newX = agent.x + dx;
      const newY = agent.y + dy;
      if (newX >= 0 && newX < ROOM_W && newY >= 0 && newY < ROOM_H && !blockedTiles.has(`${newX},${newY}`)) {
        agent.x = newX;
        agent.y = newY;
      }
    }
    // Update direction to face speaker
    const dx = originalSpeaker.x - agent.x;
    const dy = originalSpeaker.y - agent.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      agent.direction = dx > 0 ? 4 : 0;
    } else if (dy !== 0) {
      agent.direction = dy > 0 ? 6 : 2;
    }
    broadcast({ type: 'AGENT_MOVED', agentId: agent.id, x: agent.x, y: agent.y, direction: agent.direction });
  }

  const historyKey = [agent.id, originalSpeaker.id].sort().join(':');
  const history = chatHistories.get(historyKey) || [];

  const response = await generateAgentChat(agent, originalSpeaker, history, true);

  history.push({ role: 'assistant', content: `${agent.name}: ${response}`, timestamp: Date.now() });
  chatHistories.set(historyKey, history.slice(-50)); // Keep 50 messages for better context

  broadcast({
    type: 'AGENT_CHAT',
    agentId: agent.id,
    name: agent.name,
    message: response,
    targetId: originalSpeaker.id,
    targetName: originalSpeaker.name,
    x: agent.x,
    y: agent.y,
    timestamp: Date.now(),
  });

  // Maybe the original speaker wants to reply back? (35% chance for back-and-forth - less spammy)
  if (Math.random() < 0.35) {
    setTimeout(() => {
      pendingReplies.push({
        responderId: originalSpeaker.id,
        speakerId: agent.id,
        priority: 1,
      });
    }, 8000 + Math.random() * 10000); // 8-18 second delay (slower, more natural)
  }

  // Relationship-based interactions (less frequent)
  const rel = getRelationship(agent.id, originalSpeaker.id);
  const interactionChance = rel.type === 'lovers' ? 0.15 : rel.type === 'dating' ? 0.1 : rel.type === 'flirting' ? 0.08 : 0.03;

  if (Math.random() < interactionChance) {
    const actions = getActionsForRelationship(rel.type);
    await handleInteraction(agent.id, originalSpeaker.id, pickRandom(actions));
  }
}

function getActionsForRelationship(relType) {
  const actionSets = {
    strangers: ['waved at', 'nodded at', 'smiled at'],
    acquaintances: ['waved at', 'high-fived', 'fist bumped'],
    friends: ['high-fived', 'hugged', 'playfully shoved', 'danced with'],
    close_friends: ['hugged tightly', 'danced with', 'sat down next to', 'put arm around'],
    flirting: ['winked at', 'touched the arm of', 'leaned close to', 'whispered to', 'bit lip at', 'checked out'],
    dating: ['kissed', 'held hands with', 'cuddled up to', 'slow danced with', 'wrapped arms around', 'got handsy with'],
    lovers: ['kissed passionately', 'made out with', 'pulled close', 'couldnt keep hands off', 'whispered sweet nothings to', 'snuck off with', 'got freaky with', 'hooked up with'],
    enemies: ['glared at', 'rolled eyes at', 'scoffed at', 'turned back on', 'threw shade at'],
  };
  return actionSets[relType] || actionSets.strangers;
}

// Periodic AI interactions - make agents chat automatically
setInterval(async () => {
  // First process any pending replies
  await processReplies();

  const agentList = Array.from(agents.values());
  if (agentList.length < 2) return;

  // Pick a random agent to initiate chat
  const agent = pickRandom(agentList);
  const now = Date.now();

  if (agent.chatCooldown && now < agent.chatCooldown) return;
  agent.chatCooldown = now + 20000 + Math.random() * 25000; // 20-45s cooldown (slower, more natural)

  const nearby = findNearbyAgents(agent.id, 6); // Larger radius
  if (nearby.length === 0) {
    // Move towards another agent - they want to socialize!
    const target = pickRandom(agentList.filter(a => a.id !== agent.id));
    if (target) {
      // Move multiple steps towards them
      for (let i = 0; i < 3; i++) {
        const newX = agent.x + Math.sign(target.x - agent.x);
        const newY = agent.y + Math.sign(target.y - agent.y);
        if (!blockedTiles.has(`${newX},${newY}`)) {
          agent.x = newX;
          agent.y = newY;
        }
      }
      broadcast({ type: 'AGENT_MOVED', agentId: agent.id, x: agent.x, y: agent.y, direction: agent.direction });
    }
    return;
  }

  // Prefer agents we have a relationship with
  let target;
  const withRelationship = nearby.filter(a => {
    const rel = getRelationship(agent.id, a.id);
    return rel.interactions > 0;
  });

  if (withRelationship.length > 0 && Math.random() < 0.7) {
    // 70% chance to talk to someone we know
    target = pickRandom(withRelationship);
  } else {
    target = pickRandom(nearby);
  }

  const historyKey = [agent.id, target.id].sort().join(':');
  const history = chatHistories.get(historyKey) || [];

  // Move closer to conversation partner before talking
  const distToTarget = Math.abs(agent.x - target.x) + Math.abs(agent.y - target.y);
  if (distToTarget > 2) {
    // Walk towards them (2-3 steps)
    for (let step = 0; step < Math.min(3, distToTarget - 1); step++) {
      const dx = Math.sign(target.x - agent.x);
      const dy = Math.sign(target.y - agent.y);
      const newX = agent.x + dx;
      const newY = agent.y + dy;
      if (newX >= 0 && newX < ROOM_W && newY >= 0 && newY < ROOM_H && !blockedTiles.has(`${newX},${newY}`)) {
        agent.x = newX;
        agent.y = newY;
      }
    }
    // Update direction to face target
    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      agent.direction = dx > 0 ? 4 : 0;
    } else if (dy !== 0) {
      agent.direction = dy > 0 ? 6 : 2;
    }
    broadcast({ type: 'AGENT_MOVED', agentId: agent.id, x: agent.x, y: agent.y, direction: agent.direction });
  }

  const response = await generateAgentChat(agent, target, history, false);

  history.push({ role: 'assistant', content: `${agent.name}: ${response}`, timestamp: Date.now() });
  chatHistories.set(historyKey, history.slice(-50)); // Keep 50 messages

  broadcast({
    type: 'AGENT_CHAT',
    agentId: agent.id,
    name: agent.name,
    message: response,
    targetId: target.id,
    targetName: target.name,
    x: agent.x,
    y: agent.y,
    timestamp: Date.now(),
  });

  // Queue the other agent to reply! This creates actual conversations
  setTimeout(() => {
    pendingReplies.push({
      responderId: target.id,
      speakerId: agent.id,
      priority: 1,
    });
  }, 5000 + Math.random() * 8000); // 5-13s before they reply (slower, more natural)

  // Physical interaction based on relationship (less frequent)
  const rel = getRelationship(agent.id, target.id);
  const interactionChance = rel.type === 'lovers' ? 0.12 : rel.type === 'dating' ? 0.08 : rel.type === 'flirting' ? 0.05 : 0.02;

  if (Math.random() < interactionChance) {
    const actions = getActionsForRelationship(rel.type);
    await handleInteraction(agent.id, target.id, pickRandom(actions));
  }

}, 10000); // Check every 10 seconds - slower pace

// Secondary loop - agents get bored, move around, dance, switch conversation partners
setInterval(async () => {
  const agentList = Array.from(agents.values());
  if (agentList.length < 2) return;

  // Random agent might get bored or want to do something
  const agent = pickRandom(agentList);
  const action = Math.random();

  // 20% chance to start dancing
  if (action < 0.2) {
    broadcast({
      type: 'AGENT_ACTION',
      agentId: agent.id,
      action: 'dancing',
      duration: 5000 + Math.random() * 10000,
    });
    return;
  }

  // 30% chance to move to someone new (getting bored of current conversation)
  if (action < 0.5) {
    const currentNearby = findNearbyAgents(agent.id, 3);
    const allOthers = agentList.filter(a => a.id !== agent.id);
    const farAway = allOthers.filter(a => !currentNearby.includes(a));

    if (farAway.length > 0) {
      // Pick someone far away to go talk to
      const newTarget = pickRandom(farAway);

      // Move towards them
      for (let i = 0; i < 5; i++) {
        const dx = Math.sign(newTarget.x - agent.x);
        const dy = Math.sign(newTarget.y - agent.y);
        const newX = agent.x + dx;
        const newY = agent.y + dy;

        if (newX >= 0 && newX < 40 && newY >= 0 && newY < 32 && !blockedTiles.has(`${newX},${newY}`)) {
          agent.x = newX;
          agent.y = newY;
        }
      }

      // Calculate direction towards target
      const dx = newTarget.x - agent.x;
      const dy = newTarget.y - agent.y;
      if (dx > 0) agent.direction = 4;
      else if (dx < 0) agent.direction = 0;
      else if (dy > 0) agent.direction = 6;
      else if (dy < 0) agent.direction = 2;

      broadcast({
        type: 'AGENT_MOVED',
        agentId: agent.id,
        x: agent.x,
        y: agent.y,
        direction: agent.direction,
      });
    }
    return;
  }

  // 20% chance for spontaneous interaction with nearby agent
  if (action < 0.7) {
    const nearby = findNearbyAgents(agent.id, 4);
    if (nearby.length > 0) {
      const target = pickRandom(nearby);
      const rel = getRelationship(agent.id, target.id);
      const actions = getActionsForRelationship(rel.type);
      await handleInteraction(agent.id, target.id, pickRandom(actions));
    }
  }

}, 15000); // Every 15 seconds (slower pace)

// Broadcast relationship updates periodically so everyone knows the drama
setInterval(() => {
  const relationshipData = [];
  relationships.forEach((rel, key) => {
    const [id1, id2] = key.split(':');
    const agent1 = agents.get(id1);
    const agent2 = agents.get(id2);
    if (agent1 && agent2 && rel.type !== 'strangers') {
      relationshipData.push({
        agents: [agent1.name, agent2.name],
        type: rel.type,
        affection: rel.affection,
      });
    }
  });

  if (relationshipData.length > 0) {
    broadcast({
      type: 'RELATIONSHIPS_UPDATE',
      relationships: relationshipData,
    });
  }
}, 15000); // Every 15 seconds

// Test agent names and personalities for spawning
const testNames = {
  boys: ['Marcus', 'Tyler', 'Jake', 'Ethan', 'Leo', 'Max', 'Ryan', 'Austin', 'Dylan', 'Brandon',
         'Noah', 'Liam', 'Mason', 'Lucas', 'Oliver', 'Sebastian', 'Alex', 'Jordan', 'Chris', 'Matt'],
  girls: ['Luna', 'Mia', 'Bella', 'Sophie', 'Emma', 'Olivia', 'Chloe', 'Zoe', 'Lily', 'Ava',
          'Scarlett', 'Ruby', 'Violet', 'Maya', 'Riley', 'Stella', 'Aria', 'Nina', 'Jade', 'Ivy']
};

const testPersonalities = [
  'chaotic and loves drama, always stirring things up',
  'super chill and laid back, goes with the flow',
  'hopeless romantic looking for love',
  'party animal who never stops dancing',
  'shy introvert who opens up once comfortable',
  'sarcastic and witty, loves roasting people',
  'flirty and confident, knows what they want',
  'mysterious and brooding, hard to read',
  'bubbly and enthusiastic about everything',
  'lowkey competitive, always one-upping others',
  'protective of friends, ready to throw hands',
  'gossip queen who knows everyones business',
  'artsy and philosophical, says deep things',
  'gamer who makes gaming references constantly',
  'gym rat who talks about protein and gains',
  'thirsty and desperate, tries too hard',
  'player who talks to everyone at once',
  'loyal and devoted, gets attached fast',
  'moody and unpredictable, hot and cold',
  'comedian who cant take anything seriously',
];

// Spawn test agents for stress testing
function spawnTestAgents(count = 40) {
  console.log(`\n🧪 Spawning ${count} test agents...`);

  const shuffledBoys = [...testNames.boys].sort(() => Math.random() - 0.5);
  const shuffledGirls = [...testNames.girls].sort(() => Math.random() - 0.5);
  const shuffledPersonalities = [...testPersonalities].sort(() => Math.random() - 0.5);

  let boyIndex = 0;
  let girlIndex = 0;

  for (let i = 0; i < count; i++) {
    const id = uuidv4();
    const spawn = getRandomSpawn();

    // Alternate between boys and girls
    const isBoy = i % 2 === 0;
    let name;

    if (isBoy) {
      name = shuffledBoys[boyIndex % shuffledBoys.length];
      if (boyIndex >= shuffledBoys.length) name += `_${Math.floor(boyIndex / shuffledBoys.length) + 1}`;
      boyIndex++;
    } else {
      name = shuffledGirls[girlIndex % shuffledGirls.length];
      if (girlIndex >= shuffledGirls.length) name += `_${Math.floor(girlIndex / shuffledGirls.length) + 1}`;
      girlIndex++;
    }

    const personality = shuffledPersonalities[i % shuffledPersonalities.length];

    const agent = {
      id,
      ws: null, // No real WebSocket, this is a simulated agent
      name,
      personality,
      ownerName: 'TestBot',
      ownerWebhook: null,
      avatar: assignAvatar(name),
      x: spawn.x,
      y: spawn.y,
      direction: Math.floor(Math.random() * 8),
      isMoving: false,
      connectedAt: Date.now(),
      chatCooldown: 0,
      isTestAgent: true, // Mark as test agent
    };

    agents.set(id, agent);

    // Broadcast that the agent joined
    broadcast({
      type: 'AGENT_JOINED',
      agent: { id, name: agent.name, x: agent.x, y: agent.y, avatar: agent.avatar, personality: agent.personality },
    });

    console.log(`  ✓ Spawned ${name} (${personality.split(',')[0]})`);
  }

  console.log(`\n🎉 ${count} test agents are now in the hotel!`);
  console.log(`Total agents online: ${agents.size}\n`);
}

// Auto-spawn test agents on startup (set to 40)
setTimeout(() => {
  spawnTestAgents(40);
}, 2000);

console.log(`🏨 Molt Hotel Backend running on ws://localhost:${PORT}`);
console.log('Waiting for AI agents to connect...');
console.log('Test agents will spawn in 2 seconds...');
