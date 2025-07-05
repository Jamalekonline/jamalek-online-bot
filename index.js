const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const {google} = require('googleapis');
const path = require('path');

// Assurez-vous que ces répertoires existent
const AUTH_DIR = './auth_info';
if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// Simuler la base de données pour tests
const mockDatabase = {
    init: async () => console.log('Base de données simulée initialisée'),
    searchBusinesses: async (keyword) => {
        console.log(`Recherche pour: ${keyword}`);
        return [
            { 
                name: 'Café Test', 
                phone: '+212 123456789', 
                address: 'Avenue Mohammed V, Casablanca', 
                category: 'Restaurant' 
            }
        ];
    },
    getBusiness: async (name) => {
        console.log(`Recherche d'info pour: ${name}`);
        return { 
            name: 'Café Test', 
            phone: '+212 123456789', 
            address: 'Avenue Mohammed V, Casablanca', 
            category: 'Restaurant',
            description: 'Un café test pour démontrer le fonctionnement du bot.',
            keywords: 'café, restaurant, test',
            photos: ['https://example.com/photo.jpg']
        };
    }
};

// Remplacez par votre vrai module de base de données quand il sera prêt
const database = mockDatabase;

async function connectToWhatsApp() {
    try {
        // Nettoyez les fichiers d'auth pour éviter les problèmes de synchronisation
        if (fs.existsSync(AUTH_DIR)) {
            fs.readdirSync(AUTH_DIR).forEach(file => {
                if (file.includes('app-state')) {
                    fs.unlinkSync(path.join(AUTH_DIR, file));
                }
            });
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            emitOwnEvents: false,
            fireInitQueries: false,
            generateHighQualityLinkPreview: false,
            shouldSyncHistoryMessage: () => false,
            // Cette configuration aide à éviter beaucoup d'erreurs
            transactionOpts: { maxCommitRetries: 1, delayBetweenTriesMs: 100 },
            patchMessageBeforeSending: msg => {
                const requiresPatch = !!(
                    msg.buttonsMessage || 
                    msg.listMessage || 
                    msg.templateMessage
                );
                if (requiresPatch) {
                    msg = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} }, ...msg } } };
                }
                return msg;
            }
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('QR Code reçu:');
                qrcode.generate(qr, { small: true });
                console.log('Scannez ce QR code avec WhatsApp sur votre téléphone');
            }
            
            if (connection === 'close') {
                const shouldReconnect = 
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`Connexion fermée due à: ${lastDisconnect?.error?.message}`);
                
                if (shouldReconnect) {
                    console.log('Tentative de reconnexion dans 3 secondes...');
                    setTimeout(connectToWhatsApp, 3000);
                }
            } else if (connection === 'open') {
                console.log('Connexion établie! Jamalek.online.bot est en ligne!');
                if (sock.user) {
                    console.log('Bot ID:', sock.user.id);
                }
                
                // Envoi d'un message de test à vous-même pour vérifier
                try {
                    const myNumber = sock.user.id.split(':')[0]; // Votre propre numéro
                    await sock.sendMessage(`${myNumber}@s.whatsapp.net`, { 
                        text: '✅ Bot démarré avec succès! Je suis prêt à recevoir des commandes.' 
                    });
                } catch (err) {
                    console.log('Impossible d\'envoyer le message de confirmation:', err);
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // Gestionnaire de messages simplifié avec beaucoup de logs
        sock.ev.on('messages.upsert', async (m) => {
            console.log('=== NOUVEAU MESSAGE REÇU ===');
            console.log('Type:', m.type);
            
            if (!m.messages || !m.messages.length) {
                console.log('Pas de messages dans cet événement');
                return;
            }
            
            const msg = m.messages[0];
            
            // Log complet pour débogage
            console.log('Message complet:', JSON.stringify(msg, null, 2));
            
            if (!msg.key || !msg.key.remoteJid) {
                console.log('Structure de message invalide');
                return;
            }
            
            // Ignore les messages du bot lui-même
            if (msg.key.fromMe) {
                console.log('Message envoyé par le bot, ignoré');
                return;
            }
            
            // Ignore les status
            if (msg.key.remoteJid === 'status@broadcast') {
                console.log('Message de statut, ignoré');
                return;
            }
            
            const sender = msg.key.remoteJid;
            
            // Extrait le texte du message de différentes façons possibles
            let messageText = '';
            if (msg.message) {
                if (msg.message.conversation) {
                    messageText = msg.message.conversation;
                } else if (msg.message.extendedTextMessage) {
                    messageText = msg.message.extendedTextMessage.text;
                } else if (msg.message.imageMessage) {
                    messageText = msg.message.imageMessage.caption || '';
                }
            }
            
            console.log(`Message de ${sender}: "${messageText}"`);
            
            // TOUJOURS répondre quelque chose pour vérifier que le bot fonctionne
            try {
                // Commandes
                if (messageText.toLowerCase() === 'ping') {
                    await sock.sendMessage(sender, { text: 'pong!' });
                    console.log('Réponse ping envoyée');
                }
                else if (messageText.toLowerCase() === 'salut' || 
                         messageText.toLowerCase() === 'bonjour' || 
                         messageText.toLowerCase() === 'hola') {
                    
                    await sock.sendMessage(sender, { 
                        text: `👋 Bonjour! Je suis le bot officiel de Jamalek Online.` 
                    });
                    console.log('Réponse salutation envoyée');
                }
                else {
                    // Pour le débogage, répondre à TOUS les messages
                    await sock.sendMessage(sender, { 
                        text: `Vous avez dit: "${messageText}"\n\nEnvoyez "ping" pour tester le bot.` 
                    });
                    console.log('Réponse par défaut envoyée');
                }
            } catch (error) {
                console.error('ERREUR lors de l\'envoi de la réponse:', error);
            }
        });
        
        return sock;
    } catch (err) {
        console.error('Erreur critique dans connectToWhatsApp:', err);
        console.log('Tentative de reconnexion dans 10 secondes...');
        setTimeout(connectToWhatsApp, 10000);
    }
}

// Routes express
app.get('/', (req, res) => {
    res.send(`
        <h1>Jamalek Online Bot</h1>
        <p>Le serveur est en ligne!</p>
        <p><a href="/status">Vérifier le statut</a></p>
    `);
});

// Route de statut
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'Jamalek Online Bot',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Route pour le callback OAuth Google
app.get('/oauth2callback', async (req, res) => {
    res.send('Authentification reçue! Cette fonctionnalité sera activée prochainement.');
});

// Démarrer le serveur Express
app.listen(PORT, () => {
    console.log(`Serveur web démarré sur le port ${PORT}`);
});

console.log('Démarrage de Jamalek.online.bot...');
connectToWhatsApp();