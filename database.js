const { google } = require('googleapis');
const { initAuth } = require('./google-auth');

// ID de votre Google Sheet
const SPREADSHEET_ID = '1txbg_ptbpjg9XuDERjWQcyDj1zKIK4uYcFjigbHSboU'; // ID visible dans l'URL de votre Google Sheet

class Database {
  constructor() {
    this.sheets = null;
    this.initialized = false;
  }

  // Initialiser la connexion
  async init() {
    if (this.initialized) return;
    
    return new Promise((resolve) => {
      initAuth(auth => {
        this.sheets = google.sheets({ version: 'v4', auth });
        this.initialized = true;
        console.log('Connexion à Google Sheets établie avec succès.');
        resolve();
      });
    });
  }

  // Rechercher des entreprises par mot-clé
  async searchBusinesses(keyword) {
    await this.init();
    
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Businesses!A2:H',
      });
      
      const rows = response.data.values || [];
      
      // Filtrer les résultats contenant le mot-clé
      return rows
        .filter(row => {
          // Vérifier dans le nom, la description et les mots-clés
          const name = row[1] || '';
          const description = row[4] || '';
          const keywords = row[7] || '';
          
          const searchTerm = keyword.toLowerCase();
          return name.toLowerCase().includes(searchTerm) || 
                 description.toLowerCase().includes(searchTerm) || 
                 keywords.toLowerCase().includes(searchTerm);
        })
        .map(row => ({
          id: row[0],
          name: row[1],
          address: row[2],
          phone: row[3],
          description: row[4],
          photos: row[5] ? row[5].split(',') : [],
          category: row[6],
          keywords: row[7]
        }));
    } catch (error) {
      console.error('Erreur lors de la recherche:', error);
      return [];
    }
  }

  // Obtenir une entreprise par ID ou nom exact
  async getBusiness(idOrName) {
    await this.init();
    
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Businesses!A2:H',
      });
      
      const rows = response.data.values || [];
      
      // Chercher par ID ou nom exact
      const row = rows.find(row => row[0] === idOrName || row[1] === idOrName);
      
      if (!row) return null;
      
      return {
        id: row[0],
        name: row[1],
        address: row[2],
        phone: row[3],
        description: row[4],
        photos: row[5] ? row[5].split(',') : [],
        category: row[6],
        keywords: row[7]
      };
    } catch (error) {
      console.error('Erreur lors de la récupération:', error);
      return null;
    }
  }
}

module.exports = new Database();