// ============================================================================
// 🥽 PATCH BOUTON AR - MODIFICATION AUTOMATIQUE INDEX.HTML
// ============================================================================
// Usage: node patch-ar-button.js

const fs = require('fs');
const path = require('path');

console.log('🥽 Patch Bouton AR - Station Agricole');
console.log('====================================');

// Configuration
const indexFilePath = 'index.html';
const backupSuffix = '.backup-ar';

// ============================================================================
// FONCTION PRINCIPALE
// ============================================================================

function patchARButton() {
    try {
        // 1. Vérifier si le fichier existe
        if (!fs.existsSync(indexFilePath)) {
            console.log(`❌ Fichier ${indexFilePath} non trouvé`);
            console.log('💡 Assurez-vous d\'être dans le répertoire du projet');
            return false;
        }

        // 2. Lire le contenu
        console.log('📖 Lecture du fichier index.html...');
        let content = fs.readFileSync(indexFilePath, 'utf8');

        // 3. Vérifier si déjà patché
        if (content.includes('Mode AR') || content.includes('ar-link')) {
            console.log('⚠️  Le bouton AR semble déjà installé');
            console.log('🔍 Recherche de "Mode AR" ou "ar-link" trouvée dans le fichier');
            return true;
        }

        // 4. Créer backup
        console.log('💾 Création du backup...');
        const backupPath = indexFilePath + backupSuffix;
        fs.writeFileSync(backupPath, content);
        console.log(`✅ Backup créé : ${backupPath}`);

        // 5. Ajouter le bouton AR dans la navigation
        console.log('🧭 Ajout du bouton AR dans la navigation...');
        
        const navButtonHTML = `                    <li class="nav-item">
                        <a href="/ar.html" class="nav-link ar-link" target="_blank">
                            <span>🥽</span>
                            <span>Mode AR</span>
                        </a>
                    </li>`;

        // Trouver la fin de la section nav-menu (après le lien Paramètres)
        const navMenuRegex = /(<li class="nav-item">\s*<a href="#" class="nav-link" data-section="settings">[\s\S]*?<\/li>)/;
        
        if (navMenuRegex.test(content)) {
            content = content.replace(navMenuRegex, '$1\n' + navButtonHTML);
            console.log('✅ Bouton AR ajouté à la navigation');
        } else {
            console.log('⚠️  Structure navigation non trouvée, ajout alternatif...');
            
            // Méthode alternative : chercher </ul> de nav-menu
            const altRegex = /(.*class="nav-menu">[\s\S]*?)(\s*<\/ul>)/;
            if (altRegex.test(content)) {
                content = content.replace(altRegex, `$1${navButtonHTML}\n$2`);
                console.log('✅ Bouton AR ajouté (méthode alternative)');
            } else {
                console.log('❌ Impossible de trouver la section navigation');
                return false;
            }
        }

        // 6. Ajouter les styles AR
        console.log('🎨 Ajout des styles AR...');
        
        const arStyles = `
        /* AR Mode Styles */
        .ar-link {
            background: linear-gradient(45deg, #9C27B0, #673AB7) !important;
            color: white !important;
            animation: arPulse 2s infinite;
            position: relative;
            overflow: hidden;
        }

        .ar-link::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
            transform: rotate(45deg);
            animation: shimmer 3s infinite;
        }

        @keyframes arPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }

        @keyframes shimmer {
            0% { transform: rotate(45deg) translateX(-100%); }
            100% { transform: rotate(45deg) translateX(100%); }
        }

        .ar-link:hover {
            background: linear-gradient(45deg, #673AB7, #9C27B0) !important;
            transform: translateY(-3px) !important;
            box-shadow: 0 8px 25px rgba(156, 39, 176, 0.4) !important;
            animation: none;
        }

        .ar-link::after {
            content: 'NOUVEAU';
            position: absolute;
            top: -8px;
            right: -8px;
            background: #FF4444;
            color: white;
            font-size: 0.6em;
            padding: 2px 6px;
            border-radius: 8px;
            font-weight: 700;
            animation: bounce 1s infinite alternate;
        }

        @keyframes bounce {
            0% { transform: translateY(0); }
            100% { transform: translateY(-2px); }
        }`;

        // Injecter les styles avant </style>
        if (content.includes('</style>')) {
            content = content.replace('</style>', arStyles + '\n        </style>');
            console.log('✅ Styles AR ajoutés');
        } else {
            console.log('⚠️  Balise </style> non trouvée, styles non ajoutés');
        }

        // 7. Ajouter le JavaScript AR
        console.log('⚙️ Ajout du JavaScript AR...');
        
        const arScript = `
        // ============================================================================
        // 🥽 AR SUPPORT ET NOTIFICATION
        // ============================================================================
        
        function checkARSupport() {
            if ('mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices) {
                navigator.mediaDevices.getUserMedia({ video: true })
                    .then(() => {
                        console.log('📹 Caméra disponible pour AR');
                        const arLink = document.querySelector('.ar-link');
                        if (arLink) {
                            arLink.style.display = 'flex';
                            arLink.title = 'Cliquez pour accéder au mode AR';
                        }
                    })
                    .catch(() => {
                        console.log('❌ Caméra non disponible pour AR');
                        const arLink = document.querySelector('.ar-link');
                        if (arLink) {
                            arLink.style.opacity = '0.5';
                            arLink.title = 'Caméra requise pour utiliser l\\'AR';
                        }
                    });
            } else {
                console.log('❌ API MediaDevices non supportée');
                const arLink = document.querySelector('.ar-link');
                if (arLink) {
                    arLink.style.opacity = '0.3';
                    arLink.title = 'Navigateur non compatible AR';
                }
            }
        }

        // Notification AR au premier chargement
        function showARNotification() {
            setTimeout(() => {
                const hasSeenAR = localStorage.getItem('ar_notification_shown');
                if (!hasSeenAR) {
                    showNotification('🥽 NOUVEAU : Mode AR disponible ! Cliquez sur le bouton violet pour découvrir la réalité augmentée.', 'success');
                    localStorage.setItem('ar_notification_shown', 'true');
                }
            }, 3000);
        }

        // Gestionnaire de clic AR avec vérification
        function handleARClick(event) {
            const arLink = document.querySelector('.ar-link');
            if (arLink && arLink.style.opacity === '0.5') {
                event.preventDefault();
                showNotification('⚠️ Caméra requise pour le mode AR. Autorisez l\\'accès à la caméra.', 'warning');
                return false;
            }
            
            // Ouvrir AR dans nouvel onglet
            console.log('🥽 Ouverture du mode AR...');
            showNotification('🚀 Lancement du mode AR...', 'info');
            return true;
        }

        // Initialisation AR
        document.addEventListener('DOMContentLoaded', function() {
            console.log('🥽 Initialisation support AR...');
            checkARSupport();
            showARNotification();
            
            // Ajouter gestionnaire de clic
            const arLink = document.querySelector('.ar-link');
            if (arLink) {
                arLink.addEventListener('click', handleARClick);
                console.log('✅ Gestionnaire AR configuré');
            }
        });

        console.log('🥽 Station Agricole AR v2.3.0 - Bouton AR intégré');`;

        // Injecter le script avant la fin
        const scriptInsertPoint = 'console.log(\'🔧 Station Agricole v2.3 - Interface Complète 100% Fonctionnelle Corrigée\');';
        if (content.includes(scriptInsertPoint)) {
            content = content.replace(scriptInsertPoint, scriptInsertPoint + '\n' + arScript);
            console.log('✅ JavaScript AR ajouté');
        } else {
            // Méthode alternative : avant </script>
            const beforeScriptEnd = /(\s*<\/script>\s*<\/body>)/;
            if (beforeScriptEnd.test(content)) {
                content = content.replace(beforeScriptEnd, arScript + '\n$1');
                console.log('✅ JavaScript AR ajouté (méthode alternative)');
            } else {
                console.log('⚠️  Point d\'insertion JavaScript non trouvé');
            }
        }

        // 8. Sauvegarder le fichier modifié
        console.log('💾 Sauvegarde du fichier modifié...');
        fs.writeFileSync(indexFilePath, content);

        console.log('');
        console.log('🎉 PATCH AR RÉUSSI !');
        console.log('==================');
        console.log('✅ Bouton AR ajouté à la navigation');
        console.log('✅ Styles AR intégrés');
        console.log('✅ JavaScript AR configuré');
        console.log('✅ Support caméra détecté automatiquement');
        console.log('');
        console.log('🔄 Redémarrez le serveur pour voir les changements');
        console.log('🥽 Le bouton violet "Mode AR" apparaîtra dans la navigation');
        
        return true;

    } catch (error) {
        console.error('❌ Erreur lors du patch:', error);
        return false;
    }
}

// ============================================================================
// FONCTION DE RESTORATION
// ============================================================================

function restoreBackup() {
    const backupPath = indexFilePath + backupSuffix;
    
    if (fs.existsSync(backupPath)) {
        console.log('🔄 Restauration du backup...');
        const backupContent = fs.readFileSync(backupPath, 'utf8');
        fs.writeFileSync(indexFilePath, backupContent);
        console.log('✅ Backup restauré avec succès');
        return true;
    } else {
        console.log('❌ Aucun backup trouvé');
        return false;
    }
}

// ============================================================================
// FONCTION DE VERIFICATION
// ============================================================================

function verifyPatch() {
    if (!fs.existsSync(indexFilePath)) {
        console.log('❌ Fichier index.html non trouvé');
        return false;
    }

    const content = fs.readFileSync(indexFilePath, 'utf8');
    
    const checks = {
        navigation: content.includes('Mode AR'),
        styles: content.includes('.ar-link'),
        javascript: content.includes('checkARSupport'),
        animations: content.includes('@keyframes arPulse')
    };

    console.log('🔍 Vérification du patch AR :');
    console.log(`   Navigation : ${checks.navigation ? '✅' : '❌'}`);
    console.log(`   Styles     : ${checks.styles ? '✅' : '❌'}`);
    console.log(`   JavaScript : ${checks.javascript ? '✅' : '❌'}`);
    console.log(`   Animations : ${checks.animations ? '✅' : '❌'}`);

    const allChecksPass = Object.values(checks).every(check => check);
    
    if (allChecksPass) {
        console.log('🎉 Patch AR vérifié avec succès !');
    } else {
        console.log('⚠️  Patch AR incomplet ou manquant');
    }

    return allChecksPass;
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

function showHelp() {
    console.log('');
    console.log('Usage: node patch-ar-button.js [option]');
    console.log('');
    console.log('Options:');
    console.log('  (aucune)   Installer le patch AR');
    console.log('  --verify   Vérifier si le patch est installé');
    console.log('  --restore  Restaurer le backup');
    console.log('  --help     Afficher cette aide');
    console.log('');
}

// ============================================================================
// EXECUTION
// ============================================================================

if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help')) {
        showHelp();
    } else if (args.includes('--verify')) {
        verifyPatch();
    } else if (args.includes('--restore')) {
        restoreBackup();
    } else {
        patchARButton();
    }
}

module.exports = {
    patchARButton,
    restoreBackup,
    verifyPatch
};