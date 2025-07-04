// Créez un fichier init-google.js
const { initAuth } = require('./google-auth');

// Initialiser l'authentification
initAuth((auth) => {
  console.log('Authentification réussie!');
  process.exit();
});