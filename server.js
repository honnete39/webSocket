const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log("WebSocket en écoute sur le port " + PORT);

/*
=========================================================
CONNEXIONS
userId => Set<WebSocket>
=========================================================
*/

const clients = new Map();

/*
=========================================================
DÉLAI AVANT HORS LIGNE
=========================================================

Un utilisateur ne devient pas immédiatement hors ligne
lorsqu'une connexion disparaît.

Il faut attendre 60 secondes.

Cela protège contre :
- réseau faible
- changement de réseau
- perte momentanée d'Internet
- reconnexion WebSocket
- mise en veille temporaire du téléphone
=========================================================
*/

const OFFLINE_DELAY = 60 * 1000;

const offlineTimers = new Map();

/*
=========================================================
ENVOYER À UN UTILISATEUR
=========================================================
*/

function envoyer(userId, data) {
    userId = String(userId || "").trim();

    if (!userId) return;

    const sockets = clients.get(userId);

    if (!sockets) return;

    const message = JSON.stringify(data);

    for (const ws of sockets) {

        if (ws.readyState === WebSocket.OPEN) {

            try {
                ws.send(message);
            } catch (e) {}

        }

    }
}

/*
=========================================================
AJOUTER UNE CONNEXION
=========================================================
*/

function ajouterClient(userId, ws) {

    userId = String(userId || "").trim();

    if (!userId) return;

    /*
    Si un ancien timer hors ligne existe,
    on l'annule immédiatement.
    */

    if (offlineTimers.has(userId)) {

        clearTimeout(
            offlineTimers.get(userId)
        );

        offlineTimers.delete(userId);
    }

    if (!clients.has(userId)) {
        clients.set(userId, new Set());
    }

    clients.get(userId).add(ws);
}

/*
=========================================================
RETIRER UNE CONNEXION
=========================================================
*/

function retirerClient(userId, ws) {

    userId = String(userId || "").trim();

    if (!userId) return;

    const sockets = clients.get(userId);

    if (!sockets) return;

    sockets.delete(ws);

    /*
    Il reste encore une autre connexion.
    Donc l'utilisateur est toujours en ligne.
    */

    if (sockets.size > 0) {
        return;
    }

    /*
    Plus aucune connexion.

    MAIS on ne déclare PAS encore hors ligne.

    On attend 60 secondes.
    */

    if (offlineTimers.has(userId)) {
        clearTimeout(
            offlineTimers.get(userId)
        );
    }

    const timer = setTimeout(() => {

        /*
        Une nouvelle connexion peut être arrivée
        pendant les 60 secondes.
        */

        const nouvellesConnexions =
            clients.get(userId);

        if (
            nouvellesConnexions &&
            nouvellesConnexions.size > 0
        ) {
            offlineTimers.delete(userId);
            return;
        }

        clients.delete(userId);

        offlineTimers.delete(userId);

        console.log(
            userId + " est maintenant hors ligne"
        );

        diffuserPresence(
            userId,
            false
        );

    }, OFFLINE_DELAY);

    offlineTimers.set(
        userId,
        timer
    );
}

/*
=========================================================
VÉRIFIER SI UN UTILISATEUR EST EN LIGNE
=========================================================
*/

function estEnLigne(userId) {

    userId = String(userId || "").trim();

    if (!userId) return false;

    const sockets = clients.get(userId);

    if (!sockets || sockets.size === 0) {
        return false;
    }

    for (const ws of sockets) {

        if (ws.readyState === WebSocket.OPEN) {
            return true;
        }

    }

    return false;
}

/*
=========================================================
DIFFUSER LA PRÉSENCE
=========================================================
*/

function diffuserPresence(userId, online) {

    const data = JSON.stringify({
        type: "presence",
        userId: String(userId),
        online: !!online
    });

    for (const [, sockets] of clients) {

        for (const ws of sockets) {

            if (ws.readyState === WebSocket.OPEN) {

                try {
                    ws.send(data);
                } catch (e) {}

            }

        }

    }
}

/*
=========================================================
NOUVELLE CONNEXION
=========================================================
*/

wss.on("connection", (ws) => {

    let myId = null;

    /*
    Heartbeat de cette connexion
    */

    ws.isAlive = true;

    /*
    -----------------------------------------------------
    PONG
    -----------------------------------------------------
    */

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    /*
    =====================================================
    MESSAGE
    =====================================================
    */

    ws.on("message", (raw) => {

        try {

            const data =
                JSON.parse(raw.toString());

            if (!data || typeof data !== "object") {
                return;
            }

            /*
            =================================================
            REGISTER
            =================================================
            */

            if (data.action === "register") {

                const id =
                    String(
                        data.userId || ""
                    ).trim();

                if (!id) return;

                /*
                Ancienne identité éventuelle
                */

                if (
                    myId &&
                    myId !== id
                ) {
                    retirerClient(
                        myId,
                        ws
                    );
                }

                /*
                Avant ajout, on vérifie si l'utilisateur
                avait déjà une connexion.
                */

                const dejaEnLigne =
                    estEnLigne(id);

                myId = id;

                ajouterClient(
                    id,
                    ws
                );

                console.log(
                    id + " connecté"
                );

                /*
                Confirmation au JS
                */

                try {

                    ws.send(
                        JSON.stringify({
                            type: "registered",
                            userId: id,
                            online: true
                        })
                    );

                } catch (e) {}

                /*
                Si c'est une nouvelle présence,
                prévenir les autres.
                */

                if (!dejaEnLigne) {

                    diffuserPresence(
                        id,
                        true
                    );

                }

                return;
            }

            /*
            =================================================
            JOIN
            =================================================
            */

            if (data.action === "join") {

                const id =
                    String(
                        data.userId ||
                        data.moi ||
                        ""
                    ).trim();

                if (!id) return;

                if (
                    myId &&
                    myId !== id
                ) {

                    retirerClient(
                        myId,
                        ws
                    );

                }

                const dejaEnLigne =
                    estEnLigne(id);

                myId = id;

                ajouterClient(
                    id,
                    ws
                );

                console.log(
                    id + " a rejoint"
                );

                /*
                Demande de présence du contact.
                */

                const avec =
                    String(
                        data.avec || ""
                    ).trim();

                if (avec) {

                    try {

                        ws.send(
                            JSON.stringify({
                                type: "presence",
                                userId: avec,
                                online:
                                    estEnLigne(avec)
                            })
                        );

                    } catch (e) {}

                }

                /*
                Nouvelle présence
                */

                if (!dejaEnLigne) {

                    diffuserPresence(
                        id,
                        true
                    );

                }

                return;
            }

            /*
            =================================================
            DEMANDE DE PRÉSENCE
            =================================================
            */

            if (data.action === "presence") {

                const targetId =
                    String(
                        data.userId ||
                        data.avec ||
                        ""
                    ).trim();

                if (!targetId) return;

                try {

                    ws.send(
                        JSON.stringify({
                            type: "presence",
                            userId: targetId,
                            online:
                                estEnLigne(
                                    targetId
                                )
                        })
                    );

                } catch (e) {}

                return;
            }

            /*
            =================================================
            MESSAGE
            =================================================
            */

            if (data.action === "message") {

                if (!myId) return;

                const toId =
                    String(
                        data.toid || ""
                    ).trim();

                if (!toId) return;

                envoyer(
                    toId,
                    {
                        type: "new_message",

                        id:
                            data.id || "",

                        fromid:
                            myId,

                        toid:
                            toId,

                        mess:
                            data.mess || "",

                        date:
                            data.date ||
                            new Date()
                                .toLocaleTimeString(
                                    "fr-FR",
                                    {
                                        hour: "2-digit",
                                        minute: "2-digit"
                                    }
                                ),

                        produit:
                            data.produit || null,

                        photo:
                            data.photo || "",

                        prix:
                            data.prix || "",

                        monnaie:
                            data.monnaie || ""
                    }
                );

                return;
            }

            /*
            =================================================
            MESSAGE LU
            =================================================
            */

            if (data.action === "read") {

                if (!myId) return;

                const messageId =
                    String(
                        data.messageId ||
                        data.id ||
                        ""
                    ).trim();

                const fromId =
                    String(
                        data.fromid ||
                        data.expediteur ||
                        ""
                    ).trim();

                if (
                    !messageId ||
                    !fromId
                ) {
                    return;
                }

                envoyer(
                    fromId,
                    {
                        type: "read",

                        messageId:
                            messageId,

                        by:
                            myId
                    }
                );

                return;
            }

            /*
            =================================================
            CONVERSATION LUE
            =================================================
            */

            if (
                data.action ===
                "conversation_read"
            ) {

                if (!myId) return;

                const avec =
                    String(
                        data.avec ||
                        data.fromid ||
                        ""
                    ).trim();

                if (!avec) return;

                envoyer(
                    avec,
                    {
                        type:
                            "conversation_read",

                        userId:
                            myId
                    }
                );

                return;
            }

            /*
            =================================================
            TYPING
            =================================================
            */

            if (data.action === "typing") {

                if (!myId) return;

                const toId =
                    String(
                        data.toid || ""
                    ).trim();

                if (!toId) return;

                envoyer(
                    toId,
                    {
                        type: "typing",

                        fromid:
                            myId
                    }
                );

                return;
            }

        } catch (e) {

            console.error(
                "Erreur WebSocket:",
                e.message
            );

        }

    });

    /*
    =====================================================
    FERMETURE
    =====================================================
    */

    ws.on("close", () => {

        if (myId) {

            console.log(
                myId +
                " connexion perdue, attente de 60 secondes"
            );

            retirerClient(
                myId,
                ws
            );

        }

    });

    /*
    =====================================================
    ERREUR
    =====================================================
    */

    ws.on("error", (err) => {

        console.error(
            "Erreur WebSocket:",
            err.message
        );

    });

});

/*
=========================================================
HEARTBEAT
=========================================================

Toutes les 25 secondes.

Si une connexion ne répond plus :
- elle est terminée ;
- retirerClient() démarre alors le délai de 60 secondes.
=========================================================
*/

const heartbeatInterval =
    setInterval(() => {

        for (
            const [userId, sockets]
            of clients
        ) {

            for (const ws of sockets) {

                if (
                    ws.isAlive === false
                ) {

                    try {
                        ws.terminate();
                    } catch (e) {}

                    continue;
                }

                ws.isAlive = false;

                try {
                    ws.ping();
                } catch (e) {}

            }

            /*
            Nettoyage éventuel
            */

            if (
                sockets.size === 0 &&
                !offlineTimers.has(userId)
            ) {

                retirerClient(
                    userId,
                    null
                );

            }

        }

    }, 25000);

/*
=========================================================
ARRÊT PROPRE
=========================================================
*/

function arretPropre() {

    clearInterval(
        heartbeatInterval
    );

    for (
        const [, timer]
        of offlineTimers
    ) {

        clearTimeout(timer);

    }

    offlineTimers.clear();

    for (
        const [, sockets]
        of clients
    ) {

        for (const ws of sockets) {

            try {
                ws.close();
            } catch (e) {}

        }

    }

    wss.close(() => {
        process.exit(0);
    });
}

process.on(
    "SIGTERM",
    arretPropre
);

process.on(
    "SIGINT",
    arretPropre
);


