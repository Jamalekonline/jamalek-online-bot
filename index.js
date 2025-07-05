const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const database = require('./database'); // Importer le module de base de données

async function connectToWhatsApp() {
    // Créer le dossier auth_info s'il n'existe pas
    if (!fs.existsSync('./auth_info')) {
        fs.mkdirSync('./auth_info');
    }

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false // Désactivé car déprécié
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
            console.log('Connexion fermée à cause de ', lastDisconnect?.error, ', reconnexion: ', shouldReconnect);
            
            if(shouldReconnect) {
                connectToWhatsApp();
            }
        } else if(connection === 'open') {
            console.log('Connexion établie! Jamalek.online.bot est en ligne!');
            console.log('Bot ID:', sock.user.id);
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Initialiser la base de données
    await database.init();
    
    // Gestionnaire de messages amélioré
    sock.ev.on('messages.upsert', async (m) => {
        console.log('Message upsert reçu - Type:', m.type);
        
        const msg = m.messages[0];
        if (!msg.key.fromMe) { // Supprimé la vérification du type notify
            const sender = msg.key.remoteJid;
            const messageText = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              '';
            
            console.log('Message reçu de', sender, ':', messageText);
            
            // Traitement des commandes
            if (messageText.toLowerCase() === 'salut' || 
                messageText.toLowerCase() === 'bonjour' || 
                messageText.toLowerCase() === 'hola') { // Ajout de "hola"
                
                console.log('Commande de salutation détectée, envoi de la réponse...');
                
                try {
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
                } catch (error) {
                    console.error('Erreur lors de l\'envoi de la réponse:', error);
                }
            }
            else if (messageText.toLowerCase() === 'aide' || messageText.toLowerCase() === 'help') {
                try {
                    await sock.sendMessage(sender, { 
                        text: `📋 *Liste des commandes Jamalek.online.bot:*
                        
*chercher [mot-clé]* : Rechercher des entreprises par mot-clé
*info [nom]* : Obtenir des détails sur une entreprise spécifique
*aide* : Afficher cette liste de commandes

Exemple: "chercher restaurant" ou "info Café des Arts"
                        `
                    });
                    console.log('Réponse aide envoyée avec succès');
                } catch (error) {
                    console.error('Erreur lors de l\'envoi de l\'aide:', error);
                }
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
                try {
                    await sock.sendMessage(sender, { text: 'Jamalek.online.bot est opérationnel! 👍' });
                    console.log('Test réponse envoyée avec succès');
                } catch (error) {
                    console.error('Erreur lors du test:', error);
                }
            }
            else {
                // Réponse par défaut pour les messages non reconnus
                try {
                    await sock.sendMessage(sender, { 
                        text: `Bonjour! Je ne comprends pas cette commande. Envoyez *aide* pour voir la liste des commandes disponibles.` 
                    });
                    console.log('Réponse par défaut envoyée');
                } catch (error) {
                    console.error('Erreur lors de l\'envoi de la réponse par défaut:', error);
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
            responseText += `📞 ${business.phone}\n`;
            responseText += `📍 ${business.address}\n`;
            responseText += `🏷️ ${business.category}\n\n`;
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
        responseText += `📞 *Téléphone:* ${business.phone}\n`;
        responseText += `📍 *Adresse:* ${business.address}\n`;
        responseText += `🏷️ *Catégorie:* ${business.category}\n\n`;
        responseText += `📝 *Description:* ${business.description}\n\n`;
        
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
  
  // TODO: Cette partie sera complétée dans la prochaine étape
  // pour traiter le code et obtenir un token
  
  res.send('Authentification réussie! Vous pouvez fermer cette fenêtre.');
});

// Démarrer le serveur Express
app.listen(PORT, () => {
  console.log(`Serveur web démarré sur le port ${PORT}`);
});

console.log('Démarrage de Jamalek.online.bot...');
connectToWhatsApp();