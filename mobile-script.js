// ===== MOBILE WEBSOCKET & CONTROL SCRIPT =====

// Global State
let ws = null;
let sessionId = null;
let mobileId = null;
let numDados = 2;
let totalRolls = 0;
let shakeSensitivity = 20;
let lastShakeTime = 0;
let isConnected = false;
let currentView = 'sumas';
let eventHistory = [];
let rollHistory = [];

// Acceleration tracking
let lastAcceleration = { x: 0, y: 0, z: 0 };

// Statistics
let statsData = {
    mediaTeor: 0,
    mediaExp: 0,
    stdTeor: 0,
    stdExp: 0,
    varTeor: 0,
    varExp: 0,
    totalTiros: 0,
    sumatoriaSumas: 0,
    sumatoriaCuadradosSumas: 0,
    resultadosCombos: {},
    resultadosSumas: {}
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    initMobile();
});

function initMobile() {
    // Extract session ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    sessionId = urlParams.get('session');

    if (!sessionId) {
        addLog('❌ ERROR: No session ID en URL');
        document.getElementById('sessionId').textContent = 'Sin sesión';
        return;
    }

    mobileId = 'mobile_' + Math.random().toString(36).substr(2, 9);
    document.getElementById('sessionId').textContent = sessionId;

    addLog('📱 Aplicación iniciada');
    addLog('🔄 Session: ' + sessionId);

    // Setup Event Listeners
    setupEventListeners();

    // Setup Shake Detection
    setupShakeDetection();

    // Setup WebSocket
    connectWebSocket();

    // Update UI
    updateUI();
}

function setupEventListeners() {
    // Tab Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.closest('.nav-btn').dataset.tab);
        });
    });

    // Control Tab Buttons
    document.getElementById('btnAddDice').addEventListener('click', addDice);
    document.getElementById('btnRemoveDice').addEventListener('click', removeDice);
    document.getElementById('btnManualRoll').addEventListener('click', manualRoll);
    document.getElementById('btnWeights').addEventListener('click', openWeightsModal);
    document.getElementById('btnClear').addEventListener('click', clearData);

    // Config Tab
    document.getElementById('btnReconnect').addEventListener('click', reconnectWS);
    document.getElementById('btnClearLogs').addEventListener('click', clearLogs);
    document.getElementById('sensitivitySlider').addEventListener('change', (e) => {
        shakeSensitivity = parseInt(e.target.value);
        document.getElementById('sensitivityValue').textContent = shakeSensitivity;
        localStorage.setItem('shakeSensitivity', shakeSensitivity);
        addLog('📊 Sensibilidad: ' + shakeSensitivity);
    });

    // Frequency Tab
    document.querySelectorAll('.freq-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            currentView = e.target.dataset.view;
            document.querySelectorAll('.freq-toggle').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderFrequencyTable();
        });
    });

    // Weights Modal
    document.getElementById('btnApplyWeights').addEventListener('click', applyWeights);
    document.getElementById('btnCloseWeights').addEventListener('click', closeWeightsModal);

    // Prevent default pull-to-refresh on mobile
    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) e.preventDefault();
    }, false);
}

function setupShakeDetection() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        // iOS 13+
        DeviceMotionEvent.requestPermission()
            .then(permission => {
                if (permission === 'granted') {
                    window.addEventListener('devicemotion', onDeviceMotion);
                    addLog('✅ Shake detection: Permisos concedidos');
                }
            })
            .catch(() => {
                window.addEventListener('devicemotion', onDeviceMotion);
                addLog('⚠️ Shake detection: Permisos limitados');
            });
    } else {
        // Android y otros
        window.addEventListener('devicemotion', onDeviceMotion);
        addLog('✅ Shake detection: Activo');
    }
}

function onDeviceMotion(e) {
    const accel = e.acceleration;
    if (!accel) return;

    // Calculate magnitude of acceleration
    const magnitude = Math.sqrt(accel.x ** 2 + accel.y ** 2 + accel.z ** 2);

    // Delta from last reading
    const deltaX = Math.abs(accel.x - lastAcceleration.x);
    const deltaY = Math.abs(accel.y - lastAcceleration.y);
    const deltaZ = Math.abs(accel.z - lastAcceleration.z);
    const deltaMagnitude = Math.sqrt(deltaX ** 2 + deltaY ** 2 + deltaZ ** 2);

    lastAcceleration = { x: accel.x, y: accel.y, z: accel.z };

    // Detect shake (high delta magnitude)
    if (deltaMagnitude > shakeSensitivity && isConnected) {
        const now = Date.now();
        if (now - lastShakeTime > 500) { // Debounce
            lastShakeTime = now;
            shakeDetected();
        }
    }
}

function shakeDetected() {
    addLog('🤳 ¡Shake detectado!');
    vibratePhone(100);

    const shakeIcon = document.getElementById('shakeIcon');
    shakeIcon.style.animation = 'none';
    setTimeout(() => shakeIcon.style.animation = 'bounce 0.5s', 10);

    manualRoll();
}

function vibratePhone(duration) {
    if (navigator.vibrate) {
        navigator.vibrate(duration);
    }
}

// ===== WEBSOCKET MANAGEMENT =====
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    addLog('🔌 Conectando a: ' + wsUrl);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        addLog('✅ WebSocket abierto');
        registerMobile();
    };

    ws.onmessage = (event) => {
        handleMessage(JSON.parse(event.data));
    };

    ws.onerror = (error) => {
        addLog('❌ Error WebSocket: ' + error);
        updateConnectionStatus(false);
    };

    ws.onclose = () => {
        addLog('⚠️ WebSocket cerrado');
        updateConnectionStatus(false);
        // Attempt reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
    };
}

function registerMobile() {
    const msg = {
        type: 'register_mobile',
        session_id: sessionId,
        mobile_id: mobileId,
        num_dados: numDados
    };
    sendMessage(msg);
    addLog('📱 Registrando móvil...');
}

function sendMessage(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    } else {
        addLog('⚠️ WebSocket no conectado');
    }
}

function handleMessage(data) {
    switch (data.type) {
        case 'registration_confirmed':
            addLog('✅ Móvil registrado en hub');
            updateConnectionStatus(true);
            break;

        case 'roll_result':
            handleRollResult(data);
            break;

        case 'stats_update':
            handleStatsUpdate(data);
            break;

        case 'dice_update':
            numDados = data.num_dados;
            updateUI();
            addLog('🎲 Dados actualizado: ' + numDados);
            break;

        case 'clear_confirmation':
            statsData = {
                mediaTeor: 0, mediaExp: 0, stdTeor: 0, stdExp: 0, varTeor: 0, varExp: 0,
                totalTiros: 0, sumatoriaSumas: 0, sumatoriaCuadradosSumas: 0,
                resultadosCombos: {}, resultadosSumas: {}
            };
            rollHistory = [];
            totalRolls = 0;
            updateUI();
            addLog('🗑️ Datos limpiados');
            break;

        default:
            console.log('Mensaje desconocido:', data);
    }
}

function handleRollResult(data) {
    statsData.totalTiros = data.total_tiros || statsData.totalTiros + 1;
    statsData.mediaExp = data.media_exp || 0;
    statsData.mediaTeor = data.media_teor || 0;
    statsData.stdExp = data.std_exp || 0;
    statsData.stdTeor = data.std_teor || 0;
    statsData.varExp = data.var_exp || 0;
    statsData.varTeor = data.var_teor || 0;
    statsData.resultadosSumas = data.resultados_sumas || statsData.resultadosSumas;
    statsData.resultadosCombos = data.resultados_combos || statsData.resultadosCombos;

    totalRolls = statsData.totalTiros;

    if (data.ultimo_resultado) {
        rollHistory.unshift({
            time: new Date().toLocaleTimeString(),
            result: data.ultimo_resultado
        });
        if (rollHistory.length > 5) rollHistory.pop();
    }

    updateUI();
    addLog('🎲 Tirada #' + statsData.totalTiros);
}

function handleStatsUpdate(data) {
    statsData.mediaTeor = data.media_teor || 0;
    statsData.stdTeor = data.std_teor || 0;
    statsData.varTeor = data.var_teor || 0;
    statsData.mediaExp = data.media_exp || 0;
    statsData.stdExp = data.std_exp || 0;
    statsData.varExp = data.var_exp || 0;
    updateUI();
}

function reconnectWS() {
    if (ws) ws.close();
    setTimeout(() => connectWebSocket(), 500);
    addLog('🔄 Reconectando...');
}

// ===== ACTIONS =====
function addDice() {
    if (numDados < 6) {
        numDados++;
        sendMessage({
            type: 'mobile_action',
            action: 'add_dice',
            session_id: sessionId,
            mobile_id: mobileId
        });
        addLog('➕ Dado añadido (total: ' + numDados + ')');
    }
}

function removeDice() {
    if (numDados > 1) {
        numDados--;
        sendMessage({
            type: 'mobile_action',
            action: 'remove_dice',
            session_id: sessionId,
            mobile_id: mobileId
        });
        addLog('➖ Dado eliminado (total: ' + numDados + ')');
    }
}

function manualRoll() {
    sendMessage({
        type: 'mobile_action',
        action: 'roll',
        session_id: sessionId,
        mobile_id: mobileId,
        num_dados: numDados
    });
}

function clearData() {
    if (confirm('¿Limpiar todos los datos?')) {
        sendMessage({
            type: 'mobile_action',
            action: 'clear',
            session_id: sessionId,
            mobile_id: mobileId
        });
    }
}

function applyWeights() {
    const selected = Array.from(document.querySelectorAll('#diceCheckboxes input:checked'))
        .map(cb => parseInt(cb.value));

    if (selected.length === 0) {
        alert('Selecciona al menos un dado');
        return;
    }

    const weights = [];
    for (let i = 0; i < 6; i++) {
        const val = parseFloat(document.getElementById('weight_' + i).value);
        weights.push(isNaN(val) || val < 0 ? 0 : val);
    }

    sendMessage({
        type: 'mobile_action',
        action: 'update_weights',
        session_id: sessionId,
        mobile_id: mobileId,
        dice_indices: selected,
        weights: weights
    });

    addLog('⚖️ Pesos aplicados a dados: ' + selected.join(', '));
    closeWeightsModal();
}

// ===== UI MANAGEMENT =====
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabName).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    addLog('📄 Tab: ' + tabName);
}

function updateUI() {
    document.getElementById('diceCount').textContent = numDados;
    document.getElementById('diceDisplay').textContent = numDados + ' dado' + (numDados > 1 ? 's' : '');
    document.getElementById('totalRolls').textContent = totalRolls.toLocaleString();

    // Stats
    document.getElementById('mediaTeor').textContent = statsData.mediaTeor.toFixed(2);
    document.getElementById('mediaExp').textContent = statsData.mediaExp.toFixed(2);
    document.getElementById('stdTeor').textContent = statsData.stdTeor.toFixed(2);
    document.getElementById('stdExp').textContent = statsData.stdExp.toFixed(2);
    document.getElementById('varTeor').textContent = statsData.varTeor.toFixed(2);
    document.getElementById('varExp').textContent = statsData.varExp.toFixed(2);

    // Results List
    const resultsList = document.getElementById('resultsList');
    if (rollHistory.length === 0) {
        resultsList.innerHTML = '<div class="result-item">Esperando tiros...</div>';
    } else {
        resultsList.innerHTML = rollHistory
            .map(r => `<div class="result-item"><strong>${r.time}</strong> → ${r.result}</div>`)
            .join('');
    }

    renderFrequencyTable();
}

function renderFrequencyTable() {
    const data = currentView === 'sumas' ? statsData.resultadosSumas : statsData.resultadosCombos;
    const tbody = document.getElementById('freqTableBody');

    let items = Object.entries(data).map(([label, f]) => ({
        label,
        f,
        fr: f / (statsData.totalTiros || 1),
        percent: (f / (statsData.totalTiros || 1)) * 100
    }));

    if (currentView === 'sumas') {
        items.sort((a, b) => parseInt(a.label) - parseInt(b.label));
    } else {
        items.sort((a, b) => b.f - a.f);
    }

    items = items.slice(0, 20);

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #999;">Sin datos</td></tr>';
        return;
    }

    tbody.innerHTML = items
        .map(item => `
            <tr>
                <td><strong>${item.label}</strong></td>
                <td>${item.f}</td>
                <td>${item.percent.toFixed(1)}%</td>
            </tr>
        `)
        .join('');
}

function updateConnectionStatus(connected) {
    isConnected = connected;
    const badge = document.getElementById('connectionBadge');
    const status = document.getElementById('statusText');

    if (connected) {
        badge.textContent = '✅ Conectado';
        badge.classList.add('connected');
        status.textContent = '✅ Conectado al Hub';
        status.classList.add('connected');
    } else {
        badge.textContent = '❌ Desconectado';
        badge.classList.remove('connected');
        status.textContent = '❌ Desconectado';
        status.classList.remove('connected');
    }
}

// ===== MODALS =====
function openWeightsModal() {
    const modal = document.getElementById('weightsModal');
    const checkboxesContainer = document.getElementById('diceCheckboxes');

    checkboxesContainer.innerHTML = '';
    for (let i = 0; i < numDados; i++) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = i;
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode('Dado ' + (i + 1)));
        checkboxesContainer.appendChild(label);
    }

    modal.style.display = 'flex';
}

function closeWeightsModal() {
    document.getElementById('weightsModal').style.display = 'none';
}

// ===== LOGGING =====
function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    eventHistory.unshift({ time: timestamp, message });
    if (eventHistory.length > 20) eventHistory.pop();

    const logContainer = document.getElementById('eventLog');
    logContainer.innerHTML = eventHistory
        .map(log => `<div class="result-item"><small>${log.time}</small> ${log.message}</div>`)
        .join('');
}

function clearLogs() {
    eventHistory = [];
    document.getElementById('eventLog').innerHTML = '<div class="result-item">Logs limpiados</div>';
}

// ===== INITIALIZATION =====
window.addEventListener('load', () => {
    const saved = localStorage.getItem('shakeSensitivity');
    if (saved) {
        shakeSensitivity = parseInt(saved);
        document.getElementById('sensitivitySlider').value = shakeSensitivity;
        document.getElementById('sensitivityValue').textContent = shakeSensitivity;
    }
});

// Handle modal clicks outside
document.getElementById('weightsModal').addEventListener('click', (e) => {
    if (e.target.id === 'weightsModal') closeWeightsModal();
});
