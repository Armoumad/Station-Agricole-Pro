#!/usr/bin/env node

// ============================================================================
// 👥 SCRIPT DE GESTION DES UTILISATEURS - STATION AGRICOLE
// ============================================================================
// Usage: node scripts/create-users.js [command] [options]
// 
// Commands:
//   create    - Créer un nouvel utilisateur
//   list      - Lister tous les utilisateurs
//   update    - Modifier un utilisateur existant
//   delete    - Supprimer un utilisateur
//   reset     - Réinitialiser le mot de passe
//   seed      - Créer les utilisateurs par défaut

const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const readline = require('readline');

// Configuration
const CONFIG = {
    USERS_FILE: './data/users.json',
    BCRYPT_ROUNDS: 12
};

// Interface de saisie
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Couleurs pour le terminal
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// Fonctions utilitaires
function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
    log(`❌ Erreur: ${message}`, 'red');
}

function success(message) {
    log(`✅ ${message}`, 'green');
}

function info(message) {
    log(`ℹ️  ${message}`, 'blue');
}

function warning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

// Question interactive
function question(prompt) {
    return new Promise((resolve) => {
        rl.question(`${colors.cyan}${prompt}${colors.reset} `, resolve);
    });
}

// Question pour mot de passe (masquée)
function questionPassword(prompt) {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        
        let password = '';
        process.stdout.write(`${colors.cyan}${prompt}${colors.reset} `);
        
        stdin.on('data', function(char) {
            char = char + '';
            
            switch (char) {
                case '\n':
                case '\r':
                case '\u0004':
                    stdin.setRawMode(false);
                    stdin.pause();
                    console.log();
                    resolve(password);
                    break;
                case '\u0003':
                    process.exit();
                    break;
                case '\u007F': // Backspace
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                    break;
                default:
                    password += char;
                    process.stdout.write('*');
                    break;
            }
        });
    });
}

// Charger les utilisateurs
async function loadUsers() {
    try {
        const data = await fs.readFile(CONFIG.USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return []; // Fichier n'existe pas
        }
        throw error;
    }
}

// Sauvegarder les utilisateurs
async function saveUsers(users) {
    try {
        await fs.mkdir('./data', { recursive: true });
        await fs.writeFile(CONFIG.USERS_FILE, JSON.stringify(users, null, 2));
        success('Utilisateurs sauvegardés');
    } catch (error) {
        throw new Error(`Impossible de sauvegarder: ${error.message}`);
    }
}

// Valider les données utilisateur
function validateUser(userData) {
    const errors = [];
    
    if (!userData.username || userData.username.length < 3) {
        errors.push('Le nom d\'utilisateur doit contenir au moins 3 caractères');
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(userData.username)) {
        errors.push('Le nom d\'utilisateur ne peut contenir que des lettres, chiffres, _ et -');
    }
    
    if (!userData.password || userData.password.length < 6) {
        errors.push('Le mot de passe doit contenir au moins 6 caractères');
    }
    
    if (!['admin', 'farmer', 'viewer'].includes(userData.role)) {
        errors.push('Le rôle doit être: admin, farmer ou viewer');
    }
    
    if (userData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userData.email)) {
        errors.push('Format email invalide');
    }
    
    return errors;
}

// ============================================================================
// COMMANDES
// ============================================================================

// Créer un utilisateur
async function createUser(options = {}) {
    try {
        log('\n👤 Création d\'un nouvel utilisateur', 'bright');
        log('═'.repeat(40), 'blue');
        
        const users = await loadUsers();
        
        // Collecte des informations
        const userData = {};
        
        userData.username = options.username || await question('Nom d\'utilisateur: ');
        
        // Vérifier si l'utilisateur existe déjà
        if (users.find(u => u.username === userData.username)) {
            error(`L'utilisateur "${userData.username}" existe déjà`);
            return;
        }
        
        userData.password = options.password || await questionPassword('Mot de passe: ');
        userData.fullName = options.fullName || await question('Nom complet: ') || userData.username;
        userData.email = options.email || await question('Email (optionnel): ') || '';
        
        // Sélection du rôle
        if (!options.role) {
            log('\nRôles disponibles:', 'yellow');
            log('  1. admin    - Accès complet (gestion utilisateurs)');
            log('  2. farmer   - Gestion capteurs et réservoirs');
            log('  3. viewer   - Lecture seule');
            
            const roleChoice = await question('Choisir un rôle (1-3): ');
            const roles = { '1': 'admin', '2': 'farmer', '3': 'viewer' };
            userData.role = roles[roleChoice] || 'viewer';
        } else {
            userData.role = options.role;
        }
        
        // Validation
        const errors = validateUser(userData);
        if (errors.length > 0) {
            error('Erreurs de validation:');
            errors.forEach(err => log(`  - ${err}`, 'red'));
            return;
        }
        
        // Hachage du mot de passe
        info('Hachage du mot de passe...');
        const hashedPassword = await bcrypt.hash(userData.password, CONFIG.BCRYPT_ROUNDS);
        
        // Créer l'utilisateur
        const newUser = {
            id: Date.now().toString(),
            username: userData.username,
            password: hashedPassword,
            role: userData.role,
            fullName: userData.fullName,
            email: userData.email,
            active: true,
            createdAt: new Date().toISOString(),
            createdBy: 'admin-script'
        };
        
        users.push(newUser);
        await saveUsers(users);
        
        success(`Utilisateur "${userData.username}" créé avec succès!`);
        info(`Rôle: ${userData.role}`);
        info(`Email: ${userData.email || 'Non défini'}`);
        
    } catch (error) {
        error(`Erreur création utilisateur: ${error.message}`);
    }
}

// Lister les utilisateurs
async function listUsers() {
    try {
        log('\n👥 Liste des utilisateurs', 'bright');
        log('═'.repeat(70), 'blue');
        
        const users = await loadUsers();
        
        if (users.length === 0) {
            warning('Aucun utilisateur trouvé');
            return;
        }
        
        console.log('');
        console.table(users.map(user => ({
            'ID': user.id,
            'Nom d\'utilisateur': user.username,
            'Nom complet': user.fullName || user.username,
            'Rôle': user.role,
            'Email': user.email || 'Non défini',
            'Statut': user.active ? '✅ Actif' : '❌ Inactif',
            'Créé le': new Date(user.createdAt).toLocaleDateString('fr-FR'),
            'Dernière connexion': user.lastLogin ? new Date(user.lastLogin).toLocaleDateString('fr-FR') : 'Jamais'
        })));
        
        log(`\nTotal: ${users.length} utilisateurs`, 'green');
        
    } catch (error) {
        error(`Erreur listage utilisateurs: ${error.message}`);
    }
}

// Supprimer un utilisateur
async function deleteUser(username) {
    try {
        if (!username) {
            username = await question('Nom d\'utilisateur à supprimer: ');
        }
        
        const users = await loadUsers();
        const userIndex = users.findIndex(u => u.username === username);
        
        if (userIndex === -1) {
            error(`Utilisateur "${username}" non trouvé`);
            return;
        }
        
        const user = users[userIndex];
        
        // Protéger le dernier admin
        const adminCount = users.filter(u => u.role === 'admin' && u.active).length;
        if (user.role === 'admin' && adminCount <= 1) {
            error('Impossible de supprimer le dernier administrateur');
            return;
        }
        
        // Confirmation
        warning(`Vous êtes sur le point de supprimer l'utilisateur "${username}" (${user.role})`);
        const confirm = await question('Confirmer la suppression? (oui/non): ');
        
        if (confirm.toLowerCase() !== 'oui') {
            info('Suppression annulée');
            return;
        }
        
        users.splice(userIndex, 1);
        await saveUsers(users);
        
        success(`Utilisateur "${username}" supprimé`);
        
    } catch (error) {
        error(`Erreur suppression utilisateur: ${error.message}`);
    }
}

// Réinitialiser un mot de passe
async function resetPassword(username) {
    try {
        if (!username) {
            username = await question('Nom d\'utilisateur: ');
        }
        
        const users = await loadUsers();
        const user = users.find(u => u.username === username);
        
        if (!user) {
            error(`Utilisateur "${username}" non trouvé`);
            return;
        }
        
        const newPassword = await questionPassword('Nouveau mot de passe: ');
        
        if (newPassword.length < 6) {
            error('Le mot de passe doit contenir au moins 6 caractères');
            return;
        }
        
        info('Hachage du nouveau mot de passe...');
        user.password = await bcrypt.hash(newPassword, CONFIG.BCRYPT_ROUNDS);
        user.updatedAt = new Date().toISOString();
        user.updatedBy = 'admin-script';
        
        await saveUsers(users);
        
        success(`Mot de passe réinitialisé pour "${username}"`);
        
    } catch (error) {
        error(`Erreur réinitialisation mot de passe: ${error.message}`);
    }
}

// Créer les utilisateurs par défaut
async function seedUsers() {
    try {
        log('\n🌱 Création des utilisateurs par défaut', 'bright');
        log('═'.repeat(50), 'blue');
        
        const users = await loadUsers();
        
        const defaultUsers = [
            {
                username: 'admin',
                password: 'admin123',
                role: 'admin',
                fullName: 'Administrateur',
                email: 'admin@farm.local'
            },
            {
                username: 'farmer',
                password: 'farmer123',
                role: 'farmer',
                fullName: 'Agriculteur',
                email: 'farmer@farm.local'
            },
            {
                username: 'viewer',
                password: 'viewer123',
                role: 'viewer',
                fullName: 'Observateur',
                email: 'viewer@farm.local'
            }
        ];
        
        let created = 0;
        
        for (const userData of defaultUsers) {
            // Vérifier si l'utilisateur existe déjà
            if (users.find(u => u.username === userData.username)) {
                warning(`Utilisateur "${userData.username}" existe déjà`);
                continue;
            }
            
            const hashedPassword = await bcrypt.hash(userData.password, CONFIG.BCRYPT_ROUNDS);
            
            const newUser = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                username: userData.username,
                password: hashedPassword,
                role: userData.role,
                fullName: userData.fullName,
                email: userData.email,
                active: true,
                createdAt: new Date().toISOString(),
                createdBy: 'seed-script'
            };
            
            users.push(newUser);
            created++;
            info(`Créé: ${userData.username} (${userData.role})`);
        }
        
        if (created > 0) {
            await saveUsers(users);
            success(`${created} utilisateurs par défaut créés`);
            
            log('\n🔑 Comptes créés:', 'yellow');
            defaultUsers.forEach(user => {
                if (!users.find(u => u.username === user.username) || created > 0) {
                    log(`   ${user.username} / ${user.password} (${user.role})`);
                }
            });
            
            warning('\n⚠️  Changez ces mots de passe par défaut en production!');
        } else {
            info('Tous les utilisateurs par défaut existent déjà');
        }
        
    } catch (error) {
        error(`Erreur création utilisateurs par défaut: ${error.message}`);
    }
}

// Mettre à jour un utilisateur
async function updateUser(username) {
    try {
        if (!username) {
            username = await question('Nom d\'utilisateur à modifier: ');
        }
        
        const users = await loadUsers();
        const user = users.find(u => u.username === username);
        
        if (!user) {
            error(`Utilisateur "${username}" non trouvé`);
            return;
        }
        
        log(`\n✏️  Modification de l'utilisateur "${username}"`, 'bright');
        log('═'.repeat(40), 'blue');
        log('Appuyez sur Entrée pour conserver la valeur actuelle\n');
        
        // Nom complet
        const fullName = await question(`Nom complet [${user.fullName}]: `);
        if (fullName) user.fullName = fullName;
        
        // Email
        const email = await question(`Email [${user.email || 'Non défini'}]: `);
        if (email) user.email = email;
        
        // Rôle
        log(`\nRôle actuel: ${user.role}`);
        log('Rôles disponibles: admin, farmer, viewer');
        const role = await question(`Nouveau rôle [${user.role}]: `);
        if (role && ['admin', 'farmer', 'viewer'].includes(role)) {
            // Vérifier qu'on ne retire pas le dernier admin
            if (user.role === 'admin' && role !== 'admin') {
                const adminCount = users.filter(u => u.role === 'admin' && u.active).length;
                if (adminCount <= 1) {
                    error('Impossible de retirer le rôle admin du dernier administrateur');
                    return;
                }
            }
            user.role = role;
        }
        
        // Statut actif/inactif
        const active = await question(`Statut actif [${user.active ? 'oui' : 'non'}]: `);
        if (active.toLowerCase() === 'non' || active.toLowerCase() === 'false') {
            user.active = false;
        } else if (active.toLowerCase() === 'oui' || active.toLowerCase() === 'true') {
            user.active = true;
        }
        
        // Nouveau mot de passe (optionnel)
        const changePassword = await question('Changer le mot de passe? (oui/non): ');
        if (changePassword.toLowerCase() === 'oui') {
            const newPassword = await questionPassword('Nouveau mot de passe: ');
            if (newPassword && newPassword.length >= 6) {
                user.password = await bcrypt.hash(newPassword, CONFIG.BCRYPT_ROUNDS);
                info('Mot de passe mis à jour');
            }
        }
        
        user.updatedAt = new Date().toISOString();
        user.updatedBy = 'admin-script';
        
        await saveUsers(users);
        success(`Utilisateur "${username}" mis à jour`);
        
    } catch (error) {
        error(`Erreur mise à jour utilisateur: ${error.message}`);
    }
}

// ============================================================================
// INTERFACE EN LIGNE DE COMMANDE
// ============================================================================

function showHelp() {
    log('\n👥 Gestionnaire d\'Utilisateurs - Station Agricole', 'bright');
    log('═'.repeat(50), 'blue');
    log('\nUsage: node scripts/create-users.js [commande] [options]');
    log('\nCommandes disponibles:', 'yellow');
    log('  create [--username=X] [--password=X] [--role=X]  Créer un utilisateur');
    log('  list                                             Lister les utilisateurs');
    log('  update [username]                                Modifier un utilisateur');
    log('  delete [username]                                Supprimer un utilisateur');
    log('  reset [username]                                 Réinitialiser mot de passe');
    log('  seed                                             Créer utilisateurs par défaut');
    log('  help                                             Afficher cette aide');
    log('\nExemples:', 'cyan');
    log('  node scripts/create-users.js seed');
    log('  node scripts/create-users.js create --username=john --role=farmer');
    log('  node scripts/create-users.js list');
    log('  node scripts/create-users.js reset admin');
    log('');
}

// Parser les arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    const options = {};
    
    args.slice(1).forEach(arg => {
        if (arg.startsWith('--')) {
            const [key, value] = arg.substring(2).split('=');
            options[key] = value || true;
        } else {
            options.target = arg;
        }
    });
    
    return { command, options };
}

// Main function
async function main() {
    const { command, options } = parseArgs();
    
    try {
        switch (command) {
            case 'create':
                await createUser(options);
                break;
            case 'list':
                await listUsers();
                break;
            case 'update':
                await updateUser(options.target);
                break;
            case 'delete':
                await deleteUser(options.target);
                break;
            case 'reset':
                await resetPassword(options.target);
                break;
            case 'seed':
                await seedUsers();
                break;
            case 'help':
            default:
                showHelp();
                break;
        }
    } catch (error) {
        error(`Erreur d'exécution: ${error.message}`);
        process.exit(1);
    } finally {
        rl.close();
    }
}

// Exécution
if (require.main === module) {
    main();
}

module.exports = {
    createUser,
    listUsers,
    deleteUser,
    resetPassword,
    seedUsers,
    updateUser
};