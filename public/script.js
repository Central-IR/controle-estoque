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

function inicializarApp() {
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
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
            method: 'GET',
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
        console.error('❌ Erro ao verificar servidor:', error.message);
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
        const timestamp = new Date().getTime();
        const response = await fetch(`${API_URL}/estoque?_t=${timestamp}`, {
            method: 'GET',
            headers: { 
                'X-Session-Token': sessionToken,
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            },
            mode: 'cors'
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) return;

        const data = await response.json();
        const newDataHash = JSON.stringify(data.map(p => `${p.id}-${p.timestamp || ''}`));

        if (newDataHash !== lastDataHash) {
            produtos = data;
            lastDataHash = newDataHash;
            
            marcasDisponiveis.clear();
            produtos.forEach(p => {
                if (p.marca) marcasDisponiveis.add(p.marca);
            });

            renderMarcasFilter();
            filterProducts();
            console.log(`✅ ${produtos.length} produtos carregados`);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar produtos:', error);
    }
}

// Sincronização manual
window.sincronizarManual = async function() {
    if (!isOnline) {
        showMessage('Sistema offline', 'error');
        return;
    }

    const btn = document.querySelector('.sync-btn');
    if (btn) {
        btn.style.pointerEvents = 'none';
        btn.querySelector('svg').style.animation = 'spin 1s linear infinite';
    }

    await loadProducts();
    showMessage('Dados sincronizados com sucesso', 'success');

    if (btn) {
        btn.style.pointerEvents = 'auto';
        btn.querySelector('svg').style.animation = 'none';
    }
};


function startPolling() {
    loadProducts();
    setInterval(() => {
        if (isOnline) loadProducts();
    }, 10000);
}

function renderMarcasFilter() {
    const container = document.getElementById('marcasFilter');
    if (!container) return;

    const marcasOrdenadas = ['TODAS', ...Array.from(marcasDisponiveis).sort()];

    container.innerHTML = marcasOrdenadas.map(marca => `
        <button 
            class="brand-button ${marca === marcaSelecionada ? 'active' : ''}" 
            onclick="selecionarMarca('${marca}')"
        >
            ${marca}
        </button>
    `).join('');
}

window.selecionarMarca = function(marca) {
    marcaSelecionada = marca;
    renderMarcasFilter();
    filterProducts();
};

window.filterProducts = function() {
    const searchTerm = document.getElementById('search').value.toLowerCase();
    
    const filtrados = produtos.filter(p => {
        const matchMarca = marcaSelecionada === 'TODAS' || p.marca === marcaSelecionada;
        const matchSearch = !searchTerm || 
            p.codigo?.toString().includes(searchTerm) ||
            p.codigo_fornecedor?.toLowerCase().includes(searchTerm) ||
            p.ncm?.toLowerCase().includes(searchTerm) ||
            p.marca?.toLowerCase().includes(searchTerm) ||
            p.descricao?.toLowerCase().includes(searchTerm);
        
        return matchMarca && matchSearch;
    });

    renderTable(filtrados);
};

function renderTable(produtosExibir) {
    const tbody = document.getElementById('estoqueTableBody');
    if (!tbody) return;

    if (produtosExibir.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                    <div style="font-size: 1.1rem;">Nenhum produto encontrado</div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = produtosExibir.map(p => {
        const valorTotal = (p.quantidade * p.valor_unitario).toFixed(2);
        return `
            <tr>
                <td><strong>${p.codigo || '-'}</strong></td>
                <td>${p.codigo_fornecedor || '-'}</td>
                <td>${p.ncm || '-'}</td>
                <td><strong>${p.marca || '-'}</strong></td>
                <td>${p.descricao || '-'}</td>
                <td><strong>${p.quantidade || 0}</strong></td>
                <td>R$ ${parseFloat(p.valor_unitario || 0).toFixed(2)}</td>
                <td><strong>R$ ${valorTotal}</strong></td>
                <td class="actions-cell">
                    <button onclick="viewProduct('${p.id}')" class="action-btn view">Ver</button>
                    <button onclick="editProduct('${p.id}')" class="action-btn edit">Editar</button>
                    <button onclick="showEntradaModal('${p.id}')" class="action-btn entrada">Entrada</button>
                    <button onclick="showSaidaModal('${p.id}')" class="action-btn saida">Saída</button>
                </td>
            </tr>
        `;
    }).join('');
}

// FUNÇÕES CRUD
window.toggleForm = function() {
    showFormModal();
};

function showFormModal(editId = null) {
    const isEditing = editId !== null;
    let produto = null;

    if (isEditing) {
        produto = produtos.find(p => String(p.id) === String(editId));
        if (!produto) {
            showMessage('Produto não encontrado', 'error');
            return;
        }
    }

    const modalHTML = `
        <div class="modal-overlay show">
            <div class="modal-content large">
                <div class="modal-header">
                    <h2 class="modal-title">${isEditing ? 'Editar Produto' : 'Novo Produto'}</h2>
                    <button onclick="closeFormModal()" class="close-btn" style="background: none; border: none; font-size: 1.5rem; color: var(--text-secondary); cursor: pointer; padding: 0; margin: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">&times;</button>
                </div>
                <form id="productForm" class="modal-form-content">
                    <input type="hidden" id="editId" value="${editId || ''}">
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="codigo_fornecedor">Código Fornecedor *</label>
                            <input type="text" id="codigo_fornecedor" value="${produto?.codigo_fornecedor || ''}" required ${isEditing ? 'readonly style="background: var(--input-bg); opacity: 0.7;"' : ''}>
                        </div>
                        <div class="form-group">
                            <label for="ncm">NCM</label>
                            <input type="text" id="ncm" value="${produto?.ncm || ''}">
                        </div>
                        <div class="form-group">
                            <label for="marca">Marca *</label>
                            <input type="text" id="marca" value="${produto?.marca || ''}" required ${isEditing ? 'readonly style="background: var(--input-bg); opacity: 0.7;"' : ''}>
                        </div>
                        <div class="form-group">
                            <label for="descricao">Descrição *</label>
                            <input type="text" id="descricao" value="${produto?.descricao || ''}" required>
                        </div>
                        ${isEditing ? '' : `
                        <div class="form-group">
                            <label for="quantidade">Quantidade *</label>
                            <input type="number" id="quantidade" min="0" value="0" required>
                        </div>
                        `}
                        <div class="form-group">
                            <label for="valor_unitario">Valor Unitário *</label>
                            <input type="number" id="valor_unitario" step="0.01" min="0" value="${produto?.valor_unitario || ''}" required>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="secondary" onclick="closeFormModal()">Cancelar</button>
                        <button type="submit" class="success">${isEditing ? 'Salvar' : 'Cadastrar'}</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.getElementById('productForm').addEventListener('submit', handleSubmit);
}

function closeFormModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.style.animation = 'modalFadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

async function handleSubmit(e) {
    e.preventDefault();

    const editId = document.getElementById('editId').value;
    const formData = {
        codigo_fornecedor: document.getElementById('codigo_fornecedor').value.trim(),
        ncm: document.getElementById('ncm').value.trim() || null,
        marca: document.getElementById('marca').value.trim().toUpperCase(),
        descricao: document.getElementById('descricao').value.trim().toUpperCase(),
        valor_unitario: parseFloat(document.getElementById('valor_unitario').value)
    };

    if (!editId) {
        formData.quantidade = parseInt(document.getElementById('quantidade').value);
    }

    if (!isOnline) {
        showMessage('Sistema offline', 'error');
        return;
    }

    try {
        const url = editId ? `${API_URL}/estoque/${editId}` : `${API_URL}/estoque`;
        const method = editId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
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
            throw new Error(error.error || 'Erro ao salvar');
        }

        await loadProducts();
        closeFormModal();
        showMessage(`Produto ${editId ? 'atualizado' : 'cadastrado'} com sucesso`, 'success');
    } catch (error) {
        console.error('Erro:', error);
        showMessage(error.message, 'error');
    }
}

window.viewProduct = function(id) {
    const produto = produtos.find(p => String(p.id) === String(id));
    if (!produto) {
        showMessage('Produto não encontrado', 'error');
        return;
    }

    const modalHTML = `
        <div class="modal-overlay show">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Detalhes do Produto</h2>
                    <button onclick="closeViewModal()" class="close-btn" style="background: none; border: none; font-size: 1.5rem; color: var(--text-secondary); cursor: pointer; padding: 0; margin: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">&times;</button>
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
                        <span style="font-weight: 600; color: var(--text-secondary);">Código:</span>
                        <span style="color: var(--text-primary);"><strong>${produto.codigo || '-'}</strong></span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
                        <span style="font-weight: 600; color: var(--text-secondary);">Cód. Fornecedor:</span>
                        <span style="color: var(--text-primary);">${produto.codigo_fornecedor || '-'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
                        <span style="font-weight: 600; color: var(--text-secondary);">NCM:</span>
                        <span style="color: var(--text-primary);">${produto.ncm || '-'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
                        <span style="font-weight: 600; color: var(--text-secondary);">Marca:</span>
                        <span style="color: var(--text-primary);"><strong>${produto.marca || '-'}</strong></span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
                        <span style="font-weight: 600; color: var(--text-secondary);">Descrição:</span>
                        <span style="color: var(--text-primary);">${produto.descricao || '-'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
                        <span style="font-weight: 600; color: var(--text-secondary);">Quantidade:</span>
                        <span style="color: var(--text-primary);"><strong>${produto.quantidade || 0}</strong></span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border-color);">
                        <span style="font-weight: 600; color: var(--text-secondary);">Valor Unitário:</span>
                        <span style="color: var(--text-primary);">R$ ${parseFloat(produto.valor_unitario || 0).toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0;">
                        <span style="font-weight: 600; color: var(--text-secondary);">Valor Total:</span>
                        <span style="color: var(--text-primary);"><strong>R$ ${(produto.quantidade * produto.valor_unitario).toFixed(2)}</strong></span>
                    </div>
                </div>
                <div class="modal-actions">
                    <button onclick="closeViewModal()" class="secondary">Fechar</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
};

function closeViewModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.style.animation = 'modalFadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

window.editProduct = function(id) {
    showFormModal(id);
};


// ENTRADA DE ESTOQUE
window.showEntradaModal = function(id) {
    const produto = produtos.find(p => String(p.id) === String(id));
    if (!produto) {
        showMessage('Produto não encontrado', 'error');
        return;
    }

    const modalHTML = `
        <div class="modal-overlay show">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Entrada de Estoque</h2>
                    <button onclick="closeEntradaModal()" class="close-btn" style="background: none; border: none; font-size: 1.5rem; color: var(--text-secondary); cursor: pointer; padding: 0; margin: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">&times;</button>
                </div>
                <div style="margin: 1.5rem 0;">
                    <p style="color: var(--text-primary); margin-bottom: 1rem;"><strong>Produto:</strong> ${produto.descricao}</p>
                    <p style="color: var(--text-primary); margin-bottom: 1.5rem;"><strong>Estoque atual:</strong> ${produto.quantidade}</p>
                    <div class="form-group">
                        <label for="quantidade_entrada">Quantidade a Adicionar *</label>
                        <input type="number" id="quantidade_entrada" min="1" value="1" required>
                    </div>
                </div>
                <div class="modal-actions">
                    <button onclick="closeEntradaModal()" class="secondary">Cancelar</button>
                    <button onclick="confirmarEntrada('${id}')" class="action-btn entrada">Confirmar Entrada</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
};

function closeEntradaModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.style.animation = 'modalFadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

window.confirmarEntrada = async function(id) {
    const quantidade = parseInt(document.getElementById('quantidade_entrada').value);

    if (!quantidade || quantidade <= 0) {
        showMessage('Quantidade inválida', 'error');
        return;
    }

    if (!isOnline) {
        showMessage('Sistema offline', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/estoque/${id}/movimentar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({ tipo: 'entrada', quantidade })
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao registrar entrada');
        }

        await loadProducts();
        closeEntradaModal();
        showMessage('Entrada registrada com sucesso', 'success');
    } catch (error) {
        console.error('Erro:', error);
        showMessage(error.message, 'error');
    }
};

// SAÍDA DE ESTOQUE
window.showSaidaModal = function(id) {
    const produto = produtos.find(p => String(p.id) === String(id));
    if (!produto) {
        showMessage('Produto não encontrado', 'error');
        return;
    }

    const modalHTML = `
        <div class="modal-overlay show">
            <div class="modal-content">
                <div class="modal-header">
                    <h2 class="modal-title">Saída de Estoque</h2>
                    <button onclick="closeSaidaModal()" class="close-btn" style="background: none; border: none; font-size: 1.5rem; color: var(--text-secondary); cursor: pointer; padding: 0; margin: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px;">&times;</button>
                </div>
                <div style="margin: 1.5rem 0;">
                    <p style="color: var(--text-primary); margin-bottom: 1rem;"><strong>Produto:</strong> ${produto.descricao}</p>
                    <p style="color: var(--text-primary); margin-bottom: 1.5rem;"><strong>Estoque atual:</strong> <span style="color: var(--success-color); font-weight: 700;">${produto.quantidade}</span></p>
                    <div class="form-group">
                        <label for="quantidade_saida">Quantidade a Retirar *</label>
                        <input type="number" id="quantidade_saida" min="1" max="${produto.quantidade}" value="1" required>
                        <small style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.25rem; display: block;">Máximo disponível: ${produto.quantidade}</small>
                    </div>
                </div>
                <div class="modal-actions">
                    <button onclick="closeSaidaModal()" class="secondary">Cancelar</button>
                    <button onclick="confirmarSaida('${id}')" class="action-btn saida">Confirmar Saída</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
};

function closeSaidaModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.style.animation = 'modalFadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

window.confirmarSaida = async function(id) {
    const produto = produtos.find(p => String(p.id) === String(id));
    const quantidade = parseInt(document.getElementById('quantidade_saida').value);

    if (!quantidade || quantidade <= 0) {
        showMessage('Quantidade inválida', 'error');
        return;
    }

    if (quantidade > produto.quantidade) {
        showMessage(`Quantidade insuficiente em estoque. Disponível: ${produto.quantidade}`, 'error');
        return;
    }

    if (!isOnline) {
        showMessage('Sistema offline', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/estoque/${id}/movimentar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({ tipo: 'saida', quantidade })
        });

        if (response.status === 401) {
            sessionStorage.removeItem('estoqueSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao registrar saída');
        }

        await loadProducts();
        closeSaidaModal();
        showMessage('Saída registrada com sucesso', 'success');
    } catch (error) {
        console.error('Erro:', error);
        showMessage(error.message, 'error');
    }
};

// GERAÇÃO DE PDF
window.generateInventoryPDF = function() {
    if (!window.jspdf) {
        showMessage('Biblioteca PDF não carregada', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Título
    doc.setFontSize(18);
    doc.text('Relatório de Estoque', 14, 20);

    // Data
    doc.setFontSize(10);
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, 14, 28);

    // Tabela
    const tableData = produtos.map(p => [
        p.codigo || '-',
        p.codigo_fornecedor || '-',
        p.marca || '-',
        p.descricao || '-',
        p.quantidade || 0,
        `R$ ${parseFloat(p.valor_unitario || 0).toFixed(2)}`,
        `R$ ${(p.quantidade * p.valor_unitario).toFixed(2)}`
    ]);

    doc.autoTable({
        head: [['Código', 'Cód. Forn.', 'Marca', 'Descrição', 'Qtd', 'Valor Unit.', 'Total']],
        body: tableData,
        startY: 35,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [107, 114, 128] }
    });

    // Totais
    const valorTotal = produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);
    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.text(`Total de Produtos: ${produtos.length}`, 14, finalY);
    doc.text(`Valor Total do Estoque: R$ ${valorTotal.toFixed(2)}`, 14, finalY + 7);

    doc.save(`estoque_${new Date().toISOString().split('T')[0]}.pdf`);
    showMessage('PDF gerado com sucesso', 'success');
};

// UTILITÁRIOS
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
