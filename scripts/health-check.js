
const http = require('http');
const fs = require('fs').promises;

async function healthCheck() {
    console.log('🏥 Vérification de la santé du système...');
    
    const checks = [];
    
    // Vérifier le serveur web
    checks.push(checkWebServer());
    
    // Vérifier les fichiers de données
    checks.push(checkDataFiles());
    
    // Vérifier l'espace disque
    checks.push(checkDiskSpace());
    
    // Vérifier la mémoire
    checks.push(checkMemory());
    
    try {
        const results = await Promise.all(checks);
        const allHealthy = results.every(result => result.status === 'OK');
        
        console.log('\n📊 Résultats de la vérification:');
        results.forEach(result => {
            const icon = result.status === 'OK' ? '✅' : '❌';
            console.log(`${icon} ${result.name}: ${result.message}`);
        });
        
        if (allHealthy) {
            console.log('\n🎉 Système en bonne santé!');
            process.exit(0);
        } else {
            console.log('\n⚠️ Problèmes détectés!');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('❌ Erreur lors de la vérification:', error);
        process.exit(1);
    }
}

async function checkWebServer() {
    return new Promise((resolve) => {
        const req = http.request('http://localhost:3000/api/health', (res) => {
            if (res.statusCode === 200) {
                resolve({
                    name: 'Serveur Web',
                    status: 'OK',
                    message: 'Serveur répond correctement'
                });
            } else {
                resolve({
                    name: 'Serveur Web',
                    status: 'ERROR',
                    message: `Code de statut: ${res.statusCode}`
                });
            }
        });
        
        req.on('error', () => {
            resolve({
                name: 'Serveur Web',
                status: 'ERROR',
                message: 'Serveur non accessible'
            });
        });
        
        req.setTimeout(5000, () => {
            resolve({
                name: 'Serveur Web',
                status: 'ERROR',
                message: 'Timeout de connexion'
            });
        });
        
        req.end();
    });
}

async function checkDataFiles() {
    try {
        const requiredFiles = [
            'data/station_data.json',
            'server.js',
            'package.json'
        ];
        
        for (const file of requiredFiles) {
            await fs.access(file);
        }
        
        return {
            name: 'Fichiers de données',
            status: 'OK',
            message: 'Tous les fichiers requis sont présents'
        };
        
    } catch (error) {
        return {
            name: 'Fichiers de données',
            status: 'ERROR',
            message: 'Fichiers manquants ou inaccessibles'
        };
    }
}

async function checkDiskSpace() {
    try {
        const stats = await fs.statfs('.');
        const freeBytes = stats.bavail * stats.bsize;
        const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
        
        if (freeGB > 1) {
            return {
                name: 'Espace disque',
                status: 'OK',
                message: `${freeGB} GB disponibles`
            };
        } else {
            return {
                name: 'Espace disque',
                status: 'ERROR',
                message: `Espace faible: ${freeGB} GB`
            };
        }
        
    } catch (error) {
        return {
            name: 'Espace disque',
            status: 'ERROR',
            message: 'Impossible de vérifier l\'espace disque'
        };
    }
}

async function checkMemory() {
    const memUsage = process.memoryUsage();
    const usedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    const totalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
    
    if (usedMB < 500) {
        return {
            name: 'Mémoire',
            status: 'OK',
            message: `${usedMB}MB / ${totalMB}MB utilisés`
        };
    } else {
        return {
            name: 'Mémoire',
            status: 'ERROR',
            message: `Utilisation élevée: ${usedMB}MB`
        };
    }
}

if (require.main === module) {
    healthCheck();
}

module.exports = { healthCheck };
