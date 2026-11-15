// Practice call by typing: talk to a business's receptionist in the terminal using the
// same brain as the phone line (needs ANTHROPIC_API_KEY, no Twilio needed).
// Usage: npm run chat -- [business-id]
import readline from "node:readline/promises";
import { loadBusinesses, normalizeBusiness } from "../src/config.js";
import { llm } from "../src/llm.js";
import { greetingFor, callContextNote } from "../src/prompt.js";

const id = process.argv[2];
const business =
  loadBusinesses().find((b) => b.id === id) ||
  loadBusinesses()[0] ||
  normalizeBusiness({ id: "demo", name: "Demo Plumbing", industry: "plumbing", contacts: [{ name: "Mike", phone: "+10000000000", when: "emergencies" }] });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const messages = [];
console.log(`\n(${business.name}; type "bye" to quit)\nReceptionist: ${greetingFor(business)}`);

while (true) {
  const said = (await rl.question("You: ")).trim();
  if (!said || /^bye$/i.test(said)) break;
  messages.push({ role: "user", content: messages.length ? said : `${callContextNote(business, "+15555550123")}\n${said}` });
  let done = false;
  while (!done) {
    process.stdout.write("Receptionist: ");
    const final = await llm.streamCallTurn({ business, messages, onText: (t) => process.stdout.write(t) });
    process.stdout.write("\n");
    messages.push({ role: "assistant", content: final.content });
    const uses = final.content.filter((b) => b.type === "tool_use");
    if (final.stop_reason !== "tool_use" || !uses.length) break;
    const results = uses.map((u) => {
      console.log(`   [tool ${u.name}: ${JSON.stringify(u.input)}]`);
      if (u.name === "end_call" || u.name === "transfer_call") done = true;
      return { type: "tool_result", tool_use_id: u.id, content: "Done." };
    });
    messages.push({ role: "user", content: results });
  }
  if (done) break;
}
rl.close();
