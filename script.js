// --- ESTADO GLOBAL ---
let ws = null;
let sessionId = null;
let cantidadCelularesConectados = 0;

let dados = []; // Array de objetos { faces: int, weights: array }
let totalTiros = 0;
let sumatoriaSumas = 0;
let sumatoriaCuadradosSumas = 0;
let resultadosCombos = {};
let resultadosSumas = {};
let vistaActual = 'sumas';

let teoMediaTotal = 0;
let teoVarTotal = 0;

let chartHist = null;
let chartCDF = null;

// --- INICIALIZACION ---
document.addEventListener('DOMContentLoaded', () => {
    generarIdentificadorSesion();
    generarCodigoQR();
    initCharts();
    
    // Iniciar mesa con un D6 por defecto
    agregarDado(6); 
    
    // Eventos UI
    document.getElementById('btnToggleSidebar').onclick = toggleSidebar;
    document.getElementById('btnConnectHub').onclick = conectarHubWebSocket;
    document.getElementById('btnPcRoll').onclick = lanzarDadosMesa;
    
    // Acciones de gestión de dados
    document.getElementById('btnAddDice').onclick = () => {
        let faces = parseInt(document.getElementById('diceTypeSelect').value) || 6;
        if (dados.length < 10) { 
            agregarDado(faces); 
            syncHaciaCelular({ type: 'dice_update', num_dados: dados.length }); 
        } else {
            alert("Limite maximo de 10 dados alcanzado.");
        }
    };
    
    document.getElementById('btnRemoveDice').onclick = () => {
        if (dados.length > 1) { 
            dados.pop(); 
            inicializarMesaDados(); 
            syncHaciaCelular({ type: 'dice_update', num_dados: dados.length }); 
        }
    };
    
    document.getElementById('btnPcClear').onclick = () => {
        if (confirm('¿Vaciar todo el historial de simulacion acumulado?')) ejecutarLimpiezaAbsoluta();
    };

    document.getElementById('btnPcWeights').onclick = abrirModalPesos;
    document.getElementById('btnPcCloseWeights').onclick = cerrarModalPesos;
    document.getElementById('btnPcApplyWeights').onclick = aplicarPesosYSimularMasivo;
    
    document.getElementById('btnViewSumas').onclick = () => cambiarVistaAnalitica('sumas');
    document.getElementById('btnViewCombos').onclick = () => cambiarVistaAnalitica('combos');
    document.getElementById('btnApplyFilter').onclick = actualizarUIEstadisticasYGraficos;

    // Navegacion de Pestanas
    const tabsMap = { 'btnTabSim': 'tab-sim', 'btnTabFreq': 'tab-freq', 'btnTabStats': 'tab-stats', 'btnTabAcum': 'tab-acum' };
    Object.keys(tabsMap).forEach(btnId => {
        document.getElementById(btnId).onclick = (e) => {
            document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(tabsMap[btnId]).classList.add('active');
            e.currentTarget.classList.add('active');
            syncHaciaCelular({ type: 'tab_sync', tab_id: tabsMap[btnId] });
        };
    });
});

// --- FUNCIONES AUXILIARES ---
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('btnToggleSidebar');
    sidebar.classList.toggle('collapsed');
    btn.textContent = sidebar.classList.contains('collapsed') ? "Mostrar Conexion" : "Ocultar Conexion";
}

function generarIdentificadorSesion() {
    sessionId = Math.random().toString(36).substr(2, 5).toUpperCase();
    document.getElementById('sessionCodeDisplay').textContent = sessionId;
}

function generarCodigoQR() {
    const container = document.getElementById("qrcode");
    container.innerHTML = "";
    let urlRemota = window.location.origin + window.location.pathname.replace('index.html', '') + 'mobile.html?session=' + sessionId;
    new QRCode(container, {
        text: urlRemota, width: 150, height: 150, colorDark: "#272343", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H
    });
}

// --- GESTION DE DADOS ---
function agregarDado(faces) {
    dados.push({ faces: faces, weights: Array(faces).fill(1) });
    inicializarMesaDados();
}

function inicializarMesaDados() {
    renderizarMesaUI();
    calcularMetricasTeoricas();
}

function renderizarMesaUI(valores = []) {
    const area = document.getElementById('diceArea');
    const controls = document.querySelector('.dice-controls');
    area.querySelectorAll('.die-box').forEach(el => el.remove());

    for (let i = 0; i < dados.length; i++) {
        const div = document.createElement('div');
        // Clase geometrica segun tipo de dado
        let polyClass = `poly-${dados[i].faces}`;
        div.className = `die-box ${polyClass}`;
        div.id = `hub-die-${i}`;
        div.innerHTML = `<span class="die-badge">D${dados[i].faces}</span>${valores[i] || '?'}`;
        area.insertBefore(div, controls);
    }
}
// --- WEBSOCKETS ---
function conectarHubWebSocket() {
    let wsUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.protocol === 'file:' ? 
                "ws://localhost:8080" : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

    document.getElementById('btnConnectHub').textContent = "Conectando...";
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        document.getElementById('hubStatus').className = "status-badge connected";
        document.getElementById('hubStatus').textContent = "Servidor Activo";
        document.getElementById('btnConnectHub').textContent = "Conectado";
        document.getElementById('btnConnectHub').disabled = true;
        ws.send(JSON.stringify({ type: "register_hub", session_id: sessionId }));
    };

    ws.onmessage = (e) => {
        let data = JSON.parse(e.data);
        if (data.type === 'register_mobile') {
            cantidadCelularesConectados++;
            document.getElementById('deviceCountBadge').textContent = `${cantidadCelularesConectados} Telefonos activos`;
            syncHaciaCelular({ type: 'dice_update', num_dados: dados.length });
            syncMetricasInversas();
            return;
        }
        if (data.type === 'mobile_action') {
            switch (data.action) {
                case 'roll': lanzarDadosMesa(); break;
                case 'clear': ejecutarLimpiezaAbsoluta(); break;
                case 'update_weights': 
                    data.dice_indices.forEach(idx => { if(idx < dados.length) dados[idx].weights = [...data.weights].slice(0, dados[idx].faces); });
                    calcularMetricasTeoricas();
                    syncMetricasInversas();
                    break;
            }
        }
    };

    ws.onclose = () => {
        document.getElementById('hubStatus').className = "status-badge disconnected";
        document.getElementById('hubStatus').textContent = "Desconectado";
        document.getElementById('btnConnectHub').textContent = "Reintentar Conexion";
        document.getElementById('btnConnectHub').disabled = false;
        cantidadCelularesConectados = 0;
        document.getElementById('deviceCountBadge').textContent = `0 Telefonos activos`;
    };
}

// --- LOGICA DE SIMULACION ---
function lanzarDadosMesa() {
    const boxes = document.querySelectorAll('.die-box');
    boxes.forEach(b => b.classList.add('rolling'));

    setTimeout(() => {
        let actual = [];
        let suma = 0;
        for (let d = 0; d < dados.length; d++) {
            let cara = calcularCaraPonderada(dados[d]);
            actual.push(cara);
            suma += cara;
        }
        renderizarMesaUI(actual);
        procesarMesaEstadisticas(actual, suma);
    }, 300);
}

function calcularCaraPonderada(dado) {
    let total = dado.weights.reduce((a, b) => a + b, 0);
    if (total === 0) return 1;
    let rand = Math.random() * total;
    for (let i = 0; i < dado.faces; i++) {
        if (rand < dado.weights[i]) return i + 1;
        rand -= dado.weights[i];
    }
    return dado.faces;
}
function procesarMesaEstadisticas(actual, suma) {
    let key = actual.join(',');
    resultadosCombos[key] = (resultadosCombos[key] || 0) + 1;
    resultadosSumas[suma] = (resultadosSumas[suma] || 0) + 1;
    
    sumatoriaSumas += suma;
    sumatoriaCuadradosSumas += (suma * suma);
    totalTiros++;

    document.getElementById('lblLastRollValue').textContent = `[${actual.join(', ')}] = ${suma}`;
    actualizarUIEstadisticasYGraficos();

    let expMedia = sumatoriaSumas / totalTiros;
    let expVar = (sumatoriaCuadradosSumas / totalTiros) - Math.pow(expMedia, 2);

    syncHaciaCelular({
        type: 'roll_result', total_tiros: totalTiros,
        media_exp: expMedia, media_teor: teoMediaTotal,
        std_exp: Math.sqrt(Math.max(0, expVar)), std_teor: Math.sqrt(teoVarTotal),
        var_exp: expVar, var_teor: teoVarTotal,
        resultados_sumas: resultadosSumas, resultados_combos: resultadosCombos,
        ultimo_resultado: `[${actual.join(', ')}] = ${suma}`
    });
}

function calcularMetricasTeoricas() {
    teoMediaTotal = 0;
    teoVarTotal = 0;
    
    dados.forEach(dado => {
        let sumPesos = dado.weights.reduce((a, b) => a + b, 0);
        if (sumPesos === 0) return;
        let mediaDado = 0;
        let pCaras = dado.weights.map(p => p / sumPesos);
        for(let i=0; i<dado.faces; i++) mediaDado += (i+1) * pCaras[i];
        let varDado = 0;
        for(let i=0; i<dado.faces; i++) varDado += Math.pow((i+1) - mediaDado, 2) * pCaras[i];
        
        teoMediaTotal += mediaDado;
        teoVarTotal += varDado;
    });

    document.getElementById('statTeoMedia').textContent = (teoMediaTotal/dados.length).toFixed(4);
    document.getElementById('statTeoVar').textContent = (teoVarTotal/dados.length).toFixed(4);
    document.getElementById('statTeoStd').textContent = Math.sqrt(teoVarTotal/dados.length).toFixed(4);
}

function actualizarUIEstadisticasYGraficos() {
    document.getElementById('totalTirosTxt').textContent = totalTiros.toLocaleString();
    let expMedia = totalTiros === 0 ? 0 : sumatoriaSumas / totalTiros;
    let expVar = totalTiros === 0 ? 0 : (sumatoriaCuadradosSumas / totalTiros) - Math.pow(expMedia, 2);

    document.getElementById('statExpMedia').textContent = expMedia.toFixed(4);
    document.getElementById('statExpVar').textContent = expVar.toFixed(4);
    document.getElementById('statExpStd').textContent = Math.sqrt(Math.max(0, expVar)).toFixed(4);

    let min = parseInt(document.getElementById('filterMin').value);
    let max = parseInt(document.getElementById('filterMax').value);
    let limit = parseInt(document.getElementById('filterLimit').value) || 50;

    let data = vistaActual === 'combos' ? resultadosCombos : resultadosSumas;
    let items = Object.keys(data).map(k => ({ label: k, f: data[k] }));

    items = items.filter(item => {
        if (vistaActual === 'sumas') {
            let val = parseInt(item.label);
            if (!isNaN(min) && val < min) return false;
            if (!isNaN(max) && val > max) return false;
        }
        return true;
    }).sort((a, b) => vistaActual === 'sumas' ? parseInt(a.label) - parseInt(b.label) : b.f - a.f).slice(0, limit);

    renderTablaHub(items);
    if(chartHist) {
        chartHist.data.labels = items.map(i => i.label);
        chartHist.data.datasets[0].data = items.map(i => i.f);
        chartHist.update();
    }
    renderAcumulativaHub(items);
}

function renderTablaHub(items) {
    const tbody = document.getElementById('tbodyResultados');
    document.getElementById('thResultado').textContent = vistaActual === 'combos' ? 'Combinacion' : 'Suma';
    tbody.innerHTML = items.map(item => `<tr><td><strong>[ ${item.label} ]</strong></td><td>${item.f}</td><td>${(item.f/totalTiros).toFixed(4)}</td><td>${((item.f/totalTiros)*100).toFixed(2)}%</td></tr>`).join('');
}
function renderAcumulativaHub(items) {
    if (!chartCDF || vistaActual !== 'sumas') return;
    let labels = [], cdfData = [], acumulador = 0;
    
    items.forEach(item => {
        acumulador += item.f;
        labels.push(item.label);
        cdfData.push((acumulador / totalTiros) * 100);
    });
    chartCDF.data.labels = labels;
    chartCDF.data.datasets[0].data = cdfData;
    chartCDF.update();
}

function syncMetricasInversas() {
    let expMedia = totalTiros === 0 ? 0 : sumatoriaSumas / totalTiros;
    let expVar = (totalTiros === 0) ? 0 : (sumatoriaCuadradosSumas / totalTiros) - Math.pow(expMedia, 2);
    syncHaciaCelular({
        type: 'stats_update',
        media_teor: teoMediaTotal,
        std_teor: Math.sqrt(teoVarTotal),
        var_teor: teoVarTotal,
        media_exp: expMedia,
        std_exp: Math.sqrt(Math.max(0, expVar)),
        var_exp: expVar
    });
}

function syncHaciaCelular(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        obj.session_id = sessionId;
        ws.send(JSON.stringify(obj));
    }
}

function initCharts() {
    const ctxH = document.getElementById('histograma');
    const ctxC = document.getElementById('chartAcumulativa');
    if(ctxH) {
        chartHist = new Chart(ctxH.getContext('2d'), {
            type: 'bar',
            data: { labels: [], datasets: [{ data: [], backgroundColor: '#2563eb', borderRadius: 4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
    if(ctxC) {
        chartCDF = new Chart(ctxC.getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: [{ data: [], borderColor: '#059669', backgroundColor: 'rgba(5, 150, 105, 0.1)', fill: true, tension: 0.2 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { max: 100, beginAtZero: true } } }
        });
    }
}

function cambiarVistaAnalitica(v) {
    vistaActual = v;
    document.getElementById('btnViewCombos').classList.toggle('active', v === 'combos');
    document.getElementById('btnViewSumas').classList.toggle('active', v === 'sumas');
    actualizarUIEstadisticasYGraficos();
}

function ejecutarLimpiezaAbsoluta() {
    totalTiros = 0;
    sumatoriaSumas = 0;
    sumatoriaCuadradosSumas = 0;
    resultadosCombos = {};
    resultadosSumas = {};
    document.getElementById('lblLastRollValue').textContent = "?";
    inicializarMesaDados();
    actualizarUIEstadisticasYGraficos();
    syncHaciaCelular({ type: 'clear_confirmation' });
}

// --- DIALOGO DE TIROS PERSONALIZADOS ---
function abrirModalPesos() {
    const container = document.getElementById('pcDiceCheckboxes');
    let html = `<label style="background:var(--button); color:var(--button-text);"><input type="checkbox" id="chkAllPc"> Seleccionar Todos</label>`;
    for(let d = 0; d < dados.length; d++) {
        html += `<label><input type="checkbox" class="chk-dado-pc" value="${d}"> Dado ${d+1} (D${dados[d].faces})</label>`;
    }
    container.innerHTML = html;
    
    document.getElementById('pcDiceCheckboxes').onchange = () => {
        const selected = document.querySelector('.chk-dado-pc:checked');
        if(selected) {
            let maxFaces = dados[selected.value].faces;
            document.getElementById('dynamicWeightInputs').innerHTML = Array(maxFaces).fill().map((_, i) => `<div><small>Cara ${i+1}</small><input type="number" id="pcWeight_${i}" value="1"></div>`).join('');
        }
    };
    
    document.getElementById('chkAllPc').onclick = function() {
        document.querySelectorAll('.chk-dado-pc').forEach(chk => chk.checked = this.checked);
        document.getElementById('pcDiceCheckboxes').dispatchEvent(new Event('change'));
    };
    
    document.getElementById('pcWeightsModal').style.display = 'flex';
    renderResumenLocal();
}

function cerrarModalPesos() { document.getElementById('pcWeightsModal').style.display = 'none'; }

function aplicarPesosYSimularMasivo() {
    const seleccionados = Array.from(document.querySelectorAll('.chk-dado-pc:checked')).map(cb => parseInt(cb.value));
    const cantidadTiradas = parseInt(document.getElementById('numTiradasCustom').value) || 1;

    if (seleccionados.length > 0) {
        let maxFaces = Math.max(...seleccionados.map(idx => dados[idx].faces));
        let nuevosPesos = [];
        for (let i = 0; i < maxFaces; i++) {
            let val = parseFloat(document.getElementById(`pcWeight_${i}`).value);
            nuevosPesos.push(isNaN(val) || val < 0 ? 0 : val);
        }
        seleccionados.forEach(idx => {
            dados[idx].weights = nuevosPesos.slice(0, dados[idx].faces);
        });
        calcularMetricasTeoricas();
        syncMetricasInversas();
    }

    for (let i = 0; i < cantidadTiradas; i++) {
        let actual = [];
        let suma = 0;
        for (let d = 0; d < dados.length; d++) {
            let cara = calcularCaraPonderada(dados[d]);
            actual.push(cara);
            suma += cara;
        }
        let key = actual.join(',');
        resultadosCombos[key] = (resultadosCombos[key] || 0) + 1;
        resultadosSumas[suma] = (resultadosSumas[suma] || 0) + 1;
        sumatoriaSumas += suma;
        sumatoriaCuadradosSumas += (suma * suma);
        totalTiros++;
    }
    actualizarUIEstadisticasYGraficos();
    cerrarModalPesos();
    renderizarMesaUI(); 
}

function renderResumenLocal() {
    document.getElementById('pcWeightsSummary').innerHTML = `<strong>Pesos actuales:</strong><br>` + 
        dados.map((d, i) => `Dado ${i+1} (D${d.faces}): [${d.weights.join(', ')}]`).join('<br>');
}