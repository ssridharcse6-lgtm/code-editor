import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { basicSetup } from '@codemirror/basic-setup';

const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';
let ws: WebSocket | null = null;
let roomId: string | null = null;
let joined = false;

const editorParent = document.getElementById('editor');
const joinBtn = document.getElementById('joinBtn');
const completeBtn = document.getElementById('completeBtn');
const roomInput = document.getElementById('roomId') as HTMLInputElement | null;
const collabList = document.getElementById('collabList');
const aiSuggestionEl = document.getElementById('aiSuggestion');

if (!editorParent || !joinBtn || !completeBtn || !roomInput || !collabList || !aiSuggestionEl) {
  throw new Error('Required DOM elements not found. Check index.html IDs.');
}

const state = EditorState.create({
  doc: '',
  extensions: [basicSetup, keymap.of(defaultKeymap)]
});

const view = new EditorView({
  state,
  parent: editorParent
});

joinBtn.addEventListener('click', async () => {
  roomId = roomInput.value || 'demo-room';

  const r = await fetch(`${serverUrl}/api/room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomId })
  });

  const json = await r.json();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: json.text || '' }
  });

  ws = new WebSocket(serverUrl.replace(/^http/, 'ws'));
  ws.addEventListener('open', () => {
    ws!.send(JSON.stringify({ type: 'join', roomId }));
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'init') {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: msg.text || '' }
      });
    } else if (msg.type === 'update') {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: msg.text }
      });
    } else if (msg.type === 'cursor') {
      // TODO: handle collaborator cursors
    }
  });

  let timeout: any = null;
  view.dom.addEventListener('input', () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      const text = view.state.doc.toString();
      if (ws && ws.readyState === WebSocket.OPEN && roomId) {
        ws.send(JSON.stringify({ type: 'update', roomId, text }));
      }
    }, 200);
  });

  joined = true;
  alert('Joined room ' + roomId);
});

completeBtn.addEventListener('click', async () => {
  if (!joined) return alert('Join a room first');

  const text = view.state.doc.toString();
  const prompt = text.slice(-800);
  aiSuggestionEl.textContent = 'Loading...';

  try {
    const r = await fetch(`${serverUrl}/api/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, maxTokens: 256 })
    });

    const json = await r.json();
    aiSuggestionEl.textContent = JSON.stringify(json.suggestion, null, 2);
  } catch (err: any) {
    aiSuggestionEl.textContent = 'Error: ' + err.message;
  }
});
