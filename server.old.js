// ============================================================================
// 🌾 STATION AGRICOLE - SERVEUR NODE.JS + API GRAPHIQUES
// ============================================================================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const path = require('path');
const fs = require('fs').promises;

// Configuration
const CONFIG = {
    PORT: 3000,
    MQTT_BROKER: 'mqtt://localhost:1883',
    DATA_FILE: './data/station_data.json'
};

// Données en mémoire
let stationData = {
    sensors: [],
    reservoirs: [],
    sensorHistory: {},
    reservoirHistory: {},
    config: {
        mqttServer: CONFIG.MQTT_BROKER,
        baseTopic: 'agriculture/',
        updateInterval: 5000
    },
    version: '2.0',
    lastSaved: new Date().toISOString()
};

// Initialisation Express et Socket.io
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Client MQTT
let mqttClient = null;

// ============================================================================
// MIDDLEWARE ET ROUTES
// ============================================================================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// API REST ORIGINALE (CONSERVÉE)
// ============================================================================

// GET /api/data - Récupérer toutes les données
app.get('/api/data', (req, res) => {
    res.json(stationData);
});

// POST /api/data - Sauvegarder toutes les données
app.post('/api/data', (req, res) => {
    try {
        stationData = {
            ...stationData,
            ...req.body,
            lastSaved: new Date().toISOString()
        };
        
        saveDataToFile();
        io.emit('data_updated', stationData);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/sensors - Ajouter un capteur
app.post('/api/sensors', (req, res) => {
    try {
        const sensor = {
            id: Date.now().toString(),
            ...req.body,
            value: 0,
            status: 'offline',
            lastUpdate: new Date()
        };
        
        stationData.sensors.push(sensor);
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        // Initialiser l'historique du capteur
        if (!stationData.sensorHistory[sensor.id]) {
            stationData.sensorHistory[sensor.id] = [];
        }
        
        if (mqttClient && mqttClient.connected) {
            mqttClient.subscribe(sensor.topic);
            console.log(`📡 Abonné au capteur: ${sensor.topic}`);
        }
        
        io.emit('sensor_added', sensor);
        res.json(sensor);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/sensors/:id - Modifier un capteur
app.put('/api/sensors/:id', (req, res) => {
    try {
        const sensorIndex = stationData.sensors.findIndex(s => s.id === req.params.id);
        if (sensorIndex === -1) {
            return res.status(404).json({ error: 'Capteur non trouvé' });
        }
        
        const oldTopic = stationData.sensors[sensorIndex].topic;
        stationData.sensors[sensorIndex] = { 
            ...stationData.sensors[sensorIndex], 
            ...req.body,
            lastUpdate: new Date()
        };
        
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        if (oldTopic !== req.body.topic && mqttClient && mqttClient.connected) {
            mqttClient.unsubscribe(oldTopic);
            mqttClient.subscribe(req.body.topic);
        }
        
        io.emit('sensor_updated', stationData.sensors[sensorIndex]);
        res.json(stationData.sensors[sensorIndex]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/sensors/:id - Supprimer un capteur
app.delete('/api/sensors/:id', (req, res) => {
    try {
        const sensorIndex = stationData.sensors.findIndex(s => s.id === req.params.id);
        if (sensorIndex === -1) {
            return res.status(404).json({ error: 'Capteur non trouvé' });
        }
        
        const sensor = stationData.sensors[sensorIndex];
        
        if (mqttClient && mqttClient.connected) {
            mqttClient.unsubscribe(sensor.topic);
        }
        
        stationData.sensors.splice(sensorIndex, 1);
        delete stationData.sensorHistory[req.params.id];
        
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        io.emit('sensor_deleted', req.params.id);
        
        res.json({ message: 'Capteur supprimé' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// NOUVELLES API POUR GRAPHIQUES
// ============================================================================

// GET /api/sensors/:id/history - Historique d'un capteur avec périodes
app.get('/api/sensors/:id/history', (req, res) => {
    try {
        const { period = '1h', points = 50 } = req.query;
        const sensor = stationData.sensors.find(s => s.id === req.params.id);
        
        if (!sensor) {
            return res.status(404).json({ error: 'Capteur non trouvé' });
        }

        const history = stationData.sensorHistory[req.params.id] || [];
        const filteredHistory = filterHistoryByPeriod(history, period, parseInt(points));
        
        res.json({
            sensor: {
                id: sensor.id,
                name: sensor.name,
                type: sensor.type,
                unit: sensor.unit,
                color: sensor.color
            },
            data: filteredHistory,
            period,
            totalPoints: history.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/reservoirs/:id/history - Historique d'un réservoir
app.get('/api/reservoirs/:id/history', (req, res) => {
    try {
        const { period = '1h', points = 50 } = req.query;
        const reservoir = stationData.reservoirs.find(r => r.id === req.params.id);
        
        if (!reservoir) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }

        const history = stationData.reservoirHistory[req.params.id] || [];
        const filteredHistory = filterHistoryByPeriod(history, period, parseInt(points));
        
        res.json({
            reservoir: {
                id: reservoir.id,
                name: reservoir.name,
                capacity: reservoir.capacity,
                color: reservoir.color
            },
            data: filteredHistory,
            period,
            totalPoints: history.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/charts/sensors/compare - Comparer plusieurs capteurs
app.get('/api/charts/sensors/compare', (req, res) => {
    try {
        const { ids, period = '1h', points = 50 } = req.query;
        const sensorIds = ids.split(',');
        
        const compareData = sensorIds.map(id => {
            const sensor = stationData.sensors.find(s => s.id === id);
            if (!sensor) return null;
            
            const history = stationData.sensorHistory[id] || [];
            const filteredHistory = filterHistoryByPeriod(history, period, parseInt(points));
            
            return {
                sensor: {
                    id: sensor.id,
                    name: sensor.name,
                    type: sensor.type,
                    unit: sensor.unit,
                    color: sensor.color
                },
                data: filteredHistory
            };
        }).filter(Boolean);
        
        res.json({
            sensors: compareData,
            period,
            points: parseInt(points)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/charts/overview - Vue d'ensemble tous capteurs
app.get('/api/charts/overview', (req, res) => {
    try {
        const { period = '1h' } = req.query;
        
        const overview = {
            sensors: stationData.sensors.map(sensor => {
                const history = stationData.sensorHistory[sensor.id] || [];
                const recentHistory = filterHistoryByPeriod(history, period, 10);
                
                return {
                    id: sensor.id,
                    name: sensor.name,
                    type: sensor.type,
                    unit: sensor.unit,
                    color: sensor.color,
                    currentValue: sensor.value,
                    status: sensor.status,
                    trend: calculateTrend(recentHistory),
                    lastPoints: recentHistory.slice(-5)
                };
            }),
            reservoirs: stationData.reservoirs.map(reservoir => {
                const history = stationData.reservoirHistory[reservoir.id] || [];
                const recentHistory = filterHistoryByPeriod(history, period, 10);
                
                return {
                    id: reservoir.id,
                    name: reservoir.name,
                    color: reservoir.color,
                    currentLevel: reservoir.currentLevel,
                    capacity: reservoir.capacity,
                    trend: calculateTrend(recentHistory),
                    lastPoints: recentHistory.slice(-5)
                };
            }),
            period,
            timestamp: new Date()
        };
        
        res.json(overview);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// FONCTIONS UTILITAIRES POUR GRAPHIQUES
// ============================================================================

function filterHistoryByPeriod(history, period, maxPoints = 50) {
    const now = new Date();
    let startTime;
    
    // Définir la période de temps
    switch (period) {
        case '10m':
            startTime = new Date(now.getTime() - 10 * 60 * 1000);
            break;
        case '1h':
            startTime = new Date(now.getTime() - 60 * 60 * 1000);
            break;
        case '6h':
            startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            break;
        case '24h':
            startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
        case '7d':
            startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case '30d':
            startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        default:
            startTime = new Date(now.getTime() - 60 * 60 * 1000);
    }
    
    // Filtrer par période
    let filteredData = history.filter(record => {
        const recordDate = new Date(record.timestamp);
        return recordDate >= startTime;
    });
    
    // Réduire le nombre de points si nécessaire
    if (filteredData.length > maxPoints) {
        const step = Math.ceil(filteredData.length / maxPoints);
        filteredData = filteredData.filter((_, index) => index % step === 0);
    }
    
    // Ajouter des métadonnées utiles
    return filteredData.map(record => ({
        timestamp: record.timestamp,
        value: record.value !== undefined ? record.value : record.level,
        formattedTime: formatTimeForChart(new Date(record.timestamp), period)
    }));
}

function formatTimeForChart(date, period) {
    switch (period) {
        case '10m':
        case '1h':
            return date.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
            });
        case '6h':
        case '24h':
            return date.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit'
            });
        case '7d':
            return date.toLocaleDateString('fr-FR', { 
                weekday: 'short',
                hour: '2-digit'
            });
        case '30d':
            return date.toLocaleDateString('fr-FR', { 
                day: '2-digit',
                month: 'short'
            });
        default:
            return date.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit'
            });
    }
}

function calculateTrend(history) {
    if (history.length < 2) return 'stable';
    
    const recent = history.slice(-5);
    const first = recent[0]?.value || recent[0]?.level;
    const last = recent[recent.length - 1]?.value || recent[recent.length - 1]?.level;
    
    if (last > first * 1.05) return 'up';
    if (last < first * 0.95) return 'down';
    return 'stable';
}

// ============================================================================
// ROUTES RÉSERVOIRS (CONSERVÉES)
// ============================================================================

app.post('/api/reservoirs', (req, res) => {
    try {
        const reservoir = {
            id: Date.now().toString(),
            ...req.body,
            currentLevel: 50,
            pumpStatus: false,
            lastUpdate: new Date()
        };
        
        stationData.reservoirs.push(reservoir);
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        // Initialiser l'historique du réservoir
        if (!stationData.reservoirHistory[reservoir.id]) {
            stationData.reservoirHistory[reservoir.id] = [];
        }
        
        if (mqttClient && mqttClient.connected) {
            mqttClient.subscribe(reservoir.topic);
            if (reservoir.pumpTopic) mqttClient.subscribe(reservoir.pumpTopic);
            if (reservoir.fillTopic) mqttClient.subscribe(reservoir.fillTopic);
        }
        
        io.emit('reservoir_added', reservoir);
        res.json(reservoir);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/reservoirs/:id', (req, res) => {
    try {
        const reservoirIndex = stationData.reservoirs.findIndex(r => r.id === req.params.id);
        if (reservoirIndex === -1) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        stationData.reservoirs[reservoirIndex] = { 
            ...stationData.reservoirs[reservoirIndex], 
            ...req.body,
            lastUpdate: new Date()
        };
        
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        io.emit('reservoir_updated', stationData.reservoirs[reservoirIndex]);
        res.json(stationData.reservoirs[reservoirIndex]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/reservoirs/:id', (req, res) => {
    try {
        const reservoirIndex = stationData.reservoirs.findIndex(r => r.id === req.params.id);
        if (reservoirIndex === -1) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        const reservoir = stationData.reservoirs[reservoirIndex];
        
        if (mqttClient && mqttClient.connected) {
            mqttClient.unsubscribe(reservoir.topic);
            if (reservoir.pumpTopic) mqttClient.unsubscribe(reservoir.pumpTopic);
            if (reservoir.fillTopic) mqttClient.unsubscribe(reservoir.fillTopic);
        }
        
        stationData.reservoirs.splice(reservoirIndex, 1);
        delete stationData.reservoirHistory[req.params.id];
        
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        io.emit('reservoir_deleted', req.params.id);
        
        res.json({ message: 'Réservoir supprimé' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reservoirs/:id/pump', (req, res) => {
    try {
        const reservoir = stationData.reservoirs.find(r => r.id === req.params.id);
        if (!reservoir) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        const { action } = req.body;
        reservoir.pumpStatus = (action === 'start');
        reservoir.lastUpdate = new Date();
        
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        if (mqttClient && mqttClient.connected && reservoir.pumpTopic) {
            mqttClient.publish(reservoir.pumpTopic, reservoir.pumpStatus ? '1' : '0');
            console.log(`🔧 Pompe ${reservoir.name}: ${action}`);
        }
        
        io.emit('reservoir_pump_changed', {
            id: reservoir.id,
            pumpStatus: reservoir.pumpStatus
        });
        
        res.json({ success: true, pumpStatus: reservoir.pumpStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reservoirs/:id/fill', (req, res) => {
    try {
        const reservoir = stationData.reservoirs.find(r => r.id === req.params.id);
        if (!reservoir) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        if (mqttClient && mqttClient.connected && reservoir.fillTopic) {
            mqttClient.publish(reservoir.fillTopic, '1');
            console.log(`🔄 Remplissage ${reservoir.name} via MQTT`);
        } else {
            reservoir.currentLevel = 100;
            reservoir.lastUpdate = new Date();
            stationData.lastSaved = new Date().toISOString();
            saveDataToFile();
            
            io.emit('reservoir_level_changed', {
                id: reservoir.id,
                level: reservoir.currentLevel
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// SERVICE MQTT (CONSERVÉ AVEC HISTORIQUE ÉTENDU)
// ============================================================================

function connectMQTT() {
    console.log(`🔌 Connexion au broker MQTT: ${CONFIG.MQTT_BROKER}`);
    
    mqttClient = mqtt.connect(CONFIG.MQTT_BROKER, {
        keepalive: 60,
        reconnectPeriod: 5000,
        clientId: `station_agricole_${Date.now()}`
    });

    mqttClient.on('connect', () => {
        console.log('✅ MQTT Broker connecté');
        
        stationData.sensors.forEach(sensor => {
            mqttClient.subscribe(sensor.topic);
        });
        
        stationData.reservoirs.forEach(reservoir => {
            mqttClient.subscribe(reservoir.topic);
            if (reservoir.pumpTopic) mqttClient.subscribe(reservoir.pumpTopic);
        });
        
        io.emit('mqtt_status', { connected: true });
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const value = parseFloat(message.toString());
            if (isNaN(value)) return;
            
            const sensor = stationData.sensors.find(s => s.topic === topic);
            if (sensor) {
                handleSensorData(sensor, value);
                return;
            }
            
            const reservoir = stationData.reservoirs.find(r => r.topic === topic);
            if (reservoir) {
                handleReservoirData(reservoir, value);
                return;
            }
            
        } catch (error) {
            console.error('Erreur traitement message MQTT:', error);
        }
    });

    mqttClient.on('error', (error) => {
        console.error('❌ Erreur MQTT:', error);
        io.emit('mqtt_status', { connected: false, error: error.message });
    });
}

function handleSensorData(sensor, value) {
    sensor.value = value;
    sensor.lastUpdate = new Date();
    sensor.status = 'online';
    
    if (sensor.minValue !== null && value < sensor.minValue) {
        sensor.status = 'warning';
        io.emit('alert', {
            type: 'low_threshold',
            sensor: sensor.name,
            value,
            threshold: sensor.minValue
        });
    } else if (sensor.maxValue !== null && value > sensor.maxValue) {
        sensor.status = 'warning';
        io.emit('alert', {
            type: 'high_threshold',
            sensor: sensor.name,
            value,
            threshold: sensor.maxValue
        });
    }
    
    // Historique étendu pour graphiques
    if (!stationData.sensorHistory[sensor.id]) {
        stationData.sensorHistory[sensor.id] = [];
    }
    
    stationData.sensorHistory[sensor.id].push({
        timestamp: new Date(),
        value
    });
    
    // Garder plus d'historique pour les graphiques (1000 points au lieu de 100)
    if (stationData.sensorHistory[sensor.id].length > 1000) {
        stationData.sensorHistory[sensor.id].shift();
    }
    
    io.emit('sensor_realtime_update', {
        id: sensor.id,
        value,
        status: sensor.status,
        timestamp: sensor.lastUpdate
    });
    
    stationData.lastSaved = new Date().toISOString();
    saveDataToFile();
}

function handleReservoirData(reservoir, level) {
    reservoir.currentLevel = Math.max(0, Math.min(100, level));
    reservoir.lastUpdate = new Date();
    
    if (reservoir.currentLevel <= reservoir.lowThreshold) {
        io.emit('alert', {
            type: 'low_level',
            reservoir: reservoir.name,
            level: reservoir.currentLevel,
            threshold: reservoir.lowThreshold
        });
    }
    
    // Historique étendu pour graphiques
    if (!stationData.reservoirHistory[reservoir.id]) {
        stationData.reservoirHistory[reservoir.id] = [];
    }
    
    stationData.reservoirHistory[reservoir.id].push({
        timestamp: new Date(),
        level: reservoir.currentLevel
    });
    
    if (stationData.reservoirHistory[reservoir.id].length > 1000) {
        stationData.reservoirHistory[reservoir.id].shift();
    }
    
    io.emit('reservoir_realtime_update', {
        id: reservoir.id,
        level: reservoir.currentLevel,
        timestamp: reservoir.lastUpdate
    });
    
    stationData.lastSaved = new Date().toISOString();
    saveDataToFile();
}

// ============================================================================
// WEBSOCKET (CONSERVÉ)
// ============================================================================

io.on('connection', (socket) => {
    console.log(`👤 Client connecté: ${socket.id}`);
    
    socket.emit('initial_data', stationData);
    
    socket.on('reservoir_command', (data) => {
        const { reservoirId, command } = data;
        const reservoir = stationData.reservoirs.find(r => r.id === reservoirId);
        
        if (reservoir && mqttClient && mqttClient.connected) {
            if (command === 'pump_toggle' && reservoir.pumpTopic) {
                reservoir.pumpStatus = !reservoir.pumpStatus;
                mqttClient.publish(reservoir.pumpTopic, reservoir.pumpStatus ? '1' : '0');
                
                io.emit('reservoir_pump_changed', {
                    id: reservoirId,
                    pumpStatus: reservoir.pumpStatus
                });
                
                stationData.lastSaved = new Date().toISOString();
                saveDataToFile();
            }
            
            if (command === 'fill' && reservoir.fillTopic) {
                mqttClient.publish(reservoir.fillTopic, '1');
                
                io.emit('notification', {
                    type: 'success',
                    message: `Remplissage ${reservoir.name} démarré`
                });
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`👤 Client déconnecté: ${socket.id}`);
    });
});

// ============================================================================
// SAUVEGARDE ET DÉMARRAGE (CONSERVÉS)
// ============================================================================

async function saveDataToFile() {
    try {
        await fs.mkdir('./data', { recursive: true });
        await fs.writeFile(CONFIG.DATA_FILE, JSON.stringify(stationData, null, 2));
    } catch (error) {
        console.error('Erreur sauvegarde:', error);
    }
}

async function loadDataFromFile() {
    try {
        const data = await fs.readFile(CONFIG.DATA_FILE, 'utf8');
        const loadedData = JSON.parse(data);
        
        stationData = {
            ...stationData,
            ...loadedData
        };
        
        stationData.sensors.forEach(sensor => {
            if (typeof sensor.lastUpdate === 'string') {
                sensor.lastUpdate = new Date(sensor.lastUpdate);
            }
        });
        
        stationData.reservoirs.forEach(reservoir => {
            if (typeof reservoir.lastUpdate === 'string') {
                reservoir.lastUpdate = new Date(reservoir.lastUpdate);
            }
        });
        
        console.log('📂 Données chargées depuis le fichier');
        console.log(`📊 Capteurs: ${stationData.sensors.length}, Réservoirs: ${stationData.reservoirs.length}`);
    } catch (error) {
        console.log('📂 Aucune donnée existante, démarrage avec données vides');
    }
}

function startDataSimulation() {
    setInterval(() => {
        stationData.sensors.forEach(sensor => {
            if (sensor.status === 'offline') {
                const newValue = generateSimulatedValue(sensor);
                handleSensorData(sensor, newValue);
            }
        });

        stationData.reservoirs.forEach(reservoir => {
            if (Math.random() < 0.3) {
                const change = (Math.random() - 0.5) * 3;
                const newLevel = Math.max(0, Math.min(100, 
                    reservoir.currentLevel + change));
                handleReservoirData(reservoir, newLevel);
            }
        });
    }, stationData.config.updateInterval || 5000);
}

function generateSimulatedValue(sensor) {
    const baseValues = {
        temperature: 20 + Math.random() * 15,
        humidity: 40 + Math.random() * 40,
        light: 200 + Math.random() * 800,
        ph: 6 + Math.random() * 2,
        moisture: 30 + Math.random() * 50,
        wind: Math.random() * 25,
        rain: Math.random() * 10,
        pressure: 1000 + Math.random() * 50,
        co2: 400 + Math.random() * 200,
        nutrition: 1.2 + Math.random() * 0.8,
        custom: Math.random() * 100
    };
    
    return +(baseValues[sensor.type] || Math.random() * 100).toFixed(1);
}

async function startServer() {
    try {
        await loadDataFromFile();
        connectMQTT();
        startDataSimulation();
        
        server.listen(CONFIG.PORT, () => {
            console.log('🌾='.repeat(50));
            console.log('🌾 STATION AGRICOLE PROFESSIONNELLE + GRAPHIQUES');
            console.log('🌾='.repeat(50));
            console.log(`🚀 Serveur démarré sur http://localhost:${CONFIG.PORT}`);
            console.log(`📡 MQTT Broker: ${CONFIG.MQTT_BROKER}`);
            console.log(`📊 Capteurs: ${stationData.sensors.length}`);
            console.log(`🫗 Réservoirs: ${stationData.reservoirs.length}`);
            console.log(`📈 API Graphiques: Activée`);
            console.log('🌾='.repeat(50));
        });
        
    } catch (error) {
        console.error('❌ Erreur démarrage serveur:', error);
        process.exit(1);
    }
}

setInterval(() => {
    stationData.lastSaved = new Date().toISOString();
    saveDataToFile();
}, 30000);

process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt du serveur...');
    
    if (mqttClient) {
        mqttClient.end();
    }
    
    await saveDataToFile();
    console.log('💾 Données sauvegardées');
    process.exit(0);
});

startServer();