require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// Simple in-memory rooms map: roomId -> { text }
const rooms = new Map();

// REST endpoint to create/join a room (returns current doc)
app.post('/api/room', (req, res) => {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });
  if (!rooms.has(roomId)) rooms.set(roomId, { text: '' });
  return res.json({ roomId, text: rooms.get(roomId).text });
});

// Proxy endpoint to call Gemini-like API for code completions
app.post('/api/complete', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'prompt required' });
    }

    const endpoint = process.env.GEMINI_API_ENDPOINT;
    const key = process.env.GEMINI_API_KEY;

    if (!endpoint || !key) {
      return res.status(500).json({ error: 'Gemini API not configured' });
    }

    const payload = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    };

    const url = `${endpoint}?key=${encodeURIComponent(key)}`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const txt = await upstream.text();

    if (!upstream.ok) {
      // You were seeing the 404 here
      return res.status(502).json({
        error: 'Upstream API error',
        detail: txt
      });
    }

    const json = JSON.parse(txt);

    const suggestion =
      json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    return res.json({ suggestion });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'internal_error', detail: String(err) });
  }
});



const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch(e){ return; }
    const { type, roomId } = msg;
    if (type === 'join') {
      ws.roomId = roomId;
      // send current doc
      const doc = rooms.get(roomId) || { text: '' };
      ws.send(JSON.stringify({ type: 'init', text: doc.text }));
    } else if (type === 'update') {
      // persist and broadcast
      const doc = rooms.get(roomId) || { text: '' };
      doc.text = msg.text;
      rooms.set(roomId, doc);
      // broadcast to others
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === 1 && client.roomId === roomId) {
          client.send(JSON.stringify({ type: 'update', text: msg.text }));
        }
      });
    } else if (type === 'cursor') {
      // broadcast cursor positions to other clients
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === 1 && client.roomId === roomId) {
          client.send(JSON.stringify({ type: 'cursor', userId: msg.userId, cursor: msg.cursor }));
        }
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
