// CONFIGURAÇÃO
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

console.log('🚀 Sistema de Estoque iniciado');

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

// =====================
// AUTENTICAÇÃO
// =====================

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('estoqueSession', sessionToken);
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
        <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: var(--bg-primary);
            color: var(--text-primary);
            text-align: center;
            padding: 2rem;
        ">
            <h1 style="font-size: 2.2rem; margin-bottom: 1rem;">
                ${mensagem}
            </h1>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">
                Somente usuários autenticados podem acessar esta área.
            </p>
            <a href="${PORTAL_URL}" style="
                display: inline-block;
                background: var(--btn-register);
                color: white;
                padding: 14px 32px;
                border-radius: 8px;
                text-decoration: none;
                font-weight: 600;
            ">Ir para o Portal</a>
        </div>
    `;
}

function inicializarApp() {
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
}

// =====================
// CONEXÃO COM SERVIDOR
// =====================

async function checkServerStatus() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_URL}/estoque`, {
            method: 'HEAD',
            headers: { 'X-Session-Token': sessionToken },
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
            console.log('✅ Servidor ONLINE');
            await loadProducts();
        } else if (!wasOffline && !isOnline) {
            console.log('❌ Servidor OFFLINE');
        }
        
        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        if (isOnline) {
            console.log('❌ Erro de conexão:', error.message);
        }
        isOnline = false;
        updateConnectionStatus();
        return false;
    }
}

function updateConnectionStatus() {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.className = isOnline ? 'connection-status online' : 'connection-status offline';
    }
}

async function loadProducts() {
    if (!isOnline) return;

    try {
        const response = await fetch(`${API_URL}/estoque`, {
            headers: { 'X-Session-Token': sessionToken }
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) return;

        const data = await response.json();
        const newHash = JSON.stringify(data.map(p => p.id));

        if (newHash !== lastDataHash) {
            produtos = data.map(item => ({ ...item, descricao: item.descricao.toUpperCase() }));
            lastDataHash = newHash;
            
            console.log(`📦 ${data.length} produtos carregados`);
            
            requestAnimationFrame(() => {
                atualizarMarcasDisponiveis();
                renderMarcasFilter();
                filterProducts();
            });
        }
    } catch (error) {
        // Silencioso
    }
}

function startPolling() {
    loadProducts();
    setInterval(() => {
        if (isOnline) loadProducts();
    }, 10000);
}

// =====================
// MARCAS E FILTROS
// =====================

function atualizarMarcasDisponiveis() {
    marcasDisponiveis.clear();
    produtos.forEach(p => {
        if (p.marca && p.marca.trim()) marcasDisponiveis.add(p.marca.trim());
    });
}

function renderMarcasFilter() {
    const container = document.getElementById('marcasFilter');
    if (!container) return;

    const marcasArray = Array.from(marcasDisponiveis).sort();
    
    const fragment = document.createDocumentFragment();
    
    ['TODAS', ...marcasArray].forEach(marca => {
        const button = document.createElement('button');
        button.className = `brand-button ${marca === marcaSelecionada ? 'active' : ''}`;
        button.textContent = marca;
        button.onclick = () => window.selecionarMarca(marca);
        fragment.appendChild(button);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

window.selecionarMarca = function(marca) {
    marcaSelecionada = marca;
    renderMarcasFilter();
    filterProducts();
};

function filterProducts() {
    const searchTerm = document.getElementById('search').value.toLowerCase();
    let filtered = produtos;

    if (marcaSelecionada !== 'TODAS') {
        filtered = filtered.filter(p => p.marca === marcaSelecionada);
    }

    if (searchTerm) {
        filtered = filtered.filter(p => 
            p.codigo.toString().includes(searchTerm) ||
            p.codigo_fornecedor.toLowerCase().includes(searchTerm) ||
            p.marca.toLowerCase().includes(searchTerm) ||
            p.descricao.toLowerCase().includes(searchTerm)
        );
    }

    filtered.sort((a, b) => {
        const marcaCompare = a.marca.localeCompare(b.marca);
        if (marcaCompare !== 0) return marcaCompare;
        return a.codigo - b.codigo;
    });

    renderProducts(filtered);
}

// =====================
// MODAIS
// =====================

function showConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const { title = 'Confirmação', confirmText = 'Confirmar', cancelText = 'Cancelar', type = 'warning' } = options;

        const modalHTML = `
            <div class="modal-overlay" id="confirmModal">
                <div class="modal-content compact">
                    <div class="modal-header">
                        <h3 class="modal-title">${title}</h3>
                    </div>
                    <p class="modal-message">${message}</p>
                    <div class="modal-actions">
                        <button class="secondary" id="modalCancelBtn">${cancelText}</button>
                        <button class="${type === 'warning' ? 'danger' : 'success'}" id="modalConfirmBtn">${confirmText}</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('confirmModal');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');

        const closeModal = (result) => {
            modal.style.animation = 'fadeOut 0.2s ease forwards';
            setTimeout(() => { modal.remove(); resolve(result); }, 200);
        };

        confirmBtn.addEventListener('click', () => closeModal(true));
        cancelBtn.addEventListener('click', () => closeModal(false));

        if (!document.querySelector('#modalAnimations')) {
            const style = document.createElement('style');
            style.id = 'modalAnimations';
            style.textContent = `@keyframes fadeOut { to { opacity: 0; } }`;
            document.head.appendChild(style);
        }
    });
}

function showAddProductModal() {
    const modalHTML = `
        <div class="modal-overlay" id="addProductModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">Novo Produto</h3>
                    <button class="close-btn" onclick="closeAddProductModal()">✕</button>
                </div>
                <form id="addProductForm">
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Código do Fornecedor *</label>
                            <input type="text" id="codigoFornecedor" required placeholder="Ex: 3200">
                        </div>
                        <div class="form-group">
                            <label>Marca *</label>
                            <input type="text" id="marca" required placeholder="Ex: PLUZIE" style="text-transform: uppercase;">
                        </div>
                        <div class="form-group">
                            <label>Quantidade Inicial *</label>
                            <input type="number" id="quantidade" min="0" value="0" required>
                        </div>
                        <div class="form-group">
                            <label>Valor Unitário (R$) *</label>
                            <input type="number" id="valorUnitario" step="0.01" min="0" required>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label>Descrição *</label>
                            <textarea id="descricao" required placeholder="Descrição completa do produto" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="secondary" onclick="closeAddProductModal()">Cancelar</button>
                        <button type="submit" class="save">Cadastrar</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const form = document.getElementById('addProductForm');
    const descricaoField = document.getElementById('descricao');
    const marcaField = document.getElementById('marca');

    descricaoField.addEventListener('input', (e) => {
        const start = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(start, start);
    });

    marcaField.addEventListener('input', (e) => {
        const start = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(start, start);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const codigoFornecedor = document.getElementById('codigoFornecedor').value.trim();
        
        if (produtos.some(p => p.codigo_fornecedor === codigoFornecedor)) {
            showMessage('Código do fornecedor já cadastrado!', 'error');
            return;
        }

        const formData = {
            codigo_fornecedor: codigoFornecedor,
            marca: document.getElementById('marca').value.trim().toUpperCase(),
            descricao: document.getElementById('descricao').value.trim().toUpperCase(),
            quantidade: parseInt(document.getElementById('quantidade').value),
            valor_unitario: parseFloat(document.getElementById('valorUnitario').value)
        };

        closeAddProductModal();
        await saveNewProduct(formData);
    });

    setTimeout(() => document.getElementById('codigoFornecedor').focus(), 100);
}

function closeAddProductModal() {
    const modal = document.getElementById('addProductModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

function showEditProductModal(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    const modalHTML = `
        <div class="modal-overlay" id="editProductModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">Editar Produto</h3>
                    <button class="close-btn" onclick="closeEditProductModal()">✕</button>
                </div>
                <form id="editProductForm">
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Código</label>
                            <input type="text" value="${String(produto.codigo).padStart(6, '0')}" disabled style="background: var(--th-bg); color: white; font-weight: 700;">
                        </div>
                        <div class="form-group">
                            <label>Marca</label>
                            <input type="text" value="${produto.marca}" disabled style="background: var(--th-bg); color: white;">
                        </div>
                        <div class="form-group">
                            <label>Código do Fornecedor *</label>
                            <input type="text" id="editCodigoFornecedor" value="${produto.codigo_fornecedor}" required>
                        </div>
                        <div class="form-group">
                            <label>Valor Unitário (R$) *</label>
                            <input type="number" id="editValorUnitario" value="${produto.valor_unitario}" step="0.01" min="0" required>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label>Descrição *</label>
                            <textarea id="editDescricao" required rows="3">${produto.descricao}</textarea>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="secondary" onclick="closeEditProductModal()">Cancelar</button>
                        <button type="submit" class="save">Salvar</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const form = document.getElementById('editProductForm');
    const descricaoField = document.getElementById('editDescricao');

    descricaoField.addEventListener('input', (e) => {
        const start = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(start, start);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = {
            codigo_fornecedor: document.getElementById('editCodigoFornecedor').value.trim(),
            descricao: document.getElementById('editDescricao').value.trim().toUpperCase(),
            valor_unitario: parseFloat(document.getElementById('editValorUnitario').value)
        };

        closeEditProductModal();
        await updateProduct(id, formData);
    });
}

function closeEditProductModal() {
    const modal = document.getElementById('editProductModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

function showMovementModal(id, tipo) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    const tituloTipo = tipo === 'entrada' ? 'Entrada' : 'Saída';

    const modalHTML = `
        <div class="modal-overlay" id="movementModal">
            <div class="modal-content compact">
                <div class="modal-header">
                    <h3 class="modal-title">${tituloTipo} de Estoque</h3>
                    <button class="close-btn" onclick="closeMovementModal()">✕</button>
                </div>
                <div style="background: var(--input-bg); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
                    <div class="info-line">
                        <span class="info-label">Produto:</span>
                        <span class="info-value">${produto.descricao}</span>
                    </div>
                    <div class="info-line">
                        <span class="info-label">Estoque Atual:</span>
                        <span class="info-value"><strong>${produto.quantidade}</strong></span>
                    </div>
                </div>
                <form id="movementForm">
                    <div class="form-group">
                        <label>Quantidade *</label>
                        <input type="number" id="movementQuantity" min="1" required>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="secondary" onclick="closeMovementModal()">Cancelar</button>
                        <button type="submit" class="success">Confirmar</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const form = document.getElementById('movementForm');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const quantidade = parseInt(document.getElementById('movementQuantity').value);

        if (tipo === 'saida' && quantidade > produto.quantidade) {
            showMessage('Quantidade insuficiente em estoque!', 'error');
            return;
        }

        closeMovementModal();
        await saveMovement(id, tipo, quantidade);
    });

    setTimeout(() => document.getElementById('movementQuantity').focus(), 100);
}

function closeMovementModal() {
    const modal = document.getElementById('movementModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

window.toggleForm = function() {
    showAddProductModal();
};

window.editProduct = function(id) {
    showEditProductModal(id);
};

window.entradaProduct = function(id) {
    showMovementModal(id, 'entrada');
};

window.saidaProduct = function(id) {
    showMovementModal(id, 'saida');
};

window.viewProduct = function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    const modalHTML = `
        <div class="modal-overlay" id="viewProductModal">
            <div class="modal-content compact">
                <div class="modal-header">
                    <h3 class="modal-title">Detalhes do Produto</h3>
                    <button class="close-btn" onclick="closeViewProductModal()">✕</button>
                </div>
                <div style="background: var(--input-bg); padding: 1rem; border-radius: 8px;">
                    <div class="info-line">
                        <span class="info-label">Código de Estoque:</span>
                        <span class="info-value"><strong>${String(produto.codigo).padStart(6, '0')}</strong></span>
                    </div>
                    <div class="info-line">
                        <span class="info-label">Código do Fornecedor:</span>
                        <span class="info-value">${produto.codigo_fornecedor}</span>
                    </div>
                    <div class="info-line">
                        <span class="info-label">Marca:</span>
                        <span class="info-value"><strong>${produto.marca}</strong></span>
                    </div>
                    <div class="info-line">
                        <span class="info-label">Descrição:</span>
                        <span class="info-value">${produto.descricao}</span>
                    </div>
                    <div class="info-line">
                        <span class="info-label">Quantidade:</span>
                        <span class="info-value"><strong>${produto.quantidade}</strong></span>
                    </div>
                    <div class="info-line">
                        <span class="info-label">Valor Unitário:</span>
                        <span class="info-value">R$ ${formatCurrency(produto.valor_unitario)}</span>
                    </div>
                    <div class="info-line">
                        <span class="info-label">Valor Total:</span>
                        <span class="info-value"><strong>R$ ${formatCurrency(produto.quantidade * produto.valor_unitario)}</strong></span>
                    </div>
                    <div class="info-line">
                        <span class="info-label">Última Alteração:</span>
                        <span class="info-value">${formatDateTime(produto.timestamp)}</span>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="secondary" onclick="closeViewProductModal()">Fechar</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

window.closeViewProductModal = function() {
    const modal = document.getElementById('viewProductModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
};

// =====================
// OPERAÇÕES COM API
// =====================

async function saveNewProduct(formData) {
    if (!isOnline) {
        showMessage('Servidor offline', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/estoque`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify(formData)
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao criar produto');
        }

        const savedData = await response.json();
        savedData.descricao = savedData.descricao.toUpperCase();

        produtos.push(savedData);
        lastDataHash = JSON.stringify(produtos.map(p => p.id));

        requestAnimationFrame(() => {
            atualizarMarcasDisponiveis();
            renderMarcasFilter();
            filterProducts();
        });

        showMessage('Produto cadastrado com sucesso!', 'success');
    } catch (error) {
        showMessage(error.message || 'Erro ao criar produto', 'error');
    }
}

async function updateProduct(id, formData) {
    if (!isOnline) {
        showMessage('Servidor offline', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/estoque/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify(formData)
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao atualizar produto');

        const savedData = await response.json();
        savedData.descricao = savedData.descricao.toUpperCase();

        const index = produtos.findIndex(p => p.id === id);
        if (index !== -1) produtos[index] = savedData;

        lastDataHash = JSON.stringify(produtos.map(p => p.id));

        requestAnimationFrame(() => {
            atualizarMarcasDisponiveis();
            renderMarcasFilter();
            filterProducts();
        });

        showMessage('Produto atualizado com sucesso!', 'success');
    } catch (error) {
        showMessage('Erro ao atualizar produto', 'error');
    }
}

async function saveMovement(id, tipo, quantidade) {
    if (!isOnline) {
        showMessage('Servidor offline', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/estoque/${id}/movimentar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({ tipo, quantidade })
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao movimentar');
        }

        const savedData = await response.json();
        savedData.descricao = savedData.descricao.toUpperCase();

        const index = produtos.findIndex(p => p.id === id);
        if (index !== -1) produtos[index] = savedData;

        lastDataHash = JSON.stringify(produtos.map(p => p.id));
        filterProducts();

        const tipoMsg = tipo === 'entrada' ? 'Entrada' : 'Saída';
        showMessage(`${tipoMsg} registrada com sucesso!`, 'success');
    } catch (error) {
        showMessage(error.message || 'Erro ao movimentar', 'error');
    }
}

window.deleteProduct = async function(id) {
    const confirmed = await showConfirm('Tem certeza que deseja excluir este produto?', {
        title: 'Excluir Produto',
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
        type: 'warning'
    });

    if (!confirmed) return;

    if (!isOnline) {
        showMessage('Servidor offline', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/estoque/${id}`, {
            method: 'DELETE',
            headers: { 'X-Session-Token': sessionToken }
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao deletar');

        produtos = produtos.filter(p => p.id !== id);
        lastDataHash = JSON.stringify(produtos.map(p => p.id));

        requestAnimationFrame(() => {
            atualizarMarcasDisponiveis();
            renderMarcasFilter();
            filterProducts();
        });

        showMessage('Produto excluído!', 'success');
    } catch (error) {
        showMessage('Erro ao excluir', 'error');
    }
};

// =====================
// RENDERIZAÇÃO
// =====================

function renderProducts(produtosToRender) {
    const container = document.getElementById('estoqueContainer');
    
    if (!produtosToRender || produtosToRender.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhum produto encontrado</div>';
        return;
    }

    const rows = produtosToRender.map(p => `
        <tr>
            <td><strong>${String(p.codigo).padStart(6, '0')}</strong></td>
            <td>${p.codigo_fornecedor}</td>
            <td><strong>${p.marca}</strong></td>
            <td>${p.descricao}</td>
            <td style="text-align: center;"><strong>${p.quantidade}</strong></td>
            <td style="text-align: right;">R$ ${formatCurrency(p.valor_unitario)}</td>
            <td style="color: var(--text-secondary); font-size: 0.85rem;">${formatDateTime(p.timestamp)}</td>
            <td>
                <div class="actions-cell">
                    <button onclick="window.viewProduct('${p.id}')" class="action-btn view">Ver</button>
                    <button onclick="window.editProduct('${p.id}')" class="action-btn edit">Editar</button>
                    <button onclick="window.entradaProduct('${p.id}')" class="action-btn entrada">Entrada</button>
                    <button onclick="window.saidaProduct('${p.id}')" class="action-btn saida">Saída</button>
                </div>
            </td>
        </tr>
    `).join('');

    const totalValue = produtosToRender.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);

    container.innerHTML = `
        <div style="overflow-x: auto;">
            <table>
                <thead>
                    <tr>
                        <th style="width: 80px;">Código</th>
                        <th style="width: 120px;">Cód. Fornecedor</th>
                        <th style="width: 120px;">Marca</th>
                        <th>Descrição</th>
                        <th style="width: 100px; text-align: center;">Quantidade</th>
                        <th style="width: 120px; text-align: right;">Valor Unit.</th>
                        <th style="width: 150px;">Última Alteração</th>
                        <th style="width: 320px;">Ações</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div style="margin-top: 1.5rem; padding: 1rem; background: var(--input-bg); border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; color: var(--text-secondary);">VALOR TOTAL EM ESTOQUE:</span>
                <span style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">R$ ${formatCurrency(totalValue)}</span>
            </div>
        </div>
    `;
}

// =====================
// RELATÓRIO PDF
// =====================

function generateInventoryPDF() {
    if (produtos.length === 0) {
        showMessage('Não há produtos para gerar o relatório!', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Inventário Geral de Estoque', 105, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const now = new Date();
    doc.text(`Relatório emitido em ${formatDateTime(now.toISOString())}`, 105, 28, { align: 'center' });

    const groupedByBrand = {};
    let filteredProducts = produtos;

    if (marcaSelecionada !== 'TODAS') {
        filteredProducts = filteredProducts.filter(p => p.marca === marcaSelecionada);
    }

    filteredProducts.forEach(product => {
        if (!groupedByBrand[product.marca]) {
            groupedByBrand[product.marca] = [];
        }
        groupedByBrand[product.marca].push(product);
    });

    let startY = 45;
    let grandTotal = 0;

    Object.keys(groupedByBrand).sort().forEach((marca) => {
        const productsInGroup = groupedByBrand[marca];
        
        if (startY > 250) {
            doc.addPage();
            startY = 20;
        }

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`${marca}`, 14, startY);
        startY += 7;

        const tableData = productsInGroup.map(p => [
            String(p.codigo).padStart(6, '0'),
            p.codigo_fornecedor,
            p.descricao.substring(0, 50),
            p.quantidade.toString(),
            `R$ ${formatCurrency(p.valor_unitario)}`,
            `R$ ${formatCurrency(p.quantidade * p.valor_unitario)}`
        ]);

        const groupTotal = productsInGroup.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);
        grandTotal += groupTotal;

        doc.autoTable({
            startY: startY,
            head: [['Código', 'Cód. F.', 'DESCRIÇÃO', 'QTD', 'UND (R$)', 'TOTAL (R$)']],
            body: tableData,
            foot: [[
                { content: `Registros listados: ${productsInGroup.length}`, colSpan: 3, styles: { halign: 'left', fontStyle: 'bold' } },
                { content: '', colSpan: 2, styles: { halign: 'right' } },
                { content: `R$ ${formatCurrency(groupTotal)}`, styles: { halign: 'right', fontStyle: 'bold' } }
            ]],
            theme: 'grid',
            styles: {
                fontSize: 9,
                cellPadding: 3
            },
            headStyles: {
                fillColor: [74, 74, 74],
                textColor: 255,
                fontStyle: 'bold',
                halign: 'center'
            },
            footStyles: {
                fillColor: [240, 240, 240],
                textColor: 0,
                fontStyle: 'bold'
            },
            columnStyles: {
                0: { halign: 'center', cellWidth: 20 },
                1: { halign: 'center', cellWidth: 28 },
                2: { halign: 'left', cellWidth: 68 },
                3: { halign: 'center', cellWidth: 15 },
                4: { halign: 'right', cellWidth: 25 },
                5: { halign: 'right', cellWidth: 34 }
            },
            margin: { left: 14, right: 14 }
        });

        startY = doc.lastAutoTable.finalY + 15;
    });

    if (startY > 260) {
        doc.addPage();
        startY = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setDrawColor(204, 112, 0);
    doc.setLineWidth(0.5);
    doc.line(14, startY, 196, startY);
    startY += 8;
    doc.text(`VALOR TOTAL EM ESTOQUE: R$ ${formatCurrency(grandTotal)}`, 105, startY, { align: 'center' });

    const dateStr = formatDate(now.toISOString()).replace(/\//g, '-');
    doc.save(`Inventario_Estoque_${dateStr}.pdf`);
    showMessage('Relatório gerado com sucesso!', 'success');
}

// =====================
// UTILITÁRIOS
// =====================

function formatCurrency(value) {
    return value.toLocaleString('pt-BR', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    });
}

function formatDateTime(isoString) {
    if (!isoString) return 'Sem data';
    const date = new Date(isoString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function formatDate(isoString) {
    const date = new Date(isoString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function showMessage(message, type) {
    const oldMessages = document.querySelectorAll('.floating-message');
    oldMessages.forEach(msg => msg.remove());
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `floating-message ${type}`;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
}
