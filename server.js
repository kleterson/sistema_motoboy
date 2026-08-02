const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Banco de Dados SQLite
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('Erro ao abrir o banco de dados', err.message);
    else console.log('Conectado ao banco de dados SQLite.');
});

// Criar tabelas se não existirem
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        email TEXT UNIQUE,
        senha TEXT,
        status_assinatura TEXT DEFAULT 'teste',
        data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP,
        data_expiracao DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS lancamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        tipo TEXT,
        categoria TEXT,
        valor REAL,
        descricao TEXT,
        forma_pagamento TEXT, 
        km_rodado REAL, 
        data_lancamento TEXT,
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'PUBLIC')));

app.use(session({
    secret: 'motoboy_secret_key_99',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 dia
}));

// Rota explícita para garantir a página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'PUBLIC', 'index.html'));
});

// Rotas de Autenticação e Cadastro com 3 dias de Teste Grátis
app.post('/api/auth', async (req, res) => {
    const { acao, nome, email, senha } = req.body;

    if (acao === 'cadastrar') {
        if (!nome || !email || !senha) return res.json({ sucesso: false, mensagem: 'Preencha todos os campos.' });
        
        db.get(`SELECT id FROM usuarios WHERE email = ?`, [email], async (err, row) => {
            if (row) return res.json({ sucesso: false, mensagem: 'Este e-mail já está cadastrado!' });

            const hash = await bcrypt.hash(senha, 10);
            
            // Calcula 3 dias a frente para o teste gratuito (usando milissegundos)
            const dataExpiracao = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

            db.run(`INSERT INTO usuarios (nome, email, senha, status_assinatura, data_expiracao) VALUES (?, ?, ?, 'teste', ?)`, 
                [nome, email, hash, dataExpiracao], function(err) {
                if (err) return res.json({ sucesso: false, mensagem: 'Erro ao cadastrar.' });
                res.json({ sucesso: true, mensagem: 'Cadastro realizado! Você ganhou 3 dias de teste grátis.' });
            });
        });
    } else if (acao === 'login') {
        if (!email || !senha) return res.json({ sucesso: false, mensagem: 'Preencha todos os campos.' });

        db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], async (err, usuario) => {
            if (!usuario) return res.json({ sucesso: false, mensagem: 'E-mail ou senha incorretos!' });

            const match = await bcrypt.compare(senha, usuario.senha);
            if (match) {
                req.session.usuario_id = usuario.id;
                req.session.usuario_nome = usuario.nome;
                res.json({ sucesso: true });
            } else {
                res.json({ sucesso: false, mensagem: 'E-mail ou senha incorretos!' });
            }
        });
    }
});

// Webhook de pagamento para liberar +30 dias automaticamente
app.post('/api/webhook-pagamento', (req, res) => {
    const dadosPagamento = req.body;

    if (dadosPagamento.status === 'approved') {
        const emailCliente = dadosPagamento.email; 
        
        // Adiciona 30 dias a partir de agora
        const novaExpiracao = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        db.run(`UPDATE usuarios SET status_assinatura = 'ativo', data_expiracao = ? WHERE email = ?`, 
            [novaExpiracao, emailCliente], (err) => {
                if (!err) {
                    console.log('Pagamento aprovado! Assinatura renovada por 30 dias.');
                }
            });
    }
    res.status(200).send('OK');
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.usuario_id) {
        db.get(`SELECT status_assinatura, data_expiracao FROM usuarios WHERE id = ?`, [req.session.usuario_id], (err, row) => {
            res.json({ 
                logado: true, 
                nome: req.session.usuario_nome, 
                id: req.session.usuario_id,
                status_assinatura: row?.status_assinatura,
                data_expiracao: row?.data_expiracao
            });
        });
    } else {
        res.json({ logado: false });
    }
});

// Rotas de Dados Financeiros
app.get('/api/dados', (req, res) => {
    if (!req.session.usuario_id) return res.status(401).json({ erro: 'Não autorizado' });
    const user_id = req.session.usuario_id;

    const agora = new Date();
    const hoje = agora.toISOString().split('T')[0];
    
    const diaDaSemana = agora.getDay();
    const diffParaSegunda = agora.getDate() - diaDaSemana + (diaDaSemana === 0 ? -6 : 1);
    
    const primeiraSegunda = new Date(new Date().setDate(diffParaSegunda));
    const firstDayOfWeek = primeiraSegunda.toISOString().split('T')[0];
    
    const ultimoDomingo = new Date(primeiraSegunda);
    ultimoDomingo.setDate(primeiraSegunda.getDate() + 6);
    const lastDayOfWeek = ultimoDomingo.toISOString().split('T')[0];

    const firstDayOfMonth = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString().split('T')[0];
    const lastDayOfMonth = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).toISOString().split('T')[0];

    db.get(`SELECT SUM(CASE WHEN tipo='ganho' THEN valor ELSE -valor END) as total FROM lancamentos WHERE usuario_id = ? AND data_lancamento = ?`, [user_id, hoje], (err, rowHoje) => {
        db.get(`SELECT SUM(CASE WHEN tipo='ganho' THEN valor ELSE 0 END) as ganhos, SUM(CASE WHEN tipo='gasto' THEN valor ELSE 0 END) as gastos FROM lancamentos WHERE usuario_id = ? AND data_lancamento BETWEEN ? AND ?`, [user_id, firstDayOfWeek, lastDayOfWeek], (err, rowSemana) => {
            db.get(`SELECT SUM(CASE WHEN tipo='ganho' THEN valor ELSE 0 END) as ganhos, SUM(CASE WHEN tipo='gasto' THEN valor ELSE 0 END) as gastos FROM lancamentos WHERE usuario_id = ? AND data_lancamento BETWEEN ? AND ?`, [user_id, firstDayOfMonth, lastDayOfMonth], (err, rowMes) => {
                db.all(`SELECT * FROM lancamentos WHERE usuario_id = ? ORDER BY data_lancamento DESC, id DESC LIMIT 20`, [user_id], (err, historico) => {
                    res.json({
                        saldo_hoje: rowHoje?.total || 0,
                        ganhos_semana: rowSemana?.ganhos || 0,
                        gastos_semana: rowSemana?.gastos || 0,
                        ganhos_mes: rowMes?.ganhos || 0,
                        gastos_mes: rowMes?.gastos || 0,
                        historico: historico || []
                    });
                });
            });
        });
    });
});

app.post('/api/lancamentos', (req, res) => {
    if (!req.session.usuario_id) return res.status(401).json({ erro: 'Não autorizado' });
    
    const { tipo, categoria, valor, descricao, forma_pagamento, km_rodado, data_lancamento } = req.body;
    const user_id = req.session.usuario_id;

    const valorNum = parseFloat(valor.replace(',', '.'));
    const kmNum = km_rodado ? parseFloat(km_rodado.replace(',', '.')) : 0; 

    if (valorNum > 0 && data_lancamento) {
        const query = `
            INSERT INTO lancamentos (usuario_id, tipo, categoria, valor, descricao, forma_pagamento, km_rodado, data_lancamento) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(query, [user_id, tipo, categoria, valorNum, descricao, forma_pagamento, kmNum, data_lancamento], (err) => {
            res.json({ sucesso: !err });
        });
    } else {
        res.json({ sucesso: false });
    }
});

app.delete('/api/lancamentos/:id', (req, res) => {
    if (!req.session.usuario_id) return res.status(401).json({ erro: 'Não autorizado' });
    db.run(`DELETE FROM lancamentos WHERE id = ? AND usuario_id = ?`, [req.params.id, req.session.usuario_id], (err) => {
        res.json({ sucesso: !err });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});