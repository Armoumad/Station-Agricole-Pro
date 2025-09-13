// ============================================================================
// 🌾 STATION AGRICOLE - SERVEUR FLEXIBLE JSON + NORMAL + RÉSERVOIRS CHIRPSTACK
// ============================================================================
// Support complet pour :
// - Capteurs JSON avec JSONPath (ex: object.temperature_c)
// - Capteurs normaux (valeur simple)
// - Réservoirs avec topics JSON/Normal configurables
// - Format ChirpStack complet (réception)
// - Format ChirpStack simple (envoi)
// - Mode manuel/automatique pour réservoirs
// - QoS MQTT configurable pour tous les topics
// - Timestamps de réception
// - Parsing intelligent des payloads

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const path = require('path');
const fs = require('fs').promises;

// Configuration
const CONFIG = {
    PORT: 3000,
    MQTT_BROKER: 'mqtt://192.168.230.1:1883', // CHANGEZ par l'IP de votre gateway
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
    version: '2.3-chirpstack-complete',
    lastSaved: new Date().toISOString()
};

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let mqttClient = null;

// ============================================================================
// UTILITAIRES JSONPATH ET CHIRPSTACK (AMÉLIORÉS)
// ============================================================================

/**
 * Extrait une valeur d'un objet JSON en utilisant un JSONPath simple
 * Exemples supportés:
 * - "object.temperature_c" 
 * - "data.sensors.temp"
 * - "payload.value"
 * - "sensors[0].temperature"
 * - "data" (pour format base64)
 */
function extractValueFromJSON(jsonObject, jsonPath) {
    if (!jsonPath || !jsonObject) return null;
    
    try {
        // Diviser le path par les points
        const parts = jsonPath.split('.');
        let current = jsonObject;
        
        for (const part of parts) {
            // Supporter les index d'array: sensors[0]
            if (part.includes('[') && part.includes(']')) {
                const arrayName = part.substring(0, part.indexOf('['));
                const index = parseInt(part.substring(part.indexOf('[') + 1, part.indexOf(']')));
                
                if (current[arrayName] && Array.isArray(current[arrayName])) {
                    current = current[arrayName][index];
                } else {
                    return null;
                }
            } else {
                // Propriété normale
                if (current && typeof current === 'object' && current.hasOwnProperty(part)) {
                    current = current[part];
                } else {
                    return null;
                }
            }
        }
        
        return current;
    } catch (error) {
        console.error(`Erreur extraction JSONPath "${jsonPath}":`, error);
        return null;
    }
}

/**
 * Valide qu'un JSONPath est correctement formaté
 */
function validateJSONPath(jsonPath) {
    if (!jsonPath) return true; // Vide = OK
    
    // Regex basique pour valider le format
    const validPattern = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*$/;
    return validPattern.test(jsonPath);
}

/**
 * Crée un payload JSON pour envoyer des commandes vers ChirpStack
 */
function createChirpStackSendPayload(data, confirmed = true, fPort = 1) {
    return JSON.stringify({
        "confirmed": confirmed,
        "data": Buffer.from(data.toString()).toString('base64'),
        "fPort": fPort
    });
}

/**
 * Vérifie si un payload JSON est au format ChirpStack (réception)
 */
function isChirpStackReceiveFormat(jsonData) {
    return jsonData && 
           jsonData.hasOwnProperty('applicationID') &&
           jsonData.hasOwnProperty('deviceName') &&
           jsonData.hasOwnProperty('devEUI') &&
           jsonData.hasOwnProperty('object');
}

/**
 * Vérifie si un payload JSON est au format ChirpStack (envoi)
 */
function isChirpStackSendFormat(jsonData) {
    return jsonData && 
           jsonData.hasOwnProperty('confirmed') &&
           jsonData.hasOwnProperty('data') &&
           jsonData.hasOwnProperty('fPort');
}

// ============================================================================
// MIDDLEWARE ET ROUTES (CONSERVÉES + AMÉLIORÉES)
// ============================================================================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/data', (req, res) => {
    res.json(stationData);
});

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

// POST /api/sensors - CONSERVÉ (déjà optimal)
app.post('/api/sensors', (req, res) => {
    try {
        // Validation JSONPath si payload JSON
        if (req.body.isJsonPayload && req.body.jsonPath) {
            if (!validateJSONPath(req.body.jsonPath)) {
                return res.status(400).json({ 
                    error: 'JSONPath invalide. Format attendu: object.field ou data.sensors[0].temp' 
                });
            }
        }
        
        const sensor = {
            id: Date.now().toString(),
            ...req.body,
            value: 0,
            status: 'offline',
            lastUpdate: new Date(),
            receivedTimestamp: null,
            // Valeurs par défaut pour nouvelles propriétés
            isJsonPayload: req.body.isJsonPayload || false,
            jsonPath: req.body.jsonPath || '',
            jsonFormat: req.body.jsonFormat || 'chirpstack_receive', // 'chirpstack_receive', 'chirpstack_send', 'simple'
            showReceivedTimestamp: req.body.showReceivedTimestamp || false,
            mqttQos: req.body.mqttQos || 1
        };
        
        stationData.sensors.push(sensor);
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        if (!stationData.sensorHistory[sensor.id]) {
            stationData.sensorHistory[sensor.id] = [];
        }
        
        if (mqttClient && mqttClient.connected) {
            // S'abonner avec le QoS spécifié
            mqttClient.subscribe(sensor.topic, { qos: sensor.mqttQos });
            console.log(`📡 Abonné au capteur: ${sensor.topic} (QoS: ${sensor.mqttQos})`);
            
            if (sensor.isJsonPayload) {
                console.log(`🔍 JSONPath configuré: ${sensor.jsonPath} (Format: ${sensor.jsonFormat})`);
            }
        }
        
        io.emit('sensor_added', sensor);
        res.json(sensor);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/sensors/:id - CONSERVÉ
app.put('/api/sensors/:id', (req, res) => {
    try {
        const sensorIndex = stationData.sensors.findIndex(s => s.id === req.params.id);
        if (sensorIndex === -1) {
            return res.status(404).json({ error: 'Capteur non trouvé' });
        }
        
        // Validation JSONPath si payload JSON
        if (req.body.isJsonPayload && req.body.jsonPath) {
            if (!validateJSONPath(req.body.jsonPath)) {
                return res.status(400).json({ 
                    error: 'JSONPath invalide. Format attendu: object.field ou data.sensors[0].temp' 
                });
            }
        }
        
        const oldTopic = stationData.sensors[sensorIndex].topic;
        const oldQos = stationData.sensors[sensorIndex].mqttQos;
        
        stationData.sensors[sensorIndex] = { 
            ...stationData.sensors[sensorIndex], 
            ...req.body,
            lastUpdate: new Date()
        };
        
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        if (mqttClient && mqttClient.connected) {
            // Si topic ou QoS changé, se réabonner
            if (oldTopic !== req.body.topic || oldQos !== req.body.mqttQos) {
                mqttClient.unsubscribe(oldTopic);
                mqttClient.subscribe(req.body.topic, { qos: req.body.mqttQos || 1 });
                console.log(`📡 Réabonné: ${req.body.topic} (QoS: ${req.body.mqttQos || 1})`);
            }
        }
        
        io.emit('sensor_updated', stationData.sensors[sensorIndex]);
        res.json(stationData.sensors[sensorIndex]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
// NOUVELLES API RÉSERVOIRS AVEC SUPPORT JSON CHIRPSTACK COMPLET
// ============================================================================

// POST /api/reservoirs - AMÉLIORÉ POUR CHIRPSTACK
app.post('/api/reservoirs', (req, res) => {
    try {
        // Validations JSONPath pour tous les topics
        const validations = [
            { field: 'isJsonPayloadLevel', pathField: 'jsonPathLevel' },
            { field: 'isJsonPayloadPump', pathField: 'jsonPathPump' },
            { field: 'isJsonPayloadFill', pathField: 'jsonPathFill' },
            { field: 'isJsonPayloadMode', pathField: 'jsonPathMode' }
        ];
        
        for (const validation of validations) {
            if (req.body[validation.field] && req.body[validation.pathField]) {
                if (!validateJSONPath(req.body[validation.pathField])) {
                    return res.status(400).json({ 
                        error: `JSONPath invalide pour ${validation.pathField}. Format attendu: object.field ou data[0].value` 
                    });
                }
            }
        }
        
        const reservoir = {
            id: Date.now().toString(),
            ...req.body,
            
            // États par défaut
            currentLevel: 50,
            pumpStatus: false,
            isAutoMode: true,
            lastUpdate: new Date(),
            receivedTimestamp: null,
            
            // Propriétés JSON par défaut si non spécifiées - Topic Niveau
            isJsonPayloadLevel: req.body.isJsonPayloadLevel || false,
            jsonPathLevel: req.body.jsonPathLevel || '',
            jsonFormatLevel: req.body.jsonFormatLevel || 'chirpstack_receive',
            mqttQosLevel: req.body.mqttQosLevel || 1,
            
            // Topic Pompe
            isJsonPayloadPump: req.body.isJsonPayloadPump || false,
            jsonPathPump: req.body.jsonPathPump || '',
            jsonFormatPump: req.body.jsonFormatPump || 'chirpstack_send',
            mqttQosPump: req.body.mqttQosPump || 1,
            
            // Topic Remplissage
            isJsonPayloadFill: req.body.isJsonPayloadFill || false,
            jsonPathFill: req.body.jsonPathFill || '',
            jsonFormatFill: req.body.jsonFormatFill || 'chirpstack_send',
            mqttQosFill: req.body.mqttQosFill || 1,
            
            // Topic Mode
            isJsonPayloadMode: req.body.isJsonPayloadMode || false,
            jsonPathMode: req.body.jsonPathMode || '',
            jsonFormatMode: req.body.jsonFormatMode || 'chirpstack_send',
            mqttQosMode: req.body.mqttQosMode || 1,
            
            showReceivedTimestamp: req.body.showReceivedTimestamp || false
        };
        
        stationData.reservoirs.push(reservoir);
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        if (!stationData.reservoirHistory[reservoir.id]) {
            stationData.reservoirHistory[reservoir.id] = [];
        }
        
        if (mqttClient && mqttClient.connected) {
            // S'abonner à tous les topics avec leurs QoS respectifs
            mqttClient.subscribe(reservoir.topic, { qos: reservoir.mqttQosLevel });
            console.log(`📡 Abonné niveau réservoir: ${reservoir.topic} (QoS: ${reservoir.mqttQosLevel}, Format: ${reservoir.jsonFormatLevel})`);
            
            if (reservoir.pumpTopic) {
                mqttClient.subscribe(reservoir.pumpTopic, { qos: reservoir.mqttQosPump });
                console.log(`📡 Abonné pompe: ${reservoir.pumpTopic} (QoS: ${reservoir.mqttQosPump}, Format: ${reservoir.jsonFormatPump})`);
            }
            
            if (reservoir.fillTopic) {
                mqttClient.subscribe(reservoir.fillTopic, { qos: reservoir.mqttQosFill });
                console.log(`📡 Abonné remplissage: ${reservoir.fillTopic} (QoS: ${reservoir.mqttQosFill}, Format: ${reservoir.jsonFormatFill})`);
            }
            
            if (reservoir.modeTopic) {
                mqttClient.subscribe(reservoir.modeTopic, { qos: reservoir.mqttQosMode });
                console.log(`📡 Abonné mode: ${reservoir.modeTopic} (QoS: ${reservoir.mqttQosMode}, Format: ${reservoir.jsonFormatMode})`);
            }
        }
        
        io.emit('reservoir_added', reservoir);
        res.json(reservoir);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/reservoirs/:id - AMÉLIORÉ POUR CHIRPSTACK
app.put('/api/reservoirs/:id', (req, res) => {
    try {
        const reservoirIndex = stationData.reservoirs.findIndex(r => r.id === req.params.id);
        if (reservoirIndex === -1) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        // Validations JSONPath pour tous les topics
        const validations = [
            { field: 'isJsonPayloadLevel', pathField: 'jsonPathLevel' },
            { field: 'isJsonPayloadPump', pathField: 'jsonPathPump' },
            { field: 'isJsonPayloadFill', pathField: 'jsonPathFill' },
            { field: 'isJsonPayloadMode', pathField: 'jsonPathMode' }
        ];
        
        for (const validation of validations) {
            if (req.body[validation.field] && req.body[validation.pathField]) {
                if (!validateJSONPath(req.body[validation.pathField])) {
                    return res.status(400).json({ 
                        error: `JSONPath invalide pour ${validation.pathField}` 
                    });
                }
            }
        }
        
        const oldReservoir = stationData.reservoirs[reservoirIndex];
        
        stationData.reservoirs[reservoirIndex] = { 
            ...oldReservoir, 
            ...req.body,
            lastUpdate: new Date()
        };
        
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        if (mqttClient && mqttClient.connected) {
            // Réabonnement si topics ou QoS ont changé
            const topicsToCheck = [
                { oldTopic: oldReservoir.topic, newTopic: req.body.topic, oldQos: oldReservoir.mqttQosLevel, newQos: req.body.mqttQosLevel },
                { oldTopic: oldReservoir.pumpTopic, newTopic: req.body.pumpTopic, oldQos: oldReservoir.mqttQosPump, newQos: req.body.mqttQosPump },
                { oldTopic: oldReservoir.fillTopic, newTopic: req.body.fillTopic, oldQos: oldReservoir.mqttQosFill, newQos: req.body.mqttQosFill },
                { oldTopic: oldReservoir.modeTopic, newTopic: req.body.modeTopic, oldQos: oldReservoir.mqttQosMode, newQos: req.body.mqttQosMode }
            ];
            
            topicsToCheck.forEach(({ oldTopic, newTopic, oldQos, newQos }) => {
                if (oldTopic && (oldTopic !== newTopic || oldQos !== newQos)) {
                    mqttClient.unsubscribe(oldTopic);
                }
                if (newTopic && (oldTopic !== newTopic || oldQos !== newQos)) {
                    mqttClient.subscribe(newTopic, { qos: newQos || 1 });
                    console.log(`📡 Réabonné réservoir: ${newTopic} (QoS: ${newQos || 1})`);
                }
            });
        }
        
        io.emit('reservoir_updated', stationData.reservoirs[reservoirIndex]);
        res.json(stationData.reservoirs[reservoirIndex]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/reservoirs/:id - AMÉLIORÉ
app.delete('/api/reservoirs/:id', (req, res) => {
    try {
        const reservoirIndex = stationData.reservoirs.findIndex(r => r.id === req.params.id);
        if (reservoirIndex === -1) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        const reservoir = stationData.reservoirs[reservoirIndex];
        
        if (mqttClient && mqttClient.connected) {
            // Désabonnement de tous les topics
            mqttClient.unsubscribe(reservoir.topic);
            if (reservoir.pumpTopic) mqttClient.unsubscribe(reservoir.pumpTopic);
            if (reservoir.fillTopic) mqttClient.unsubscribe(reservoir.fillTopic);
            if (reservoir.modeTopic) mqttClient.unsubscribe(reservoir.modeTopic);
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

// POST /api/reservoirs/:id/pump - AMÉLIORÉ CHIRPSTACK
app.post('/api/reservoirs/:id/pump', (req, res) => {
    try {
        const reservoir = stationData.reservoirs.find(r => r.id === req.params.id);
        if (!reservoir) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        if (!reservoir.pumpTopic) {
            return res.status(400).json({ error: 'Aucun topic de pompe configuré' });
        }
        
        const { action } = req.body;
        const newStatus = (action === 'start');
        
        let payload;
        if (reservoir.isJsonPayloadPump) {
            if (reservoir.jsonFormatPump === 'chirpstack_send') {
                // Format ChirpStack envoi
                payload = createChirpStackSendPayload(newStatus ? '1' : '0');
            } else {
                // Format simple
                payload = JSON.stringify({ value: newStatus ? '1' : '0' });
            }
        } else {
            // Format normal
            payload = newStatus ? '1' : '0';
        }
        
        if (mqttClient && mqttClient.connected) {
            mqttClient.publish(reservoir.pumpTopic, payload, { qos: reservoir.mqttQosPump });
            console.log(`🔧 Pompe ${reservoir.name}: ${action} (${payload})`);
        }
        
        reservoir.pumpStatus = newStatus;
        reservoir.lastUpdate = new Date();
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        io.emit('reservoir_pump_changed', {
            id: reservoir.id,
            pumpStatus: reservoir.pumpStatus
        });
        
        res.json({ success: true, pumpStatus: reservoir.pumpStatus });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/reservoirs/:id/fill - AMÉLIORÉ CHIRPSTACK
app.post('/api/reservoirs/:id/fill', (req, res) => {
    try {
        const reservoir = stationData.reservoirs.find(r => r.id === req.params.id);
        if (!reservoir) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        let payload;
        if (reservoir.fillTopic) {
            if (reservoir.isJsonPayloadFill) {
                if (reservoir.jsonFormatFill === 'chirpstack_send') {
                    // Format ChirpStack envoi
                    payload = createChirpStackSendPayload('1');
                } else {
                    // Format simple
                    payload = JSON.stringify({ value: '1' });
                }
            } else {
                // Format normal
                payload = '1';
            }
            
            if (mqttClient && mqttClient.connected) {
                mqttClient.publish(reservoir.fillTopic, payload, { qos: reservoir.mqttQosFill });
                console.log(`🔄 Remplissage ${reservoir.name} (${payload})`);
            }
        } else {
            // Simulation locale si pas de topic
            reservoir.currentLevel = 100;
            reservoir.lastUpdate = new Date();
            stationData.lastSaved = new Date().toISOString();
            saveDataToFile();
            
            io.emit('reservoir_realtime_update', {
                id: reservoir.id,
                level: reservoir.currentLevel,
                timestamp: reservoir.lastUpdate
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/reservoirs/:id/mode - AMÉLIORÉ CHIRPSTACK
app.post('/api/reservoirs/:id/mode', (req, res) => {
    try {
        const reservoir = stationData.reservoirs.find(r => r.id === req.params.id);
        if (!reservoir) {
            return res.status(404).json({ error: 'Réservoir non trouvé' });
        }
        
        const { mode } = req.body; // 'auto' ou 'manual'
        const newAutoMode = (mode === 'auto');
        
        if (reservoir.modeTopic) {
            let payload;
            if (reservoir.isJsonPayloadMode) {
                if (reservoir.jsonFormatMode === 'chirpstack_send') {
                    // Format ChirpStack envoi
                    payload = createChirpStackSendPayload(mode);
                } else {
                    // Format simple
                    payload = JSON.stringify({ mode: mode });
                }
            } else {
                // Format normal
                payload = mode;
            }
            
            if (mqttClient && mqttClient.connected) {
                mqttClient.publish(reservoir.modeTopic, payload, { qos: reservoir.mqttQosMode });
                console.log(`🎛️ Mode ${reservoir.name}: ${mode} (${payload})`);
            }
        }
        
        reservoir.isAutoMode = newAutoMode;
        reservoir.lastUpdate = new Date();
        stationData.lastSaved = new Date().toISOString();
        saveDataToFile();
        
        io.emit('reservoir_mode_changed', {
            id: reservoir.id,
            isAutoMode: reservoir.isAutoMode,
            mode: mode
        });
        
        res.json({ 
            success: true, 
            isAutoMode: reservoir.isAutoMode,
            mode: mode
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// API GRAPHIQUES (CONSERVÉE)
// ============================================================================

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

// API Historique réservoirs
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

// ============================================================================
// CONNEXION MQTT FLEXIBLE POUR CAPTEURS + RÉSERVOIRS CHIRPSTACK
// ============================================================================

function connectMQTT() {
    console.log(`🔌 Connexion au broker MQTT: ${CONFIG.MQTT_BROKER}`);
    
    mqttClient = mqtt.connect(CONFIG.MQTT_BROKER, {
        keepalive: 60,
        reconnectPeriod: 5000,
        clientId: `station_agricole_chirpstack_complete_${Date.now()}`
    });

    mqttClient.on('connect', () => {
        console.log('✅ MQTT Broker connecté');
        console.log('🔧 Mode flexible: ChirpStack + JSON + Normal supportés');
        
        // S'abonner à tous les topics des capteurs avec leur QoS
        const sensorTopicGroups = {};
        
        stationData.sensors.forEach(sensor => {
            const qos = sensor.mqttQos || 1;
            if (!sensorTopicGroups[qos]) {
                sensorTopicGroups[qos] = [];
            }
            sensorTopicGroups[qos].push(sensor.topic);
        });
        
        // S'abonner par groupe de QoS pour capteurs
        Object.keys(sensorTopicGroups).forEach(qos => {
            const topics = sensorTopicGroups[qos];
            topics.forEach(topic => {
                mqttClient.subscribe(topic, { qos: parseInt(qos) });
            });
            console.log(`📡 Capteurs: ${topics.length} topics avec QoS ${qos}`);
        });
        
        // S'abonner aux topics des réservoirs avec leurs QoS respectifs
        stationData.reservoirs.forEach(reservoir => {
            // Topic niveau (obligatoire)
            mqttClient.subscribe(reservoir.topic, { qos: reservoir.mqttQosLevel || 1 });
            console.log(`📡 Réservoir ${reservoir.name} - Niveau: ${reservoir.topic} (QoS: ${reservoir.mqttQosLevel || 1}, Format: ${reservoir.jsonFormatLevel})`);
            
            // Topic pompe (optionnel)
            if (reservoir.pumpTopic) {
                mqttClient.subscribe(reservoir.pumpTopic, { qos: reservoir.mqttQosPump || 1 });
                console.log(`📡 Réservoir ${reservoir.name} - Pompe: ${reservoir.pumpTopic} (QoS: ${reservoir.mqttQosPump || 1}, Format: ${reservoir.jsonFormatPump})`);
            }
            
            // Topic remplissage (optionnel)
            if (reservoir.fillTopic) {
                mqttClient.subscribe(reservoir.fillTopic, { qos: reservoir.mqttQosFill || 1 });
                console.log(`📡 Réservoir ${reservoir.name} - Remplissage: ${reservoir.fillTopic} (QoS: ${reservoir.mqttQosFill || 1}, Format: ${reservoir.jsonFormatFill})`);
            }
            
            // Topic mode (optionnel)
            if (reservoir.modeTopic) {
                mqttClient.subscribe(reservoir.modeTopic, { qos: reservoir.mqttQosMode || 1 });
                console.log(`📡 Réservoir ${reservoir.name} - Mode: ${reservoir.modeTopic} (QoS: ${reservoir.mqttQosMode || 1}, Format: ${reservoir.jsonFormatMode})`);
            }
        });
        
        io.emit('mqtt_status', { connected: true });
    });

    mqttClient.on('message', (topic, message, packet) => {
        try {
            const receivedTimestamp = new Date();
            const messageStr = message.toString();
            
            console.log(`📨 Message reçu sur ${topic}: ${messageStr.substring(0, 100)}${messageStr.length > 100 ? '...' : ''}`);
            
            // Traitement des capteurs (amélioré pour ChirpStack)
            const relatedSensors = stationData.sensors.filter(s => s.topic === topic);
            
            if (relatedSensors.length > 0) {
                relatedSensors.forEach(sensor => {
                    let extractedValue = null;
                    
                    if (sensor.isJsonPayload) {
                        // TRAITEMENT JSON avec JSONPath et formats ChirpStack
                        try {
                            const jsonData = JSON.parse(messageStr);
                            console.log(`🔍 Parsing JSON pour capteur ${sensor.name}:`);
                            console.log(`   Format: ${sensor.jsonFormat}`);
                            console.log(`   JSONPath: ${sensor.jsonPath}`);
                            
                            // Détection automatique du format si non spécifié
                            let actualFormat = sensor.jsonFormat;
                            if (!actualFormat || actualFormat === 'auto') {
                                if (isChirpStackReceiveFormat(jsonData)) {
                                    actualFormat = 'chirpstack_receive';
                                } else if (isChirpStackSendFormat(jsonData)) {
                                    actualFormat = 'chirpstack_send';
                                } else {
                                    actualFormat = 'simple';
                                }
                                console.log(`   Format détecté: ${actualFormat}`);
                            }
                            
                            extractedValue = extractValueFromJSON(jsonData, sensor.jsonPath);
                            console.log(`   Valeur extraite: ${extractedValue}`);
                            
                            if (extractedValue === null || extractedValue === undefined) {
                                console.log(`⚠️ Impossible d'extraire la valeur avec JSONPath: ${sensor.jsonPath}`);
                                return;
                            }
                            
                            // Convertir en nombre si possible
                            if (typeof extractedValue === 'string') {
                                const numValue = parseFloat(extractedValue);
                                if (!isNaN(numValue)) {
                                    extractedValue = numValue;
                                }
                            }
                            
                            if (typeof extractedValue !== 'number') {
                                console.log(`⚠️ Valeur extraite n'est pas numérique: ${extractedValue} (${typeof extractedValue})`);
                                return;
                            }
                            
                        } catch (jsonError) {
                            console.error(`❌ Erreur parsing JSON pour capteur ${sensor.name}:`, jsonError);
                            return;
                        }
                    } else {
                        // TRAITEMENT NORMAL (valeur simple)
                        extractedValue = parseFloat(messageStr);
                        if (isNaN(extractedValue)) {
                            console.log(`⚠️ Valeur non numérique pour capteur normal ${sensor.name}: ${messageStr}`);
                            return;
                        }
                    }
                    
                    // Mettre à jour le capteur avec la valeur extraite
                    console.log(`📊 Mise à jour capteur ${sensor.name}: ${extractedValue} ${sensor.unit}`);
                    handleSensorData(sensor, extractedValue, receivedTimestamp);
                });
                return;
            }
            
            // Traitement des réservoirs (AMÉLIORÉ POUR CHIRPSTACK)
            const relatedReservoirs = stationData.reservoirs.filter(r => 
                r.topic === topic || r.pumpTopic === topic || r.fillTopic === topic || r.modeTopic === topic
            );
            
            if (relatedReservoirs.length > 0) {
                relatedReservoirs.forEach(reservoir => {
                    if (reservoir.topic === topic) {
                        // Topic niveau
                        handleReservoirTopicMessage(reservoir, messageStr, 'level', receivedTimestamp);
                        
                    } else if (reservoir.pumpTopic === topic) {
                        // Topic pompe - état retour
                        handleReservoirTopicMessage(reservoir, messageStr, 'pump', receivedTimestamp);
                        
                    } else if (reservoir.modeTopic === topic) {
                        // Topic mode - manuel/automatique
                        handleReservoirTopicMessage(reservoir, messageStr, 'mode', receivedTimestamp);
                    }
                });
                return;
            }
            
            console.log(`⚠️ Aucun dispositif trouvé pour le topic: ${topic}`);
            
        } catch (error) {
            console.error('❌ Erreur traitement message MQTT:', error);
            console.error(`❌ Topic: ${topic}, Message: ${message.toString()}`);
        }
    });

    mqttClient.on('error', (error) => {
        console.error('❌ Erreur MQTT:', error);
        io.emit('mqtt_status', { connected: false, error: error.message });
    });

    mqttClient.on('reconnect', () => {
        console.log('🔄 Reconnexion MQTT...');
    });
}

// ============================================================================
// NOUVELLE FONCTION DE TRAITEMENT DES MESSAGES RÉSERVOIRS CHIRPSTACK
// ============================================================================

function handleReservoirTopicMessage(reservoir, messageStr, topicType, receivedTimestamp) {
    const topicConfig = {
        level: {
            isJson: reservoir.isJsonPayloadLevel,
            jsonPath: reservoir.jsonPathLevel,
            jsonFormat: reservoir.jsonFormatLevel
        },
        pump: {
            isJson: reservoir.isJsonPayloadPump,
            jsonPath: reservoir.jsonPathPump,
            jsonFormat: reservoir.jsonFormatPump
        },
        mode: {
            isJson: reservoir.isJsonPayloadMode,
            jsonPath: reservoir.jsonPathMode,
            jsonFormat: reservoir.jsonFormatMode
        }
    };
    
    const config = topicConfig[topicType];
    if (!config) return;
    
    let extractedValue = null;
    
    if (config.isJson) {
        try {
            const jsonData = JSON.parse(messageStr);
            console.log(`🔍 Parsing JSON ${topicType} pour réservoir ${reservoir.name}:`);
            console.log(`   Format: ${config.jsonFormat}`);
            console.log(`   JSONPath: ${config.jsonPath}`);
            
            // Détection automatique du format si non spécifié
            let actualFormat = config.jsonFormat;
            if (!actualFormat || actualFormat === 'auto') {
                if (isChirpStackReceiveFormat(jsonData)) {
                    actualFormat = 'chirpstack_receive';
                } else if (isChirpStackSendFormat(jsonData)) {
                    actualFormat = 'chirpstack_send';
                } else {
                    actualFormat = 'simple';
                }
                console.log(`   Format détecté: ${actualFormat}`);
            }
            
            extractedValue = extractValueFromJSON(jsonData, config.jsonPath);
            console.log(`   Valeur extraite: ${extractedValue}`);
            
            if (extractedValue === null || extractedValue === undefined) {
                console.log(`⚠️ Impossible d'extraire la valeur ${topicType} avec JSONPath: ${config.jsonPath}`);
                return;
            }
            
        } catch (error) {
            console.error(`❌ Erreur parsing JSON ${topicType} réservoir ${reservoir.name}:`, error);
            return;
        }
    } else {
        extractedValue = messageStr.trim();
    }
    
    // Traitement selon le type de topic
    switch (topicType) {
        case 'level':
            const levelValue = parseFloat(extractedValue);
            if (!isNaN(levelValue)) {
                console.log(`🫗 Mise à jour niveau ${reservoir.name}: ${levelValue}%`);
                handleReservoirLevelData(reservoir, levelValue, receivedTimestamp);
            }
            break;
            
        case 'pump':
            let pumpStatus;
            if (typeof extractedValue === 'string') {
                pumpStatus = (extractedValue === '1' || extractedValue.toLowerCase() === 'true');
            } else if (typeof extractedValue === 'number') {
                pumpStatus = (extractedValue === 1);
            } else {
                pumpStatus = Boolean(extractedValue);
            }
            console.log(`🔧 État pompe ${reservoir.name}: ${pumpStatus ? 'ON' : 'OFF'}`);
            handleReservoirPumpData(reservoir, pumpStatus, receivedTimestamp);
            break;
            
        case 'mode':
            const isAutoMode = (extractedValue === 'auto' || extractedValue === 'automatic');
            console.log(`🎛️ Mode ${reservoir.name}: ${isAutoMode ? 'AUTOMATIQUE' : 'MANUEL'}`);
            handleReservoirModeData(reservoir, isAutoMode, receivedTimestamp);
            break;
    }
}

// ============================================================================
// TRAITEMENT DES DONNÉES CAPTEURS (CONSERVÉ)
// ============================================================================

function handleSensorData(sensor, value, receivedTimestamp = null) {
    sensor.value = value;
    sensor.lastUpdate = new Date();
    sensor.status = 'online';
    
    // Ajouter timestamp de réception si configuré
    if (receivedTimestamp && sensor.showReceivedTimestamp) {
        sensor.receivedTimestamp = receivedTimestamp;
    }
    
    // Vérification des seuils
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
    
    // Historique
    if (!stationData.sensorHistory[sensor.id]) {
        stationData.sensorHistory[sensor.id] = [];
    }
    
    const historyEntry = {
        timestamp: new Date(),
        value
    };
    
    // Ajouter receivedTimestamp à l'historique si activé
    if (receivedTimestamp && sensor.showReceivedTimestamp) {
        historyEntry.receivedTimestamp = receivedTimestamp;
    }
    
    stationData.sensorHistory[sensor.id].push(historyEntry);
    
    // Garder max 1000 points
    if (stationData.sensorHistory[sensor.id].length > 1000) {
        stationData.sensorHistory[sensor.id].shift();
    }
    
    // Diffusion temps réel
    const updateData = {
        id: sensor.id,
        value,
        status: sensor.status,
        timestamp: sensor.lastUpdate
    };
    
    // Ajouter receivedTimestamp si configuré
    if (receivedTimestamp && sensor.showReceivedTimestamp) {
        updateData.receivedTimestamp = receivedTimestamp;
    }
    
    io.emit('sensor_realtime_update', updateData);
    
    stationData.lastSaved = new Date().toISOString();
    saveDataToFile();
}

// ============================================================================
// FONCTIONS DE TRAITEMENT DES DONNÉES RÉSERVOIRS (CONSERVÉES)
// ============================================================================

function handleReservoirLevelData(reservoir, level, receivedTimestamp = null) {
    reservoir.currentLevel = Math.max(0, Math.min(100, level));
    reservoir.lastUpdate = new Date();
    
    // Ajouter timestamp de réception si configuré
    if (receivedTimestamp && reservoir.showReceivedTimestamp) {
        reservoir.receivedTimestamp = receivedTimestamp;
    }
    
    // Vérification du seuil bas
    if (reservoir.currentLevel <= reservoir.lowThreshold) {
        io.emit('alert', {
            type: 'low_level',
            reservoir: reservoir.name,
            level: reservoir.currentLevel,
            threshold: reservoir.lowThreshold
        });
    }
    
    // Historique
    if (!stationData.reservoirHistory[reservoir.id]) {
        stationData.reservoirHistory[reservoir.id] = [];
    }
    
    const historyEntry = {
        timestamp: new Date(),
        level: reservoir.currentLevel
    };
    
    // Ajouter receivedTimestamp à l'historique si activé
    if (receivedTimestamp && reservoir.showReceivedTimestamp) {
        historyEntry.receivedTimestamp = receivedTimestamp;
    }
    
    stationData.reservoirHistory[reservoir.id].push(historyEntry);
    
    // Garder max 1000 points
    if (stationData.reservoirHistory[reservoir.id].length > 1000) {
        stationData.reservoirHistory[reservoir.id].shift();
    }
    
    // Diffusion temps réel
    const updateData = {
        id: reservoir.id,
        level: reservoir.currentLevel,
        timestamp: reservoir.lastUpdate
    };
    
    // Ajouter receivedTimestamp si configuré
    if (receivedTimestamp && reservoir.showReceivedTimestamp) {
        updateData.receivedTimestamp = receivedTimestamp;
    }
    
    io.emit('reservoir_realtime_update', updateData);
    
    stationData.lastSaved = new Date().toISOString();
    saveDataToFile();
}

function handleReservoirPumpData(reservoir, pumpStatus, receivedTimestamp = null) {
    reservoir.pumpStatus = pumpStatus;
    reservoir.lastUpdate = new Date();
    
    if (receivedTimestamp && reservoir.showReceivedTimestamp) {
        reservoir.receivedTimestamp = receivedTimestamp;
    }
    
    io.emit('reservoir_pump_changed', {
        id: reservoir.id,
        pumpStatus: reservoir.pumpStatus,
        timestamp: reservoir.lastUpdate
    });
    
    stationData.lastSaved = new Date().toISOString();
    saveDataToFile();
}

function handleReservoirModeData(reservoir, isAutoMode, receivedTimestamp = null) {
    reservoir.isAutoMode = isAutoMode;
    reservoir.lastUpdate = new Date();
    
    if (receivedTimestamp && reservoir.showReceivedTimestamp) {
        reservoir.receivedTimestamp = receivedTimestamp;
    }
    
    io.emit('reservoir_mode_changed', {
        id: reservoir.id,
        isAutoMode: reservoir.isAutoMode,
        mode: isAutoMode ? 'auto' : 'manual',
        timestamp: reservoir.lastUpdate
    });
    
    stationData.lastSaved = new Date().toISOString();
    saveDataToFile();
}

// ============================================================================
// FONCTIONS UTILITAIRES (CONSERVÉES)
// ============================================================================

function filterHistoryByPeriod(history, period, maxPoints = 50) {
    const now = new Date();
    let startTime;
    
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
    
    let filteredData = history.filter(record => {
        const recordDate = new Date(record.timestamp);
        return recordDate >= startTime;
    });
    
    if (filteredData.length > maxPoints) {
        const step = Math.ceil(filteredData.length / maxPoints);
        filteredData = filteredData.filter((_, index) => index % step === 0);
    }
    
    return filteredData.map(record => ({
        timestamp: record.timestamp,
        value: record.value !== undefined ? record.value : record.level,
        formattedTime: formatTimeForChart(new Date(record.timestamp), period),
        receivedTimestamp: record.receivedTimestamp || null
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

// ============================================================================
// WEBSOCKET (CONSERVÉ ET AMÉLIORÉ)
// ============================================================================

io.on('connection', (socket) => {
    console.log(`👤 Client connecté: ${socket.id}`);
    
    socket.emit('initial_data', stationData);
    
    socket.on('reservoir_command', (data) => {
        const { reservoirId, command } = data;
        const reservoir = stationData.reservoirs.find(r => r.id === reservoirId);
        
        if (reservoir && mqttClient && mqttClient.connected) {
            if (command === 'pump_toggle' && reservoir.pumpTopic) {
                const newStatus = !reservoir.pumpStatus;
                
                let payload;
                if (reservoir.isJsonPayloadPump) {
                    if (reservoir.jsonFormatPump === 'chirpstack_send') {
                        payload = createChirpStackSendPayload(newStatus ? '1' : '0');
                    } else {
                        payload = JSON.stringify({ value: newStatus ? '1' : '0' });
                    }
                } else {
                    payload = newStatus ? '1' : '0';
                }
                
                mqttClient.publish(reservoir.pumpTopic, payload, { qos: reservoir.mqttQosPump });
                
                reservoir.pumpStatus = newStatus;
                
                io.emit('reservoir_pump_changed', {
                    id: reservoirId,
                    pumpStatus: reservoir.pumpStatus
                });
                
                stationData.lastSaved = new Date().toISOString();
                saveDataToFile();
            }
            
            if (command === 'mode_toggle' && reservoir.modeTopic) {
                const newMode = reservoir.isAutoMode ? 'manual' : 'auto';
                
                let payload;
                if (reservoir.isJsonPayloadMode) {
                    if (reservoir.jsonFormatMode === 'chirpstack_send') {
                        payload = createChirpStackSendPayload(newMode);
                    } else {
                        payload = JSON.stringify({ mode: newMode });
                    }
                } else {
                    payload = newMode;
                }
                
                mqttClient.publish(reservoir.modeTopic, payload, { qos: reservoir.mqttQosMode });
                
                reservoir.isAutoMode = !reservoir.isAutoMode;
                
                io.emit('reservoir_mode_changed', {
                    id: reservoirId,
                    isAutoMode: reservoir.isAutoMode,
                    mode: newMode
                });
                
                stationData.lastSaved = new Date().toISOString();
                saveDataToFile();
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`👤 Client déconnecté: ${socket.id}`);
    });
});

// ============================================================================
// SAUVEGARDE ET DÉMARRAGE (CONSERVÉS ET AMÉLIORÉS)
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
        
        // Migration: ajouter les nouvelles propriétés aux capteurs existants
        stationData.sensors.forEach(sensor => {
            if (typeof sensor.lastUpdate === 'string') {
                sensor.lastUpdate = new Date(sensor.lastUpdate);
            }
            // Ajouter propriétés par défaut si manquantes
            if (sensor.isJsonPayload === undefined) sensor.isJsonPayload = false;
            if (sensor.jsonPath === undefined) sensor.jsonPath = '';
            if (sensor.jsonFormat === undefined) sensor.jsonFormat = 'chirpstack_receive';
            if (sensor.showReceivedTimestamp === undefined) sensor.showReceivedTimestamp = false;
            if (sensor.mqttQos === undefined) sensor.mqttQos = 1;
        });
        
        // Migration: ajouter les nouvelles propriétés aux réservoirs existants
        stationData.reservoirs.forEach(reservoir => {
            if (typeof reservoir.lastUpdate === 'string') {
                reservoir.lastUpdate = new Date(reservoir.lastUpdate);
            }
            
            // Nouvelles propriétés JSON pour réservoirs avec formats ChirpStack
            if (reservoir.isJsonPayloadLevel === undefined) reservoir.isJsonPayloadLevel = false;
            if (reservoir.jsonPathLevel === undefined) reservoir.jsonPathLevel = '';
            if (reservoir.jsonFormatLevel === undefined) reservoir.jsonFormatLevel = 'chirpstack_receive';
            if (reservoir.mqttQosLevel === undefined) reservoir.mqttQosLevel = 1;
            
            if (reservoir.isJsonPayloadPump === undefined) reservoir.isJsonPayloadPump = false;
            if (reservoir.jsonPathPump === undefined) reservoir.jsonPathPump = '';
            if (reservoir.jsonFormatPump === undefined) reservoir.jsonFormatPump = 'chirpstack_send';
            if (reservoir.mqttQosPump === undefined) reservoir.mqttQosPump = 1;
            
            if (reservoir.isJsonPayloadFill === undefined) reservoir.isJsonPayloadFill = false;
            if (reservoir.jsonPathFill === undefined) reservoir.jsonPathFill = '';
            if (reservoir.jsonFormatFill === undefined) reservoir.jsonFormatFill = 'chirpstack_send';
            if (reservoir.mqttQosFill === undefined) reservoir.mqttQosFill = 1;
            
            if (reservoir.isJsonPayloadMode === undefined) reservoir.isJsonPayloadMode = false;
            if (reservoir.jsonPathMode === undefined) reservoir.jsonPathMode = '';
            if (reservoir.jsonFormatMode === undefined) reservoir.jsonFormatMode = 'chirpstack_send';
            if (reservoir.mqttQosMode === undefined) reservoir.mqttQosMode = 1;
            if (reservoir.modeTopic === undefined) reservoir.modeTopic = '';
            
            if (reservoir.isAutoMode === undefined) reservoir.isAutoMode = true;
            if (reservoir.showReceivedTimestamp === undefined) reservoir.showReceivedTimestamp = false;
        });
        
        console.log('📂 Données chargées depuis le fichier');
        console.log(`📊 Capteurs: ${stationData.sensors.length}`);
        console.log(`   JSON: ${stationData.sensors.filter(s => s.isJsonPayload).length}`);
        console.log(`   Normal: ${stationData.sensors.filter(s => !s.isJsonPayload).length}`);
        console.log(`🫗 Réservoirs: ${stationData.reservoirs.length}`);
        
        const jsonReservoirs = stationData.reservoirs.filter(r => 
            r.isJsonPayloadLevel || r.isJsonPayloadPump || r.isJsonPayloadFill || r.isJsonPayloadMode
        ).length;
        console.log(`   Avec JSON: ${jsonReservoirs}`);
        console.log(`   Normal seulement: ${stationData.reservoirs.length - jsonReservoirs}`);
        
    } catch (error) {
        console.log('📂 Aucune donnée existante, démarrage avec données vides');
    }
}

async function startServer() {
    try {
        await loadDataFromFile();
        connectMQTT();
        
        server.listen(CONFIG.PORT, () => {
            console.log('🌾='.repeat(60));
            console.log('🌾 STATION AGRICOLE - CHIRPSTACK + JSON + NORMAL COMPLET');
            console.log('🌾='.repeat(60));
            console.log(`🚀 Serveur démarré sur http://localhost:${CONFIG.PORT}`);
            console.log(`📡 MQTT Broker: ${CONFIG.MQTT_BROKER}`);
            console.log(`📊 Capteurs total: ${stationData.sensors.length}`);
            
            const jsonSensors = stationData.sensors.filter(s => s.isJsonPayload);
            const normalSensors = stationData.sensors.filter(s => !s.isJsonPayload);
            
            console.log(`📊 Capteurs JSON: ${jsonSensors.length}`);
            if (jsonSensors.length > 0) {
                jsonSensors.forEach(s => {
                    console.log(`   📍 ${s.name}: ${s.jsonPath} (Format: ${s.jsonFormat}, QoS: ${s.mqttQos})`);
                });
            }
            
            console.log(`📊 Capteurs normaux: ${normalSensors.length}`);
            
            console.log(`🫗 Réservoirs total: ${stationData.reservoirs.length}`);
            stationData.reservoirs.forEach(r => {
                console.log(`   🫗 ${r.name}:`);
                console.log(`      Niveau: ${r.topic} (${r.isJsonPayloadLevel ? `JSON-${r.jsonFormatLevel}` : 'Normal'}, QoS: ${r.mqttQosLevel})`);
                if (r.pumpTopic) {
                    console.log(`      Pompe: ${r.pumpTopic} (${r.isJsonPayloadPump ? `JSON-${r.jsonFormatPump}` : 'Normal'}, QoS: ${r.mqttQosPump})`);
                }
                if (r.fillTopic) {
                    console.log(`      Remplissage: ${r.fillTopic} (${r.isJsonPayloadFill ? `JSON-${r.jsonFormatFill}` : 'Normal'}, QoS: ${r.mqttQosFill})`);
                }
                if (r.modeTopic) {
                    console.log(`      Mode: ${r.modeTopic} (${r.isJsonPayloadMode ? `JSON-${r.jsonFormatMode}` : 'Normal'}, QoS: ${r.mqttQosMode})`);
                }
                console.log(`      État: ${r.isAutoMode ? 'AUTOMATIQUE' : 'MANUEL'}`);
            });
            
            console.log('🌾='.repeat(60));
            console.log('✅ Prêt à recevoir données ChirpStack, JSON et normales !');
            console.log('📋 Format ChirpStack (Réception): applicationID, deviceName, object, etc.');
            console.log('📋 Format ChirpStack (Envoi): { "confirmed": true, "data": "base64", "fPort": 1 }');
            console.log('🎛️ Modes: Manuel/Automatique supportés');
        });
        
    } catch (error) {
        console.error('❌ Erreur démarrage serveur:', error);
        process.exit(1);
    }
}

// Auto-sauvegarde et arrêt propre
setInterval(() => {
    stationData.lastSaved = new Date().toISOString();
    saveDataToFile();
}, 30000);

process.on('SIGINT', async () => {
    console.log('\n🛑 Arrêt du serveur ChirpStack complet...');
    
    if (mqttClient) {
        mqttClient.end();
    }
    
    await saveDataToFile();
    console.log('💾 Données ChirpStack complètes sauvegardées');
    process.exit(0);
});

startServer();