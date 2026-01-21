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
let autoSyncEnabled = true;

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
    await checkServerStatus();
    setInterval(checkServerStatus, 30000);
    setInterval(async () => {
        if (isOnline && autoSyncEnabled) {
            await loadProducts(true);
        }
    }, 60000);
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
            method: 'HEAD',
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
        
        const newHash = JSON.stringify(data.map(p => `${p.id}-${p.quantidade}`));
        
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            produtos = data;
            
            marcasDisponiveis.clear();
            produtos.forEach(p => marcasDisponiveis.add(p.marca));
            
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

window.sincronizarManual = async function() {
    if (!isOnline) {
        showMessage('Sistema offline', 'error');
        return;
    }

    const btn = document.querySelector('.sync-btn:last-child');
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

    const btnTodas = document.createElement('button');
    btnTodas.className = `brand-button ${marcaSelecionada === 'TODAS' ? 'active' : ''}`;
    btnTodas.textContent = 'TODAS';
    btnTodas.onclick = () => filtrarPorMarca('TODAS');
    container.appendChild(btnTodas);

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

    if (marcaSelecionada !== 'TODAS') {
        filtered = filtered.filter(p => p.marca === marcaSelecionada);
    }

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
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 2rem;">Nenhum produto encontrado</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(p => `
        <tr>
            <td><strong>${p.codigo}</strong></td>
            <td>${p.codigo_fornecedor}</td>
            <td>${p.ncm || '-'}</td>
            <td>${p.marca}</td>
            <td>${p.descricao}</td>
            <td>${p.unidade || 'UN'}</td>
            <td><strong>${p.quantidade}</strong></td>
            <td>R$ ${parseFloat(p.valor_unitario).toFixed(2)}</td>
            <td><strong>R$ ${(p.quantidade * parseFloat(p.valor_unitario)).toFixed(2)}</strong></td>
            <td class="actions-cell">
                <button onclick="viewProduct('${p.id}')" class="action-btn view">Ver</button>
                <button onclick="editProduct('${p.id}')" class="action-btn edit">Editar</button>
                <button onclick="openEntradaModal('${p.id}')" class="action-btn success">Entrada</button>
                <button onclick="openSaidaModal('${p.id}')" class="action-btn delete">Saída</button>
            </td>
        </tr>
    `).join('');
}

// MODAL DE ABAS
let editingProductId = null;
let formCancelado = false;

window.switchTab = function(tabName) {
    // Remover active de todos os botões e conteúdos
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Adicionar active ao selecionado
    document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
};

window.toggleForm = function() {
    editingProductId = null;
    formCancelado = false;
    document.getElementById('formTitle').textContent = 'Novo Produto';
    document.getElementById('productForm').reset();
    
    // Reset abas para a primeira
    switchTab('fornecedor');
    
    document.getElementById('formModal').classList.add('show');
};

window.closeFormModal = function(cancelado = false) {
    const modal = document.getElementById('formModal');
    modal.classList.remove('show');
    
    if (cancelado) {
        if (editingProductId) {
            showMessage('Atualização cancelada', 'error');
        } else {
            showMessage('Cadastro cancelado', 'error');
        }
    }
    
    editingProductId = null;
    formCancelado = false;
};

window.editProduct = async function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    editingProductId = id;
    formCancelado = false;
    document.getElementById('formTitle').textContent = 'Editar Produto';
    document.getElementById('codigo_fornecedor').value = produto.codigo_fornecedor;
    document.getElementById('ncm').value = produto.ncm || '';
    document.getElementById('marca').value = produto.marca;
    document.getElementById('descricao').value = produto.descricao;
    document.getElementById('unidade').value = produto.unidade || 'UN';
    document.getElementById('quantidade').value = produto.quantidade;
    document.getElementById('valor_unitario').value = parseFloat(produto.valor_unitario).toFixed(2);
    
    // Reset abas para a primeira
    switchTab('fornecedor');
    
    document.getElementById('formModal').classList.add('show');
};

window.saveProduct = async function(event) {
    event.preventDefault();

    const formData = {
        codigo_fornecedor: document.getElementById('codigo_fornecedor').value.trim(),
        ncm: document.getElementById('ncm').value.trim(),
        marca: document.getElementById('marca').value.trim(),
        descricao: document.getElementById('descricao').value.trim(),
        unidade: document.getElementById('unidade').value,
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

        const savedProduct = await response.json();
        
        await loadProducts();
        closeFormModal(false);
        
        if (editingProductId) {
            showMessage(`${savedProduct.codigo} atualizado`, 'success');
        } else {
            showMessage(`${savedProduct.codigo} registrado`, 'success');
            showMessage(`Entrada de ${formData.quantidade} para o item ${savedProduct.codigo}`, 'success');
        }
    } catch (error) {
        showMessage(error.message, 'error');
    }
};

// MODAL DE VISUALIZAÇÃO
window.viewProduct = function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    const detailsHtml = `
        <div class="view-detail-item">
            <div class="view-detail-label">Código</div>
            <div class="view-detail-value">${produto.codigo}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Modelo (Cód. Fornecedor)</div>
            <div class="view-detail-value">${produto.codigo_fornecedor}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">NCM</div>
            <div class="view-detail-value">${produto.ncm || '-'}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Marca</div>
            <div class="view-detail-value">${produto.marca}</div>
        </div>
        <div class="view-detail-item" style="grid-column: 1 / -1;">
            <div class="view-detail-label">Descrição</div>
            <div class="view-detail-value">${produto.descricao}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Unidade</div>
            <div class="view-detail-value">${produto.unidade || 'UN'}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Quantidade</div>
            <div class="view-detail-value">${produto.quantidade}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Valor Unitário</div>
            <div class="view-detail-value">R$ ${parseFloat(produto.valor_unitario).toFixed(2)}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Valor Total</div>
            <div class="view-detail-value">R$ ${(produto.quantidade * parseFloat(produto.valor_unitario)).toFixed(2)}</div>
        </div>
    `;

    document.getElementById('viewDetails').innerHTML = detailsHtml;
    document.getElementById('viewModal').classList.add('show');
};

window.closeViewModal = function() {
    document.getElementById('viewModal').classList.remove('show');
};

// MODAL DE ENTRADA
let entradaProductId = null;

window.openEntradaModal = function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    entradaProductId = id;
    document.getElementById('entradaProduto').textContent = `${produto.codigo} - ${produto.codigo_fornecedor}`;
    document.getElementById('entradaQuantidadeAtual').textContent = produto.quantidade;
    document.getElementById('entradaQuantidade').value = '';
    document.getElementById('entradaModal').classList.add('show');
};

window.closeEntradaModal = function() {
    document.getElementById('entradaModal').classList.remove('show');
    entradaProductId = null;
};

window.processarEntrada = async function(event) {
    event.preventDefault();
    
    const quantidade = parseInt(document.getElementById('entradaQuantidade').value);
    
    if (quantidade <= 0) {
        showMessage('Quantidade inválida', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/estoque/${entradaProductId}/movimentar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({
                tipo: 'entrada',
                quantidade: quantidade
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao processar entrada');
        }

        const produto = await response.json();
        
        await loadProducts();
        closeEntradaModal();
        showMessage(`Entrada de ${quantidade} para o item ${produto.codigo}`, 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    }
};

// MODAL DE SAÍDA
let saidaProductId = null;

window.openSaidaModal = function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    saidaProductId = id;
    document.getElementById('saidaProduto').textContent = `${produto.codigo} - ${produto.codigo_fornecedor}`;
    document.getElementById('saidaQuantidadeAtual').textContent = produto.quantidade;
    document.getElementById('saidaQuantidade').value = '';
    document.getElementById('saidaModal').classList.add('show');
};

window.closeSaidaModal = function() {
    document.getElementById('saidaModal').classList.remove('show');
    saidaProductId = null;
};

window.processarSaida = async function(event) {
    event.preventDefault();
    
    const quantidade = parseInt(document.getElementById('saidaQuantidade').value);
    
    if (quantidade <= 0) {
        showMessage('Quantidade inválida', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/estoque/${saidaProductId}/movimentar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({
                tipo: 'saida',
                quantidade: quantidade
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao processar saída');
        }

        const produto = await response.json();
        
        await loadProducts();
        closeSaidaModal();
        showMessage(`Saída de ${quantidade} para o item ${produto.codigo}`, 'error');
    } catch (error) {
        showMessage(error.message, 'error');
    }
};

// GERAR PDF ORGANIZADO POR MARCA
window.generateInventoryPDF = function() {
    if (produtos.length === 0) {
        showMessage('Nenhum produto para gerar relatório', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    // Título
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE ESTOQUE', 148, 15, { align: 'center' });

    // Data e hora
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const dataHora = new Date().toLocaleString('pt-BR');
    doc.text(`Gerado em: ${dataHora}`, 148, 22, { align: 'center' });

    // Organizar produtos por marca
    const produtosPorMarca = {};
    produtos.forEach(produto => {
        if (!produtosPorMarca[produto.marca]) {
            produtosPorMarca[produto.marca] = [];
        }
        produtosPorMarca[produto.marca].push(produto);
    });

    // Ordenar marcas alfabeticamente
    const marcasOrdenadas = Object.keys(produtosPorMarca).sort();

    let startY = 30;

    marcasOrdenadas.forEach((marca, index) => {
        // Verificar se precisa adicionar nova página
        if (startY > 180) {
            doc.addPage();
            startY = 15;
        }

        // Nome da marca
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(204, 112, 0); // Cor laranja
        doc.text(marca, 14, startY);
        startY += 8;

        // Ordenar produtos por código (crescente)
        const produtosOrdenados = produtosPorMarca[marca].sort((a, b) => {
            return parseInt(a.codigo) - parseInt(b.codigo);
        });

        // Preparar dados da tabela
        const tableData = produtosOrdenados.map(p => [
            p.codigo.toString(),
            p.codigo_fornecedor,
            p.ncm || '-',
            p.descricao,
            p.unidade || 'UN',
            p.quantidade.toString(),
            `R$ ${parseFloat(p.valor_unitario).toFixed(2)}`,
            `R$ ${(p.quantidade * parseFloat(p.valor_unitario)).toFixed(2)}`
        ]);

        // Adicionar tabela
        doc.autoTable({
            startY: startY,
            head: [['Código', 'Modelo', 'NCM', 'Descrição', 'Un.', 'Qtd', 'Valor Un.', 'Valor Total']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: [107, 114, 128],
                textColor: [255, 255, 255],
                fontSize: 9,
                fontStyle: 'bold'
            },
            bodyStyles: {
                fontSize: 8,
                textColor: [26, 26, 26]
            },
            alternateRowStyles: {
                fillColor: [250, 250, 250]
            },
            columnStyles: {
                0: { cellWidth: 20 },
                1: { cellWidth: 25 },
                2: { cellWidth: 20 },
                3: { cellWidth: 90 },
                4: { cellWidth: 15, halign: 'center' },
                5: { cellWidth: 18, halign: 'center' },
                6: { cellWidth: 25, halign: 'right' },
                7: { cellWidth: 30, halign: 'right' }
            },
            margin: { left: 14, right: 14 }
        });

        startY = doc.lastAutoTable.finalY + 12;
    });

    // Totais gerais na última página
    const valorTotalGeral = produtos.reduce((acc, p) => {
        return acc + (p.quantidade * parseFloat(p.valor_unitario));
    }, 0);

    const quantidadeTotalGeral = produtos.reduce((acc, p) => acc + p.quantidade, 0);

    if (startY > 170) {
        doc.addPage();
        startY = 15;
    }

    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('TOTAIS GERAIS:', 14, startY);
    startY += 8;

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Total de Produtos: ${produtos.length}`, 14, startY);
    startY += 6;
    doc.text(`Quantidade Total: ${quantidadeTotalGeral}`, 14, startY);
    startY += 6;
    doc.text(`Valor Total em Estoque: R$ ${valorTotalGeral.toFixed(2)}`, 14, startY);

    // Salvar PDF
    doc.save(`Relatorio_Estoque_${new Date().toISOString().split('T')[0]}.pdf`);
    showMessage('Relatório PDF gerado com sucesso!', 'success');
};

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
