require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3002;

// Configuração do Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Middleware de autenticação
const verificarSessao = async (req, res, next) => {
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    try {
        const { data: session, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('token', sessionToken)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (error || !session) {
            return res.status(401).json({ error: 'Sessão inválida ou expirada' });
        }

        req.userId = session.user_id;
        next();
    } catch (error) {
        console.error('Erro ao verificar sessão:', error);
        return res.status(401).json({ error: 'Erro de autenticação' });
    }
};

// =====================
// ROTAS DE ESTOQUE
// =====================

// GET - Listar todos os produtos do estoque
app.get('/api/estoque', verificarSessao, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('estoque')
            .select('*')
            .order('marca', { ascending: true })
            .order('codigo', { ascending: true });

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Erro ao buscar estoque:', error);
        res.status(500).json({ error: 'Erro ao buscar estoque' });
    }
});

// HEAD - Verificar status do servidor
app.head('/api/estoque', verificarSessao, (req, res) => {
    res.status(200).end();
});

// GET - Buscar produto específico
app.get('/api/estoque/:id', verificarSessao, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('estoque')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Produto não encontrado' });

        res.json(data);
    } catch (error) {
        console.error('Erro ao buscar produto:', error);
        res.status(500).json({ error: 'Erro ao buscar produto' });
    }
});

// POST - Criar novo produto
app.post('/api/estoque', verificarSessao, async (req, res) => {
    try {
        const { codigo_fornecedor, marca, descricao, quantidade, valor_unitario } = req.body;

        // Validações
        if (!codigo_fornecedor || !marca || !descricao || quantidade === undefined || valor_unitario === undefined) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        // Verificar se código do fornecedor já existe
        const { data: existing } = await supabase
            .from('estoque')
            .select('id')
            .eq('codigo_fornecedor', codigo_fornecedor)
            .single();

        if (existing) {
            return res.status(400).json({ error: 'Código do fornecedor já cadastrado' });
        }

        // Obter próximo código de estoque
        const { data: maxData } = await supabase
            .from('estoque')
            .select('codigo')
            .order('codigo', { ascending: false })
            .limit(1)
            .single();

        const proximoCodigo = maxData ? maxData.codigo + 1 : 1;

        const novoProduto = {
            codigo: proximoCodigo,
            codigo_fornecedor: codigo_fornecedor.trim(),
            marca: marca.trim().toUpperCase(),
            descricao: descricao.trim().toUpperCase(),
            quantidade: parseInt(quantidade),
            valor_unitario: parseFloat(valor_unitario),
            timestamp: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('estoque')
            .insert([novoProduto])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json(data);
    } catch (error) {
        console.error('Erro ao criar produto:', error);
        res.status(500).json({ error: 'Erro ao criar produto' });
    }
});

// PUT - Atualizar produto
app.put('/api/estoque/:id', verificarSessao, async (req, res) => {
    try {
        const { codigo_fornecedor, descricao, valor_unitario } = req.body;

        const dadosAtualizados = {
            codigo_fornecedor: codigo_fornecedor.trim(),
            descricao: descricao.trim().toUpperCase(),
            valor_unitario: parseFloat(valor_unitario),
            timestamp: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('estoque')
            .update(dadosAtualizados)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Produto não encontrado' });

        res.json(data);
    } catch (error) {
        console.error('Erro ao atualizar produto:', error);
        res.status(500).json({ error: 'Erro ao atualizar produto' });
    }
});

// POST - Movimentação de estoque (entrada/saída)
app.post('/api/estoque/:id/movimentar', verificarSessao, async (req, res) => {
    try {
        const { tipo, quantidade } = req.body;

        if (!['entrada', 'saida'].includes(tipo) || !quantidade || quantidade <= 0) {
            return res.status(400).json({ error: 'Dados inválidos' });
        }

        // Buscar produto atual
        const { data: produto, error: fetchError } = await supabase
            .from('estoque')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchError) throw fetchError;
        if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

        // Calcular nova quantidade
        let novaQuantidade = produto.quantidade;
        if (tipo === 'entrada') {
            novaQuantidade += parseInt(quantidade);
        } else {
            if (produto.quantidade < parseInt(quantidade)) {
                return res.status(400).json({ error: 'Quantidade insuficiente em estoque' });
            }
            novaQuantidade -= parseInt(quantidade);
        }

        // Atualizar quantidade
        const { data, error } = await supabase
            .from('estoque')
            .update({
                quantidade: novaQuantidade,
                timestamp: new Date().toISOString()
            })
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) throw error;

        res.json(data);
    } catch (error) {
        console.error('Erro ao movimentar estoque:', error);
        res.status(500).json({ error: 'Erro ao movimentar estoque' });
    }
});

// DELETE - Excluir produto
app.delete('/api/estoque/:id', verificarSessao, async (req, res) => {
    try {
        const { error } = await supabase
            .from('estoque')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;

        res.json({ message: 'Produto excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir produto:', error);
        res.status(500).json({ error: 'Erro ao excluir produto' });
    }
});

// Rota de health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`📊 API de Estoque disponível em http://localhost:${PORT}/api/estoque`);
});
