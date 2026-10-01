const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

console.log("WebSocket en écoute sur ws://localhost:8080");

// userId => ws
const clients = new Map();

wss.on('connection', (ws) => {
  let myId = null;

  ws.on('message', (raw) => {
    try{
      const data = JSON.parse(raw);
      
      // 1. JOIN - s'identifier
      if(data.action === 'join'){
        myId = String(data.moi).trim(); // ton ID à toi
        if(!myId) return;
        clients.set(myId, ws);
        console.log(myId + " connecté");
      }

      // 2. MESSAGE - envoyer à une seule personne
      if(data.action === 'message'){
        const toId = String(data.toid).trim();
        const target = clients.get(toId);
        
        if(target && target.readyState === WebSocket.OPEN){
          target.send(JSON.stringify({
            type: "new_message",
            fromid: myId,
            mess: data.mess,
            date: new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
            produit: data.produit || null // si tu envoies un produit
          }));
        }
      }

      // 3. TYPING
      if(data.action === 'typing'){
        const target = clients.get(String(data.toid));
        if(target) target.send(JSON.stringify({ type: "typing", fromid: myId }));
      }

    }catch(e){}
  });

  ws.on('close', () => {
    if(myId) clients.delete(myId);
  });
});
