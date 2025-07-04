const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// Portées d'accès
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TOKEN_PATH = 'token.json';

// Fonction d'autorisation
function authorize(callback) {
  // Identifiants en dur pour éviter les problèmes de lecture de fichier
  const credentials = {
    "installed": {
      "client_id": "494704638276-816ea2drk9g1o1dnsh60nr1lf78c70ad.apps.googleusercontent.com",
      "project_id": "jamalekbot",
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token",
      "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
      "client_secret": "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",
      "redirect_uris": ["http://localhost"]
    }
  };

  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Vérifier si un token existe déjà
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const token = fs.readFileSync(TOKEN_PATH, 'utf8');
      oAuth2Client.setCredentials(JSON.parse(token));
      callback(oAuth2Client);
      return;
    }
  } catch (err) {
    console.log('Aucun token valide trouvé, génération d\'un nouveau token...');
  }
  
  return getNewToken(oAuth2Client, callback);
}

// Obtenir un nouveau token
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Autorisez cette application en visitant cette URL:', authUrl);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  rl.question('Entrez le code de la page après autorisation: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Erreur lors de la récupération du token d\'accès', err);
      oAuth2Client.setCredentials(token);
      // Enregistrer le token pour les prochaines exécutions
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
      console.log('Token enregistré dans', TOKEN_PATH);
      callback(oAuth2Client);
    });
  });
}

// Exporter la fonction d'initialisation
function initAuth(callback) {
  authorize(callback);
}

module.exports = { initAuth };

// Dans google-auth.js ou init-google.js
let credentials;
if (process.env.GOOGLE_CREDENTIALS) {
  credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
} else {
  credentials = require('./credentials.json');
}