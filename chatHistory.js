// chatHistory.js
import { v4 as uuidv4 } from 'uuid';

const histories = new Map(); // sessionId -> [{role, parts}]

export function getSessionId(req, res) {
  let sessionId = req.cookies?.sessionId;
  if (!sessionId) {
    sessionId = uuidv4();
    res.cookie("sessionId", sessionId, { httpOnly: true, sameSite: "lax" });
  }
  return sessionId;
}

export function getHistory(sessionId) {
  if (!histories.has(sessionId)) {
    histories.set(sessionId, []);
  }
  return histories.get(sessionId);
}

export function addToHistory(sessionId, role, text) {
  const history = getHistory(sessionId);
  history.push({ role, parts: [{ text }] });

  // محدود کردن طول هیستوری برای صرفه‌جویی
  if (history.length > 20) {
    history.shift();
  }
}
