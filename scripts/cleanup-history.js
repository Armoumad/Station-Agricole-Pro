const fs = require('fs').promises;

async function cleanupHistory() {
    console.log('🧹 Nettoyage de l\'historique...');
    
    try {
        const dataPath = 'data/station_data.json';
        const rawData = await fs.readFile(dataPath, 'utf8');
        const data = JSON.parse(rawData);
        
        let totalCleaned = 0;
        
        // Nettoyer l'historique des capteurs
        if (data.sensorHistory) {
            Object.keys(data.sensorHistory).forEach(sensorId => {
                const history = data.sensorHistory[sensorId];
                if (history.length > 1000) {
                    const cleaned = history.length - 1000;
                    data.sensorHistory[sensorId] = history.slice(-1000);
                    totalCleaned += cleaned;
                    console.log(`📊 Capteur ${sensorId}: ${cleaned} entrées supprimées`);
                }
            });
        }
        
        // Nettoyer l'historique des réservoirs
        if (data.reservoirHistory) {
            Object.keys(data.reservoirHistory).forEach(reservoirId => {
                const history = data.reservoirHistory[reservoirId];
                if (history.length > 1000) {
                    const cleaned = history.length - 1000;
                    data.reservoirHistory[reservoirId] = history.slice(-1000);
                    totalCleaned += cleaned;
                    console.log(`🫗 Réservoir ${reservoirId}: ${cleaned} entrées supprimées`);
                }
            });
        }
        
        // Nettoyer les logs d'actions (garder 7 jours)
        if (data.actionsLog) {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const initialCount = data.actionsLog.length;
            data.actionsLog = data.actionsLog.filter(log => 
                new Date(log.timestamp) > sevenDaysAgo
            );
            
            const cleaned = initialCount - data.actionsLog.length;
            if (cleaned > 0) {
                totalCleaned += cleaned;
                console.log(`📋 Actions: ${cleaned} logs supprimés`);
            }
        }
        
        if (totalCleaned > 0) {
            // Sauvegarder les données nettoyées
            data.lastCleaned = new Date().toISOString();
            await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
            console.log(`✅ Nettoyage terminé: ${totalCleaned} entrées supprimées`);
        } else {
            console.log('✅ Aucun nettoyage nécessaire');
        }
        
    } catch (error) {
        console.error('❌ Erreur lors du nettoyage:', error);
        throw error;
    }
}

if (require.main === module) {
    cleanupHistory().catch(console.error);
}

module.exports = { cleanupHistory };