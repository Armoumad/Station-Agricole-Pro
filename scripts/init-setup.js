
// ============================================================================
// 📁 scripts/init-setup.js - Script d'initialisation
// ============================================================================

const fs = require('fs').promises;
const path = require('path');

async function initSetup() {
    console.log('🚀 Initialisation de la Station Agricole Professionnelle...');
    
    try {
        // Créer la structure des dossiers
        const folders = ['data', 'logs', 'backups', 'uploads', 'public'];
        
        for (const folder of folders) {
            await fs.mkdir(folder, { recursive: true });
            console.log(`📁 Dossier créé: ${folder}/`);
        }
        
        // Créer les fichiers de données initiaux
        const initialData = {
            sensors: [],
            reservoirs: [],
            events: [],
            actionsLog: [],
            sensorHistory: {},
            reservoirHistory: {},
            config: {
                mqttServer: 'mqtt://192.168.1.100:1883',
                baseTopic: 'agriculture/',
                updateInterval: 5000,
                autoMode: true,
                alertsEnabled: true
            },
            version: '3.0.0',
            lastSaved: new Date().toISOString()
        };
        
        await fs.writeFile(
            'data/station_data.json', 
            JSON.stringify(initialData, null, 2)
        );
        console.log('📊 Fichier de données initial créé');
        
        // Créer le fichier .env s'il n'existe pas
        const envExists = await fs.access('.env').then(() => true).catch(() => false);
        if (!envExists) {
            const envContent = `# Configuration Station Agricole Professionnelle
PORT=3000
MQTT_BROKER=mqtt://192.168.1.100:1883
JWT_SECRET=${generateRandomSecret()}
NODE_ENV=development
DATA_BACKUP_INTERVAL=30000
LOG_LEVEL=info
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_USER=
EMAIL_PASS=
TWILIO_SID=
TWILIO_TOKEN=
TWILIO_PHONE=
`;
            
            await fs.writeFile('.env', envContent);
            console.log('⚙️ Fichier .env créé');
        }
        
        // Créer le fichier PM2 ecosystem
        const ecosystemConfig = `module.exports = {
  apps: [{
    name: 'station-agricole',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};`;
        
        await fs.writeFile('ecosystem.config.js', ecosystemConfig);
        console.log('🔧 Configuration PM2 créée');
        
        console.log('✅ Initialisation terminée avec succès!');
        console.log('\n📋 Prochaines étapes:');
        console.log('1. Modifier le fichier .env avec vos paramètres');
        console.log('2. Démarrer avec: npm start');
        console.log('3. Ou en mode développement: npm run dev');
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
        process.exit(1);
    }
}

function generateRandomSecret() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 64; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

if (require.main === module) {
    initSetup();
}

module.exports = { initSetup };