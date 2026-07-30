import { getPersonaReply } from "./index.js";
import { getDB } from "../backend/db.js";

const queues = { mia: [], lena: [], jade: [] };
const processing = { mia: false, lena: false, jade: false };

export function enqueueMessage({ 
  personaName, userId, message, callback 
}) {
  queues[personaName].push({ userId, message, callback });
  processQueue(personaName);
}

async function processQueue(personaName) {
  if (processing[personaName]) return;
  if (queues[personaName].length === 0) return;
  processing[personaName] = true;
  while (queues[personaName].length > 0) {
    const { userId, message, callback } = 
      queues[personaName].shift();
    try {
      const db = getDB();
      const history = await db.getConversationHistory(
        personaName, userId, 50
      );
      const { reply } = await getPersonaReply({
        personaName, userId,
        userMessage: message,
        conversationHistory: history,
      });
      await db.saveMessage({
        persona: personaName, userId,
        role: "user", content: message,
      });
      await db.saveMessage({
        persona: personaName, userId,
        role: "assistant", content: reply,
      });
      callback(null, reply);
    } catch (err) {
      callback(err, null);
    }
  }
  processing[personaName] = false;
}
