const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const {google} = require('googleapis');
const database = require('./database'); // Importer le module de base de données

async function connectToWhatsApp() {
    // Créer le dossier auth_info s'il n'existe pas
    if (!fs.existsSync('./auth_info')) {
        fs.mkdirSync('./auth_info');
    }

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    // Obtenir la dernière version de Baileys
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Utilisation de Baileys v${version.join('.')}`);
    
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // Désactivé car déprécié
        syncFullHistory: false,   // Réduire la synchronisation pour éviter les erreurs
        connectTimeoutMs: 60000,  // Augmenter le timeout
        retry: {
            maxRetries: 5,        // Maximum de tentatives
            onRetry: (retryCount) => {
                console.log(`Tentative de reconnexion ${retryCount}...`);
            }
        },
        logger: {
            level: 'warn'         // Réduire le niveau de logging
        }
    });
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Afficher le QR code manuellement
        if (qr) {
            console.log('QR Code reçu, scannez-le avec WhatsApp sur votre téléphone:');
            qrcode.generate(qr, { small: true });
        }
        
        if(connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connexion fermée à cause de ', lastDisconnect?.error?.output?.payload?.message || lastDisconnect?.error?.message || 'Raison inconnue', ', reconnexion: ', shouldReconnect);
            
            if(shouldReconnect) {
                console.log('Tentative de reconnexion...');
                setTimeout(() => connectToWhatsApp(), 5000); // Délai avant de reconnecter
            }
        } else if(connection === 'open') {
            console.log('Connexion établie! Jamalek.online.bot est en ligne!');
            console.log('Bot ID:', sock.user?.id || 'ID non disponible');
        }
    });
    
    // Gérer les erreurs non capturées
    sock.ev.on('error', (err) => {
        console.error('Erreur globale du socket:', err);
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Initialiser la base de données
    try {
        await database.init();
        console.log('Base de données initialisée avec succès');
    } catch (error) {
        console.error('Erreur lors de l\'initialisation de la base de données:', error);
    }
    
    // Gestionnaire de messages amélioré
    sock.ev.on('messages.upsert', async (m) => {
        console.log('Message upsert reçu - Type:', m.type);
        
        if (!m.messages || m.messages.length === 0) {
            console.log('Aucun message dans l\'événement');
            return;
        }
        
        const msg = m.messages[0];
        
        // Vérifications de sécurité pour éviter les erreurs
        if (!msg || !msg.key) {
            console.log('Format de message invalide');
            return;
        }
        
        if (!msg.key.fromMe && msg.key.remoteJid && !msg.key.remoteJid.includes('status@broadcast')) {
            const sender = msg.key.remoteJid;
            const messageText = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              '';
            
            console.log('Message reçu de', sender, ':', messageText);
            
            try {
                // Traitement des commandes
                if (messageText.toLowerCase() === 'salut' || 
                    messageText.toLowerCase() === 'bonjour' || 
                    messageText.toLowerCase() === 'hola') {
                    
                    console.log('Commande de salutation détectée, envoi de la réponse...');
                    
                    await sock.sendMessage(sender, { 
                        text: `👋 Bonjour! Je suis le bot officiel de Jamalek Online.
                        
Comment puis-je vous aider aujourd'hui?

📋 *Commandes disponibles:*
- *chercher [mot-clé]* : Rechercher des entreprises par mot-clé
- *info [nom]* : Obtenir des détails sur une entreprise spécifique
- *aide* : Afficher ce message d'aide
                        `
                    });
                    console.log('Réponse de salutation envoyée avec succès');
                }
                else if (messageText.toLowerCase() === 'aide' || messageText.toLowerCase() === 'help') {
                    await sock.sendMessage(sender, { 
                        text: `📋 *Liste des commandes Jamalek.online.bot:*
                        
*chercher [mot-clé]* : Rechercher des entreprises par mot-clé
*info [nom]* : Obtenir des détails sur une entreprise spécifique
*aide* : Afficher cette liste de commandes

Exemple: "chercher restaurant" ou "info Café des Arts"
                        `
                    });
                    console.log('Réponse aide envoyée avec succès');
                }
                else if (messageText.toLowerCase().startsWith('chercher ')) {
                    const keyword = messageText.substring(8).trim();
                    await handleSearch(sock, sender, keyword);
                }
                else if (messageText.toLowerCase().startsWith('info ')) {
                    const businessName = messageText.substring(5).trim();
                    await handleBusinessInfo(sock, sender, businessName);
                }
                else if (messageText.toLowerCase() === 'test') {
                    await sock.sendMessage(sender, { text: 'Jamalek.online.bot est opérationnel! 👍' });
                    console.log('Test réponse envoyée avec succès');
                }
                else {
                    // Réponse par défaut pour les messages non reconnus
                    await sock.sendMessage(sender, { 
                        text: `Bonjour! Je ne comprends pas cette commande. Envoyez *aide* pour voir la liste des commandes disponibles.` 
                    });
                    console.log('Réponse par défaut envoyée');
                }
            } catch (error) {
                console.error('Erreur lors du traitement du message:', error);
                try {
                    await sock.sendMessage(sender, { 
                        text: 'Désolé, une erreur s\'est produite. Veuillez réessayer.' 
                    });
                } catch (replyError) {
                    console.error('Impossible d\'envoyer le message d\'erreur:', replyError);
                }
            }
        }
    });
    
    return sock;
}

// Fonction de recherche d'entreprise
async function handleSearch(sock, sender, keyword) {
    await sock.sendMessage(sender, { text: `🔍 Recherche en cours pour "${keyword}"...` });
    
    try {
        const results = await database.searchBusinesses(keyword);
        
        if (results.length === 0) {
            await sock.sendMessage(sender, { 
                text: `Aucune entreprise trouvée pour "${keyword}".

Essayez un autre mot-clé ou vérifiez l'orthographe.` 
            });
            return;
        }
        
        let responseText = `🔎 *${results.length} résultat(s) pour "${keyword}":*\n\n`;
        
        results.forEach((business, index) => {
            responseText += `*${index + 1}. ${business.name}*\n`;
            responseText += `📞 ${business.phone || 'N/A'}\n`;
            responseText += `📍 ${business.address || 'N/A'}\n`;
            responseText += `🏷️ ${business.category || 'N/A'}\n\n`;
        });
        
        responseText += `Pour plus de détails sur une entreprise, envoyez: *info [nom de l'entreprise]*`;
        
        await sock.sendMessage(sender, { text: responseText });
    } catch (error) {
        console.error('Erreur lors de la recherche:', error);
        await sock.sendMessage(sender, { 
            text: `Désolé, une erreur s'est produite lors de la recherche.` 
        });
    }
}

// Fonction pour obtenir les détails d'une entreprise
async function handleBusinessInfo(sock, sender, businessName) {
    await sock.sendMessage(sender, { text: `🔍 Recherche des informations pour "${businessName}"...` });
    
    try {
        const business = await database.getBusiness(businessName);
        
        if (!business) {
            await sock.sendMessage(sender, { 
                text: `Entreprise "${businessName}" non trouvée.

Vérifiez l'orthographe ou essayez de chercher avec un mot-clé.` 
            });
            return;
        }
        
        let responseText = `🏢 *${business.name}*\n\n`;
        responseText += `📞 *Téléphone:* ${business.phone || 'N/A'}\n`;
        responseText += `📍 *Adresse:* ${business.address || 'N/A'}\n`;
        responseText += `🏷️ *Catégorie:* ${business.category || 'N/A'}\n\n`;
        responseText += `📝 *Description:* ${business.description || 'Pas de description disponible'}\n\n`;
        
        if (business.keywords) {
            responseText += `🔑 *Mots-clés:* ${business.keywords}\n\n`;
        }
        
        await sock.sendMessage(sender, { text: responseText });
        
        // Envoyer des photos si disponibles
        if (business.photos && business.photos.length > 0) {
            for (const photoUrl of business.photos.slice(0, 3)) { // Limiter à 3 photos
                if (photoUrl && photoUrl.trim()) {
                    try {
                        await sock.sendMessage(sender, { 
                            image: { url: photoUrl.trim() },
                            caption: `📸 ${business.name}`
                        });
                    } catch (photoError) {
                        console.error('Erreur lors de l\'envoi de la photo:', photoError);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Erreur lors de la récupération des informations:', error);
        await sock.sendMessage(sender, { 
            text: `Désolé, une erreur s'est produite lors de la récupération des informations.` 
        });
    }
}

// Route pour le callback OAuth Google
app.get('/oauth2callback', async (req, res) => {
  const {code} = req.query;
  console.log('Code d\'autorisation reçu:', code);
  
  try {
    // Créer un client OAuth2
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID || '494704638276-16bpiatmca9926pqpqf16vdin92hlvig.apps.googleusercontent.com',
      process.env.GOOGLE_CLIENT_SECRET || 'votre_client_secret',
      process.env.REDIRECT_URI || 'https://jamalek-online-bot.onrender.com/oauth2callback'
    );
    
    // Échanger le code contre un token
    const {tokens} = await oauth2Client.getToken(code);
    console.log('Token obtenu avec succès');
    
    // Sauvegarder le token
    fs.writeFileSync('./token.json', JSON.stringify(tokens));
    
    res.send('Authentification réussie! Vous pouvez fermer cette fenêtre.');
  } catch (error) {
    console.error('Erreur lors de l\'échange du code d\'autorisation:', error);
    res.status(500).send('Erreur lors de l\'authentification: ' + error.message);
  }
});

// Route de test pour les credentials Google
app.get('/test-google', async (req, res) => {
  try {
    // Vérifier si le token existe
    if (!fs.existsSync('./token.json')) {
      return res.status(400).send('Token non trouvé. Veuillez d\'abord autoriser l\'application via l\'URL OAuth.');
    }
    
    const token = JSON.parse(fs.readFileSync('./token.json'));
    
    // Créer un client OAuth2
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID || '494704638276-16bpiatmca9926pqpqf16vdin92hlvig.apps.googleusercontent.com',
      process.env.GOOGLE_CLIENT_SECRET || 'votre_client_secret',
      process.env.REDIRECT_URI || 'https://jamalek-online-bot.onrender.com/oauth2callback'
    );
    
    auth.setCredentials(token);
    
    // Tester l'accès à l'API Sheets
    const sheets = google.sheets({version: 'v4', auth});
    const spreadsheetId = process.env.SPREADSHEET_ID || 'votre_spreadsheet_id';
    
    // Essayer de lire une plage pour vérifier l'accès
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'A1:B5', // Juste une plage de test
    });
    
    // Afficher les résultats
    res.json({
      success: true,
      message: 'Connexion à Google Sheets réussie!',
      rows: result.data.values || [],
      expires_at: new Date(token.expiry_date).toISOString()
    });
  } catch (error) {
    console.error('Erreur lors du test des credentials Google:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la connexion à Google Sheets',
      error: error.message
    });
  }
});

// Route pour vérifier l'état du bot
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    service: 'Jamalek Online Bot',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Démarrer le serveur Express
app.listen(PORT, () => {
  console.log(`Serveur web démarré sur le port ${PORT}`);
});

console.log('Démarrage de Jamalek.online.bot...');
connectToWhatsApp();