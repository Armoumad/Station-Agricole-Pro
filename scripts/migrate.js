const fs = require('fs').promises;

async function migrateData() {
    console.log('🔄 Migration des données...');
    
    try {
        // Lire les données actuelles
        const dataPath = 'data/station_data.json';
        const rawData = await fs.readFile(dataPath, 'utf8');
        const data = JSON.parse(rawData);
        
        console.log(`📊 Version actuelle: ${data.version || '1.0.0'}`);
        
        // Effectuer les migrations nécessaires
        let migrated = false;
        
        // Migration vers v2.0
        if (!data.version || data.version < '2.0.0') {
            console.log('🔄 Migration vers v2.0...');
            
            // Ajouter les nouvelles propriétés aux capteurs
            if (data.sensors) {
                data.sensors.forEach(sensor => {
                    if (!sensor.isJsonPayload) sensor.isJsonPayload = false;
                    if (!sensor.jsonPath) sensor.jsonPath = '';
                    if (!sensor.showReceivedTimestamp) sensor.showReceivedTimestamp = false;
                    if (!sensor.mqttQos) sensor.mqttQos = 1;
                });
            }
            
            // Ajouter les nouvelles propriétés aux réservoirs
            if (data.reservoirs) {
                data.reservoirs.forEach(reservoir => {
                    if (!reservoir.isJsonPayload) reservoir.isJsonPayload = false;
                    if (!reservoir.jsonPath) reservoir.jsonPath = '';
                    if (!reservoir.showReceivedTimestamp) reservoir.showReceivedTimestamp = false;
                    if (!reservoir.mqttQos) reservoir.mqttQos = 1;
                });
            }
            
            data.version = '2.0.0';
            migrated = true;
        }
        
        // Migration vers v3.0
        if (data.version < '3.0.0') {
            console.log('🔄 Migration vers v3.0...');
            
            // Ajouter le système d'événements
            if (!data.events) data.events = [];
            
            // Ajouter le log des actions
            if (!data.actionsLog) data.actionsLog = [];
            
            // Ajouter les paramètres d'automation aux réservoirs
            if (data.reservoirs) {
                data.reservoirs.forEach(reservoir => {
                    if (!reservoir.autoMode) reservoir.autoMode = false;
                    if (!reservoir.autoSettings) {
                        reservoir.autoSettings = {
                            minThreshold: 20,
                            maxThreshold: 90,
                            startTime: '06:00',
                            endTime: '20:00'
                        };
                    }
                });
            }
            
            // Mettre à jour la configuration
            if (!data.config) data.config = {};
            if (!data.config.autoMode) data.config.autoMode = true;
            if (!data.config.alertsEnabled) data.config.alertsEnabled = true;
            
            data.version = '3.0.0';
            migrated = true;
        }
        
        if (migrated) {
            // Sauvegarder les données migrées
            data.lastMigrated = new Date().toISOString();
            await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
            console.log(`✅ Migration terminée vers v${data.version}`);
        } else {
            console.log('✅ Données déjà à jour');
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la migration:', error);
        throw error;
    }
}

if (require.main === module) {
    migrateData().catch(console.error);
}

module.exports = { migrateData };
