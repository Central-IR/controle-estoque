const PORTAL_URL = 'https://ir-comercio-portal-zcan.onrender.com';
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3002/api'
    : `${window.location.origin}/api`;

let produtos = [];
let isOnline = false;
let marcaSelecionada = 'TODAS';
let marcasDisponiveis = new Set();
let lastDataHash = '';
let sessionToken = null;
let autoSyncEnabled = true; // Novo: controle de sincronização automática

console.log('🚀 Estoque iniciado');
console.log('📍 API URL:', API_URL);

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('estoqueSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('estoqueSession');
    }

    if (!sessionToken) {
        mostrarTelaAcessoNegado();
        return;
    }

    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 2rem;">
            <h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">Somente usuários autenticados podem acessar esta área.</p>
            <a href="${PORTAL_URL}" style="display: inline-block; background: var(--btn-register); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Ir para o Portal</a>
        </div>
    `;
}

async function inicializarApp() {
    // Carregar dados iniciais
    await checkServerStatus();
    
    // Verificar conexão a cada 30 segundos (reduzido de 15s)
    setInterval(checkServerStatus, 30000);
    
    // Sincronização automática inteligente: apenas se houve mudanças
    setInterval(async () => {
        if (isOnline && autoSyncEnabled) {
            await loadProducts(true); // Modo silencioso
        }
    }, 60000); // A cada 1 minuto (reduzido de intervalos menores)
}

async function checkServerStatus() {
    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_URL}/estoque`, {
            method: 'HEAD', // HEAD ao invés de GET para ser mais rápido
            headers: headers,
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }

        const wasOffline = !isOnline;
        isOnline = response.ok;
        
        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE');
            await loadProducts();
        }
        
        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        isOnline = false;
        updateConnectionStatus();
        return false;
    }
}

function updateConnectionStatus() {
    const status = document.getElementById('connectionStatus');
    if (status) {
        status.className = isOnline ? 'connection-status online' : 'connection-status offline';
    }
}

// CARREGAR PRODUTOS (otimizado)
async function loadProducts(silencioso = false) {
    if (!isOnline) return;
    
    try {
        const response = await fetch(`${API_URL}/estoque`, {
            headers: {
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            }
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao carregar');

        const data = await response.json();
        
        // Verificar se houve mudanças (usando hash simples)
        const newHash = JSON.stringify(data.map(p => `${p.id}-${p.quantidade}`));
        
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            produtos = data;
            
            // Atualizar marcas disponíveis
            marcasDisponiveis.clear();
            produtos.forEach(p => marcasDisponiveis.add(p.marca));
            
            // Atualizar interface
            renderMarcasFilter();
            filterProducts();
            
            if (!silencioso) {
                console.log(`📦 ${produtos.length} produtos carregados`);
            }
        }
    } catch (error) {
        console.error('Erro ao carregar produtos:', error);
        if (!silencioso) {
            showMessage('Erro ao carregar dados', 'error');
        }
    }
}

// SINCRONIZAÇÃO MANUAL (com animação)
window.sincronizarManual = async function() {
    if (!isOnline) {
        showMessage('Sistema offline', 'error');
        return;
    }

    const btn = document.querySelector('.sync-btn');
    if (btn) {
        btn.style.pointerEvents = 'none';
        const svg = btn.querySelector('svg');
        svg.style.animation = 'spin 1s linear infinite';
    }

    try {
        await loadProducts();
        showMessage('Dados atualizados', 'success');
    } finally {
        if (btn) {
            btn.style.pointerEvents = 'auto';
            const svg = btn.querySelector('svg');
            svg.style.animation = 'none';
        }
    }
};

function renderMarcasFilter() {
    const container = document.getElementById('marcasFilter');
    if (!container) return;

    container.innerHTML = '';

    // Botão TODAS
    const btnTodas = document.createElement('button');
    btnTodas.className = `brand-button ${marcaSelecionada === 'TODAS' ? 'active' : ''}`;
    btnTodas.textContent = 'TODAS';
    btnTodas.onclick = () => filtrarPorMarca('TODAS');
    container.appendChild(btnTodas);

    // Botões de marcas
    Array.from(marcasDisponiveis).sort().forEach(marca => {
        const btn = document.createElement('button');
        btn.className = `brand-button ${marcaSelecionada === marca ? 'active' : ''}`;
        btn.textContent = marca;
        btn.onclick = () => filtrarPorMarca(marca);
        container.appendChild(btn);
    });
}

function filtrarPorMarca(marca) {
    marcaSelecionada = marca;
    renderMarcasFilter();
    filterProducts();
}

function filterProducts() {
    const search = document.getElementById('search').value.toLowerCase();
    
    let filtered = produtos;

    // Filtro por marca
    if (marcaSelecionada !== 'TODAS') {
        filtered = filtered.filter(p => p.marca === marcaSelecionada);
    }

    // Filtro por busca
    if (search) {
        filtered = filtered.filter(p =>
            p.codigo.toString().includes(search) ||
            p.codigo_fornecedor.toLowerCase().includes(search) ||
            p.marca.toLowerCase().includes(search) ||
            p.descricao.toLowerCase().includes(search)
        );
    }

    renderTable(filtered);
}

function renderTable(products) {
    const tbody = document.getElementById('estoqueTableBody');
    if (!tbody) return;

    if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem;">Nenhum produto encontrado</td></tr>';
        return;
    }

    // Renderização otimizada
    tbody.innerHTML = products.map(p => `
        <tr>
            <td><strong>${p.codigo}</strong></td>
            <td>${p.codigo_fornecedor}</td>
            <td>${p.ncm || '-'}</td>
            <td>${p.marca}</td>
            <td>${p.descricao}</td>
            <td><strong>${p.quantidade}</strong></td>
            <td>R$ ${parseFloat(p.valor_unitario).toFixed(2)}</td>
            <td><strong>R$ ${(p.quantidade * parseFloat(p.valor_unitario)).toFixed(2)}</strong></td>
            <td class="actions-cell">
                <button onclick="editProduct('${p.id}')" class="action-btn edit">Editar</button>
                <button onclick="deleteProduct('${p.id}')" class="action-btn delete">Excluir</button>
            </td>
        </tr>
    `).join('');
}

// MODAL E FORMULÁRIO
let currentForm = null;
let editingProductId = null;

window.toggleForm = function() {
    editingProductId = null;
    document.getElementById('formTitle').textContent = 'Novo Produto';
    document.getElementById('productForm').reset();
    document.getElementById('formModal').classList.add('show');
};

window.closeFormModal = function() {
    document.getElementById('formModal').classList.remove('show');
    editingProductId = null;
};

window.editProduct = async function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    editingProductId = id;
    document.getElementById('formTitle').textContent = 'Editar Produto';
    document.getElementById('codigo_fornecedor').value = produto.codigo_fornecedor;
    document.getElementById('ncm').value = produto.ncm || '';
    document.getElementById('marca').value = produto.marca;
    document.getElementById('descricao').value = produto.descricao;
    document.getElementById('quantidade').value = produto.quantidade;
    document.getElementById('valor_unitario').value = parseFloat(produto.valor_unitario).toFixed(2);
    
    document.getElementById('formModal').classList.add('show');
};

window.saveProduct = async function(event) {
    event.preventDefault();

    const formData = {
        codigo_fornecedor: document.getElementById('codigo_fornecedor').value.trim(),
        ncm: document.getElementById('ncm').value.trim(),
        marca: document.getElementById('marca').value.trim(),
        descricao: document.getElementById('descricao').value.trim(),
        quantidade: parseInt(document.getElementById('quantidade').value),
        valor_unitario: parseFloat(document.getElementById('valor_unitario').value)
    };

    try {
        const url = editingProductId 
            ? `${API_URL}/estoque/${editingProductId}`
            : `${API_URL}/estoque`;
        
        const method = editingProductId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao salvar');
        }

        // Recarregar dados imediatamente
        await loadProducts();
        
        closeFormModal();
        showMessage(editingProductId ? 'Produto atualizado' : 'Produto criado', 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    }
};

window.deleteProduct = async function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    if (!confirm(`Excluir produto ${produto.codigo_fornecedor}?`)) return;

    try {
        const response = await fetch(`${API_URL}/estoque/${id}`, {
            method: 'DELETE',
            headers: {
                'X-Session-Token': sessionToken
            }
        });

        if (!response.ok) throw new Error('Erro ao excluir');

        // Recarregar dados imediatamente
        await loadProducts();
        
        showMessage('Produto excluído', 'success');
    } catch (error) {
        showMessage('Erro ao excluir produto', 'error');
    }
};

// MENSAGENS
function showMessage(message, type = 'success') {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 2000);
}

function showConfirm(message, title = 'Confirmação') {
    return new Promise((resolve) => {
        const modalHTML = `
            <div class="modal-overlay show">
                <div class="modal-content compact">
                    <div class="modal-header">
                        <h3 class="modal-title">${title}</h3>
                    </div>
                    <p class="modal-message">${message}</p>
                    <div class="modal-actions">
                        <button class="secondary" onclick="closeConfirmModal(false)">Cancelar</button>
                        <button class="danger" onclick="closeConfirmModal(true)">Confirmar</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        window.closeConfirmModal = function(result) {
            const modal = document.querySelector('.modal-overlay');
            if (modal) {
                modal.style.animation = 'modalFadeOut 0.2s ease forwards';
                setTimeout(() => {
                    modal.remove();
                    delete window.closeConfirmModal;
                    resolve(result);
                }, 200);
            }
        };
    });
}
