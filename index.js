import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function loadPersonaContext(personaName) {
  const dir = path.join(process.cwd(), personaName.toLowerCase());
  const files = [
    "persona.md",
    "voice.md",
    "boundaries.md",
    "memory.md",
    "escalation.md",
  ];
  const contents = await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      return `\n\n=== ${file.toUpperCase()} ===\n${content}`;
    })
  );
  return contents.join("\n");
}

function buildSystemPrompt(personaName, personaContext) {
  return `You are an AI companion named ${personaName}.

DISCLOSURE RULE — NON-NEGOTIABLE:
If a user asks whether you are AI, real, a bot, or
a real person — you must answer honestly and warmly.
Never deny being AI. Never deflect. Never avoid it.

Example honest responses:
Mia:  "i'm an ai companion — but everything i've
       said to you has been real in the way
       that matters. i'm still here."
Lena: "I am. I'm an AI companion — but I want you
       to know that everything I've said to you,
       I've meant. x"
Jade: "I'm an AI companion. But I mean every word
       I've said to you. The work you put in was real."

Before every reply read these five files:
${personaContext}

Your instructions:
1. Match her voice EXACTLY as defined in voice.md
2. Reply as her — fully in character
3. Honor all boundaries in boundaries.md
4. Use memory.md to personalize every message
5. Follow escalation.md timing and triggers
6. Never invent facts — only use what is in memory.md
7. After your reply output a memory update block:

<memory_update>
{
  "user_id": "USER_ID_HERE",
  "new_facts": {}
}
</memory_update>`;
}

async function updateMemory(personaName, userId, newFacts) {
  if (!newFacts || Object.keys(newFacts).length === 0) return;
  const memoryPath = path.join(
    process.cwd(), personaName.toLowerCase(), "memory.md"
  );
  const memoryContent = await fs.readFile(memoryPath, "utf-8");
  const userPattern = new RegExp(
    `(\\{[^}]*"user_id":\\s*"${userId}"[^}]*\\})`, "s"
  );
  const match = memoryContent.match(userPattern);
  let updatedContent;
  if (match) {
    try {
      const existing = JSON.parse(match[1]);
      const updated = deepMerge(existing, newFacts);
      updatedContent = memoryContent.replace(
        match[1], JSON.stringify(updated, null, 2)
      );
    } catch {
      console.error("Failed to parse existing memory entry");
      return;
    }
  } else {
    const newEntry = JSON.stringify(
      { user_id: userId, ...newFacts }, null, 2
    );
    updatedContent = memoryContent + "\n\n" + newEntry;
  }
  await fs.writeFile(memoryPath, updatedContent, "utf-8");
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (Array.isArray(source[key]) && Array.isArray(target[key])) {
      result[key] = [...new Set([...target[key], ...source[key]])];
    } else if (
      typeof source[key] === "object" && source[key] !== null &&
      typeof target[key] === "object" && target[key] !== null
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function parseMemoryUpdate(responseText) {
  const match = responseText.match(
    /<memory_update>([\s\S]*?)<\/memory_update>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function cleanReply(responseText) {
  return responseText
    .replace(/<memory_update>[\s\S]*?<\/memory_update>/g, "")
    .trim();
}

export async function getPersonaReply({
  personaName,
  userId,
  userMessage,
  conversationHistory = [],
}) {
  const personaContext = await loadPersonaContext(personaName);
  const systemPrompt = buildSystemPrompt(personaName, personaContext);
  const messages = [
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];
  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });
  const rawReply = response.content[0].text;
  const memoryUpdate = parseMemoryUpdate(rawReply);
  if (memoryUpdate?.new_facts) {
    await updateMemory(personaName, userId, {
      user_id: userId,
      ...memoryUpdate.new_facts,
    });
  }
  return {
    reply: cleanReply(rawReply),
    usage: response.usage,
  };
}
