const PORTAL_URL = 'https://ir-comercio-portal-zcan.onrender.com';
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3002/api'
    : `${window.location.origin}/api`;

let produtos = [];
let entradas = [];
let saidas = [];
let isOnline = false;
let marcaSelecionada = 'TODAS';
let marcasDisponiveis = new Set();
let lastDataHash = '';
let sessionToken = null;
let autoSyncEnabled = true;
let editingProductId = null;
let currentProductForMovement = null;

console.log('🚀 Estoque iniciado');
console.log('📍 API URL:', API_URL);

// Função para formatar valores monetários no padrão brasileiro
function formatarMoeda(valor) {
    return parseFloat(valor).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

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
            await loadMovements();
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

async function loadMovements() {
    if (!isOnline) return;
    
    try {
        const response = await fetch(`${API_URL}/estoque/movimentos`, {
            headers: {
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            entradas = data.entradas || [];
            saidas = data.saidas || [];
        }
    } catch (error) {
        console.error('Erro ao carregar movimentos:', error);
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
        await loadMovements();
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
            <td>R$ ${formatarMoeda(p.valor_unitario)}</td>
            <td><strong>R$ ${formatarMoeda(p.quantidade * parseFloat(p.valor_unitario))}</strong></td>
            <td class="actions-cell">
                <button onclick="viewProduct('${p.id}')" class="action-btn view">Ver</button>
                <button onclick="editProduct('${p.id}')" class="action-btn edit">Editar</button>
                <button onclick="openEntradaModal('${p.id}')" class="action-btn success">Entrada</button>
                <button onclick="openSaidaModal('${p.id}')" class="action-btn danger">Saída</button>
            </td>
        </tr>
    `).join('');
}

// MODAL E FORMULÁRIO
window.toggleForm = function() {
    editingProductId = null;
    document.getElementById('formTitle').textContent = 'Novo Produto';
    document.getElementById('productForm').reset();
    document.getElementById('unidade').value = 'UN';
    switchTab('fornecedor');
    document.getElementById('formModal').classList.add('show');
};

window.closeFormModal = function() {
    document.getElementById('formModal').classList.remove('show');
    editingProductId = null;
};

window.cancelFormModal = function() {
    closeFormModal();
    showMessage('Cadastro cancelado', 'error');
};

window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
};

window.viewProduct = function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    document.getElementById('view-codigo').textContent = produto.codigo;
    document.getElementById('view-modelo').textContent = produto.codigo_fornecedor;
    document.getElementById('view-ncm').textContent = produto.ncm || '-';
    document.getElementById('view-marca').textContent = produto.marca;
    document.getElementById('view-descricao').textContent = produto.descricao;
    document.getElementById('view-unidade').textContent = produto.unidade || 'UN';
    document.getElementById('view-quantidade').textContent = produto.quantidade;
    document.getElementById('view-valor-unitario').textContent = `R$ ${formatarMoeda(produto.valor_unitario)}`;
    document.getElementById('view-valor-total').textContent = `R$ ${formatarMoeda(produto.quantidade * parseFloat(produto.valor_unitario))}`;
    
    document.getElementById('viewModal').classList.add('show');
};

window.closeViewModal = function() {
    document.getElementById('viewModal').classList.remove('show');
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
    document.getElementById('unidade').value = produto.unidade || 'UN';
    document.getElementById('quantidade').value = produto.quantidade;
    document.getElementById('valor_unitario').value = formatarMoeda(produto.valor_unitario);
    
    switchTab('fornecedor');
    document.getElementById('formModal').classList.add('show');
};

window.saveProduct = async function(event) {
    event.preventDefault();

    const valorUnitarioInput = document.getElementById('valor_unitario').value.trim();
    const valorUnitario = parseFloat(valorUnitarioInput.replace(/\./g, '').replace(',', '.'));

    const formData = {
        codigo_fornecedor: document.getElementById('codigo_fornecedor').value.trim(),
        ncm: document.getElementById('ncm').value.trim(),
        marca: document.getElementById('marca').value.trim(),
        descricao: document.getElementById('descricao').value.trim(),
        unidade: document.getElementById('unidade').value,
        quantidade: parseInt(document.getElementById('quantidade').value),
        valor_unitario: valorUnitario
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

        const result = await response.json();
        
        await loadProducts();
        await loadMovements();
        closeFormModal();
        
        if (!editingProductId) {
            showMessage(`Entrada de ${formData.quantidade} para o item ${result.codigo}`, 'success');
        } else {
            showMessage('Produto atualizado', 'success');
        }
    } catch (error) {
        showMessage(error.message, 'error');
    }
};

// MODAL DE ENTRADA
window.openEntradaModal = function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    currentProductForMovement = produto;
    document.getElementById('entrada-produto-info').value = `${produto.codigo} - ${produto.codigo_fornecedor} - ${produto.marca}`;
    document.getElementById('entrada-quantidade').value = '';
    document.getElementById('entradaModal').classList.add('show');
};

window.closeEntradaModal = function() {
    document.getElementById('entradaModal').classList.remove('show');
    currentProductForMovement = null;
};

window.cancelEntradaModal = function() {
    closeEntradaModal();
};

window.saveEntrada = async function(event) {
    event.preventDefault();
    
    if (!currentProductForMovement) return;
    
    const quantidade = parseInt(document.getElementById('entrada-quantidade').value);
    
    try {
        const response = await fetch(`${API_URL}/estoque/${currentProductForMovement.id}/entrada`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({ quantidade })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao registrar entrada');
        }

        await loadProducts();
        await loadMovements();
        closeEntradaModal();
        showMessage(`Entrada de ${quantidade} para o item ${currentProductForMovement.codigo}`, 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    }
};

// MODAL DE SAÍDA
window.openSaidaModal = function(id) {
    const produto = produtos.find(p => p.id === id);
    if (!produto) return;

    currentProductForMovement = produto;
    document.getElementById('saida-produto-info').value = `${produto.codigo} - ${produto.codigo_fornecedor} - ${produto.marca}`;
    document.getElementById('saida-quantidade').value = '';
    document.getElementById('saida-qtd-disponivel').textContent = produto.quantidade;
    document.getElementById('saidaModal').classList.add('show');
};

window.closeSaidaModal = function() {
    document.getElementById('saidaModal').classList.remove('show');
    currentProductForMovement = null;
};

window.cancelSaidaModal = function() {
    closeSaidaModal();
};

window.saveSaida = async function(event) {
    event.preventDefault();
    
    if (!currentProductForMovement) return;
    
    const quantidade = parseInt(document.getElementById('saida-quantidade').value);
    
    if (quantidade > currentProductForMovement.quantidade) {
        showMessage('Quantidade insuficiente em estoque', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/estoque/${currentProductForMovement.id}/saida`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({ quantidade })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao registrar saída');
        }

        await loadProducts();
        await loadMovements();
        closeSaidaModal();
        showMessage(`Saída de ${quantidade} para o item ${currentProductForMovement.codigo}`, 'error');
    } catch (error) {
        showMessage(error.message, 'error');
    }
};

// MODAL DE PDF
window.openPdfModal = function() {
    document.getElementById('pdfModal').classList.add('show');
};

window.closePdfModal = function() {
    document.getElementById('pdfModal').classList.remove('show');
};

// GERAÇÃO DE PDFs
window.generatePDF = function(tipo) {
    closePdfModal();
    
    if (tipo === 'estoque') {
        generateEstoquePDF();
    } else if (tipo === 'entradas') {
        generateEntradasPDF();
    } else if (tipo === 'saidas') {
        generateSaidasPDF();
    }
};

function generateEstoquePDF() {
    let produtosFiltrados = produtos;
    
    if (marcaSelecionada !== 'TODAS') {
        produtosFiltrados = produtos.filter(p => p.marca === marcaSelecionada);
    }
    
    if (produtosFiltrados.length === 0) {
        showMessage('Nenhum produto para gerar relatório', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE ESTOQUE', 148, 15, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const dataHora = new Date().toLocaleString('pt-BR');
    doc.text(`Gerado em: ${dataHora}`, 148, 22, { align: 'center' });

    if (marcaSelecionada !== 'TODAS') {
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(204, 112, 0);
        doc.text(marcaSelecionada, 148, 30, { align: 'center' });
        
        const produtosOrdenados = produtosFiltrados.sort((a, b) => parseInt(a.codigo) - parseInt(b.codigo));
        
        const tableData = produtosOrdenados.map(p => [
            p.codigo.toString(),
            p.codigo_fornecedor,
            p.ncm || '-',
            p.descricao,
            p.unidade || 'UN',
            p.quantidade.toString(),
            `R$ ${formatarMoeda(p.valor_unitario)}`,
            `R$ ${formatarMoeda(p.quantidade * parseFloat(p.valor_unitario))}`
        ]);

        doc.autoTable({
            startY: 38,
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
                0: { cellWidth: 18 },
                1: { cellWidth: 28 },
                2: { cellWidth: 22 },
                3: { cellWidth: 90 },
                4: { cellWidth: 15, halign: 'center' },
                5: { cellWidth: 18, halign: 'center' },
                6: { cellWidth: 25, halign: 'right' },
                7: { cellWidth: 28, halign: 'right' }
            },
            margin: { left: 14, right: 14 }
        });
    } else {
        const produtosPorMarca = {};
        produtosFiltrados.forEach(produto => {
            if (!produtosPorMarca[produto.marca]) {
                produtosPorMarca[produto.marca] = [];
            }
            produtosPorMarca[produto.marca].push(produto);
        });

        const marcasOrdenadas = Object.keys(produtosPorMarca).sort();
        let startY = 30;

        marcasOrdenadas.forEach((marca) => {
            if (startY > 180) {
                doc.addPage();
                startY = 15;
            }

            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(204, 112, 0);
            doc.text(marca, 14, startY);
            startY += 8;

            const produtosOrdenados = produtosPorMarca[marca].sort((a, b) => parseInt(a.codigo) - parseInt(b.codigo));

            const tableData = produtosOrdenados.map(p => [
                p.codigo.toString(),
                p.codigo_fornecedor,
                p.ncm || '-',
                p.descricao,
                p.unidade || 'UN',
                p.quantidade.toString(),
                `R$ ${formatarMoeda(p.valor_unitario)}`,
                `R$ ${formatarMoeda(p.quantidade * parseFloat(p.valor_unitario))}`
            ]);

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
                    0: { cellWidth: 18 },
                    1: { cellWidth: 28 },
                    2: { cellWidth: 22 },
                    3: { cellWidth: 90 },
                    4: { cellWidth: 15, halign: 'center' },
                    5: { cellWidth: 18, halign: 'center' },
                    6: { cellWidth: 25, halign: 'right' },
                    7: { cellWidth: 28, halign: 'right' }
                },
                margin: { left: 14, right: 14 }
            });

            startY = doc.lastAutoTable.finalY + 12;
        });
    }

    const valorTotalGeral = produtosFiltrados.reduce((acc, p) => acc + (p.quantidade * parseFloat(p.valor_unitario)), 0);
    const quantidadeTotalGeral = produtosFiltrados.reduce((acc, p) => acc + p.quantidade, 0);

    let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 30;
    if (finalY > 170) {
        doc.addPage();
        finalY = 15;
    }

    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('TOTAIS:', 14, finalY + 10);
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Total de Produtos: ${produtosFiltrados.length}`, 14, finalY + 18);
    doc.text(`Quantidade Total: ${quantidadeTotalGeral}`, 14, finalY + 24);
    doc.text(`Valor Total em Estoque: R$ ${formatarMoeda(valorTotalGeral)}`, 14, finalY + 30);

    doc.save(`Estoque_${marcaSelecionada}_${new Date().toISOString().split('T')[0]}.pdf`);
    showMessage('Relatório PDF gerado com sucesso!', 'success');
}

function generateEntradasPDF() {
    let entradasFiltradas = entradas;
    
    if (marcaSelecionada !== 'TODAS') {
        entradasFiltradas = entradas.filter(e => {
            const produto = produtos.find(p => p.id === e.produto_id);
            return produto && produto.marca === marcaSelecionada;
        });
    }
    
    if (entradasFiltradas.length === 0) {
        showMessage('Nenhuma entrada para gerar relatório', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE ENTRADAS', 148, 15, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const dataHora = new Date().toLocaleString('pt-BR');
    doc.text(`Gerado em: ${dataHora}`, 148, 22, { align: 'center' });
    
    if (marcaSelecionada !== 'TODAS') {
        doc.setFontSize(12);
        doc.text(`Marca: ${marcaSelecionada}`, 148, 28, { align: 'center' });
    }

    const entradasPorMes = {};
    entradasFiltradas.forEach(entrada => {
        const produto = produtos.find(p => p.id === entrada.produto_id);
        if (!produto) return;
        
        const data = new Date(entrada.data);
        const mesAno = data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const mesAnoCapitalizado = mesAno.charAt(0).toUpperCase() + mesAno.slice(1);
        
        if (!entradasPorMes[mesAnoCapitalizado]) {
            entradasPorMes[mesAnoCapitalizado] = [];
        }
        
        entradasPorMes[mesAnoCapitalizado].push({
            codigo: produto.codigo,
            modelo: produto.codigo_fornecedor,
            marca: produto.marca,
            quantidade: entrada.quantidade,
            data: data.toLocaleString('pt-BR')
        });
    });

    const mesesOrdenados = Object.keys(entradasPorMes).sort((a, b) => {
        const dateA = new Date(a.split(' de ')[1] + ' ' + a.split(' de ')[0]);
        const dateB = new Date(b.split(' de ')[1] + ' ' + b.split(' de ')[0]);
        return dateB - dateA;
    });

    let startY = marcaSelecionada !== 'TODAS' ? 35 : 30;

    mesesOrdenados.forEach((mes) => {
        if (startY > 180) {
            doc.addPage();
            startY = 15;
        }

        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(34, 197, 94);
        doc.text(mes, 14, startY);
        startY += 8;

        const tableData = entradasPorMes[mes].map(e => [
            e.codigo.toString(),
            e.modelo,
            e.marca,
            e.quantidade.toString(),
            e.data
        ]);

        const columns = marcaSelecionada !== 'TODAS' 
            ? ['Código', 'Modelo', 'Marca', 'Qtd', 'Data']
            : ['Código', 'Modelo', 'Qtd', 'Data'];
        
        const columnStyles = marcaSelecionada !== 'TODAS'
            ? {
                0: { cellWidth: 25 },
                1: { cellWidth: 70 },
                2: { cellWidth: 60 },
                3: { cellWidth: 25, halign: 'center' },
                4: { cellWidth: 70 }
            }
            : {
                0: { cellWidth: 30 },
                1: { cellWidth: 100 },
                2: { cellWidth: 30, halign: 'center' },
                3: { cellWidth: 90 }
            };

        doc.autoTable({
            startY: startY,
            head: [columns],
            body: marcaSelecionada !== 'TODAS' ? tableData : tableData.map(row => [row[0], row[1], row[3], row[4]]),
            theme: 'grid',
            headStyles: {
                fillColor: [34, 197, 94],
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
            columnStyles: columnStyles,
            margin: { left: 14, right: 14 }
        });

        startY = doc.lastAutoTable.finalY + 12;
    });

    const totalEntradas = entradasFiltradas.reduce((acc, e) => acc + e.quantidade, 0);

    let finalY = doc.lastAutoTable.finalY;
    if (finalY > 170) {
        doc.addPage();
        finalY = 15;
    }

    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`TOTAL DE ENTRADAS: ${totalEntradas}`, 14, finalY + 10);

    doc.save(`Entradas_${marcaSelecionada}_${new Date().toISOString().split('T')[0]}.pdf`);
    showMessage('Relatório de Entradas gerado com sucesso!', 'success');
}

function generateSaidasPDF() {
    let saidasFiltradas = saidas;
    
    if (marcaSelecionada !== 'TODAS') {
        saidasFiltradas = saidas.filter(s => {
            const produto = produtos.find(p => p.id === s.produto_id);
            return produto && produto.marca === marcaSelecionada;
        });
    }
    
    if (saidasFiltradas.length === 0) {
        showMessage('Nenhuma saída para gerar relatório', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE SAÍDAS', 148, 15, { align: 'center' });

    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const dataHora = new Date().toLocaleString('pt-BR');
    doc.text(`Gerado em: ${dataHora}`, 148, 22, { align: 'center' });
    
    if (marcaSelecionada !== 'TODAS') {
        doc.setFontSize(12);
        doc.text(`Marca: ${marcaSelecionada}`, 148, 28, { align: 'center' });
    }

    const saidasPorMes = {};
    saidasFiltradas.forEach(saida => {
        const produto = produtos.find(p => p.id === saida.produto_id);
        if (!produto) return;
        
        const data = new Date(saida.data);
        const mesAno = data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const mesAnoCapitalizado = mesAno.charAt(0).toUpperCase() + mesAno.slice(1);
        
        if (!saidasPorMes[mesAnoCapitalizado]) {
            saidasPorMes[mesAnoCapitalizado] = [];
        }
        
        saidasPorMes[mesAnoCapitalizado].push({
            codigo: produto.codigo,
            modelo: produto.codigo_fornecedor,
            marca: produto.marca,
            quantidade: saida.quantidade,
            data: data.toLocaleString('pt-BR')
        });
    });

    const mesesOrdenados = Object.keys(saidasPorMes).sort((a, b) => {
        const dateA = new Date(a.split(' de ')[1] + ' ' + a.split(' de ')[0]);
        const dateB = new Date(b.split(' de ')[1] + ' ' + b.split(' de ')[0]);
        return dateB - dateA;
    });

    let startY = marcaSelecionada !== 'TODAS' ? 35 : 30;

    mesesOrdenados.forEach((mes) => {
        if (startY > 180) {
            doc.addPage();
            startY = 15;
        }

        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(239, 68, 68);
        doc.text(mes, 14, startY);
        startY += 8;

        const tableData = saidasPorMes[mes].map(s => [
            s.codigo.toString(),
            s.modelo,
            s.marca,
            s.quantidade.toString(),
            s.data
        ]);

        const columns = marcaSelecionada !== 'TODAS' 
            ? ['Código', 'Modelo', 'Marca', 'Qtd', 'Data']
            : ['Código', 'Modelo', 'Qtd', 'Data'];
        
        const columnStyles = marcaSelecionada !== 'TODAS'
            ? {
                0: { cellWidth: 25 },
                1: { cellWidth: 70 },
                2: { cellWidth: 60 },
                3: { cellWidth: 25, halign: 'center' },
                4: { cellWidth: 70 }
            }
            : {
                0: { cellWidth: 30 },
                1: { cellWidth: 100 },
                2: { cellWidth: 30, halign: 'center' },
                3: { cellWidth: 90 }
            };

        doc.autoTable({
            startY: startY,
            head: [columns],
            body: marcaSelecionada !== 'TODAS' ? tableData : tableData.map(row => [row[0], row[1], row[3], row[4]]),
            theme: 'grid',
            headStyles: {
                fillColor: [239, 68, 68],
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
            columnStyles: columnStyles,
            margin: { left: 14, right: 14 }
        });

        startY = doc.lastAutoTable.finalY + 12;
    });

    const totalSaidas = saidasFiltradas.reduce((acc, s) => acc + s.quantidade, 0);

    let finalY = doc.lastAutoTable.finalY;
    if (finalY > 170) {
        doc.addPage();
        finalY = 15;
    }

    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`TOTAL DE SAÍDAS: ${totalSaidas}`, 14, finalY + 10);

    doc.save(`Saidas_${marcaSelecionada}_${new Date().toISOString().split('T')[0]}.pdf`);
    showMessage('Relatório de Saídas gerado com sucesso!', 'success');
}

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
