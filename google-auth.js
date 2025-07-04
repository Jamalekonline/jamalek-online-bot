const {google} = require('googleapis');
const fs = require('fs');

// Configurations OAuth
const CLIENT_ID = '494704638276-16bpiatmca9926pqpqf16vdin92hlvig.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = process.env.NODE_ENV === 'production'
  ? 'https://jamalek-online-bot.onrender.com/oauth2callback'
  : 'http://localhost';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = 'token.json';

/**
 * Crée un client OAuth2
 */
function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

/**
 * Initialise l'authentification OAuth2
 */
async function initAuth(callback) {
  try {
    // Vérifier si le token existe
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
      const oAuth2Client = getOAuth2Client();
      oAuth2Client.setCredentials(token);
      callback(oAuth2Client);
    } else {
      const oAuth2Client = getOAuth2Client();
      // Générer l'URL d'autorisation
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
      });
      console.log('Autorisez cette application en visitant cette URL:', authUrl);
      // Le code sera récupéré manuellement pour l'instant
      console.log('Entrez le code de la page après autorisation:');
    }
  } catch (error) {
    console.error('Erreur lors de l\'initialisation de l\'authentification:', error);
  }
}

module.exports = {
  initAuth,
  getOAuth2Client
};
