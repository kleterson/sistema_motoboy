const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do Banco de Dados SQLite (arquivo local persistente no Render)
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
        senha TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS lancamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        tipo TEXT,
        categoria TEXT,
        valor REAL,
        descricao TEXT,
        data_lancamento TEXT,
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'motoboy_secret_key_99',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 dia
}));

// Rotas de Autenticação
app.post('/api/auth', async (req, res) => {
    const { acao, nome, email, senha } = req.body;

    if (acao === 'cadastrar') {
        if (!nome || !email || !senha) return res.json({ sucesso: false, mensagem: 'Preencha todos os campos.' });
        
        db.get(`SELECT id FROM usuarios WHERE email = ?`, [email], async (err, row) => {
            if (row) return res.json({ sucesso: false, mensagem: 'Este e-mail já está cadastrado!' });

            const hash = await bcrypt.hash(senha, 10);
            db.run(`INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)`, [nome, email, hash], function(err) {
                if (err) return res.json({ sucesso: false, mensagem: 'Erro ao cadastrar.' });
                res.json({ sucesso: true, mensagem: 'Cadastro realizado com sucesso! Faça login.' });
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

app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.usuario_id) {
        res.json({ logado: true, nome: req.session.usuario_nome, id: req.session.usuario_id });
    } else {
        res.json({ logado: false });
    }
});

// Rotas de Dados Financeiros
app.get('/api/dados', (req, res) => {
    if (!req.session.usuario_id) return res.status(401).json({ erro: 'Não autorizado' });
    const user_id = req.session.usuario_id;

    const hoje = new Date().toISOString().split('T')[0];
    
    // Datas de inicio e fim da semana/mes atual simplificadas
    const now = new Date();
    const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 1)).toISOString().split('T')[0];
    const lastDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 7)).toISOString().split('T')[0];
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 2).toISOString().slice(0, 8) + '01';
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0];

    // Queries consolidadas
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
    const { tipo, categoria, valor, descricao, data_lancamento } = req.body;
    const user_id = req.session.usuario_id;

    const valorNum = parseFloat(valor.replace(',', '.'));
    if (valorNum > 0 && data_lancamento) {
        db.run(`INSERT INTO lancamentos (usuario_id, tipo, categoria, valor, descricao, data_lancamento) VALUES (?, ?, ?, ?, ?, ?)`,
            [user_id, tipo, categoria, valorNum, descricao, data_lancamento], (err) => {
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