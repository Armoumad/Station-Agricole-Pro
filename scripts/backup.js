const fs = require('fs').promises;
const path = require('path');
const { createReadStream, createWriteStream } = require('fs');
const { createGzip } = require('zlib');
const { pipeline } = require('stream');

async function createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_${timestamp}`;
    const backupDir = path.join('backups', backupName);
    
    try {
        console.log('💾 Création de la sauvegarde...');
        
        // Créer le dossier de sauvegarde
        await fs.mkdir(backupDir, { recursive: true });
        
        // Copier les fichiers de données
        const filesToBackup = [
            'data/station_data.json',
            'data/users.json',
            '.env'
        ];
        
        for (const file of filesToBackup) {
            try {
                const data = await fs.readFile(file);
                const filename = path.basename(file);
                await fs.writeFile(path.join(backupDir, filename), data);
                console.log(`✅ Sauvegardé: ${file}`);
            } catch (error) {
                console.log(`⚠️ Fichier ignoré (non trouvé): ${file}`);
            }
        }
        
        // Compresser la sauvegarde
        const archivePath = `${backupDir}.tar.gz`;
        await compressDirectory(backupDir, archivePath);
        
        // Supprimer le dossier temporaire
        await fs.rmdir(backupDir, { recursive: true });
        
        console.log(`✅ Sauvegarde créée: ${archivePath}`);
        
        // Nettoyer les anciennes sauvegardes (garder 30 jours)
        await cleanOldBackups();
        
        return archivePath;
        
    } catch (error) {
        console.error('❌ Erreur lors de la sauvegarde:', error);
        throw error;
    }
}

async function compressDirectory(sourceDir, targetFile) {
    return new Promise((resolve, reject) => {
        const tar = require('tar');
        
        tar.create(
            {
                gzip: true,
                file: targetFile,
                cwd: path.dirname(sourceDir)
            },
            [path.basename(sourceDir)]
        ).then(resolve).catch(reject);
    });
}

async function cleanOldBackups() {
    try {
        const backupsDir = 'backups';
        const files = await fs.readdir(backupsDir);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        for (const file of files) {
            if (file.startsWith('backup_') && file.endsWith('.tar.gz')) {
                const filePath = path.join(backupsDir, file);
                const stats = await fs.stat(filePath);
                
                if (stats.mtime < thirtyDaysAgo) {
                    await fs.unlink(filePath);
                    console.log(`🗑️ Ancienne sauvegarde supprimée: ${file}`);
                }
            }
        }
    } catch (error) {
        console.error('⚠️ Erreur nettoyage sauvegardes:', error);
    }
}

if (require.main === module) {
    createBackup().catch(console.error);
}

module.exports = { createBackup, cleanOldBackups };