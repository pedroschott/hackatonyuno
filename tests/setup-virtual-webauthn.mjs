const cdpUrl = process.argv[2];
if (!cdpUrl) throw new Error("Pass the browser CDP WebSocket URL");

const socket = new WebSocket(cdpUrl);
const pending = new Map();
let nextId = 1;

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const targets = await send("Target.getTargets");
const page = targets.targetInfos.find(
  (target) => target.type === "page" && target.url.startsWith("http://localhost:3210"),
);
if (!page) throw new Error("AgentPay page target was not found");
const attached = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
await send("WebAuthn.enable", {}, attached.sessionId);
const result = await send(
  "WebAuthn.addVirtualAuthenticator",
  {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  },
  attached.sessionId,
);
console.log(result.authenticatorId);
if (process.argv.includes("--hold")) {
  await new Promise(() => {});
}
socket.close();
