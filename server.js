const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
// Porta dinâmica exigida pelo Render, com fallback para 3000 localmente
const PORT = process.env.PORT || 3000;

// Configuração do banco de dados SQLite
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erro ao abrir o banco de dados', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        email TEXT UNIQUE,
        senha TEXT,
        data_expiracao DATETIME,
        ip_cadastro TEXT
    )`);
    // ... resto das tabelas
});
// Criar tabelas necessárias se não existirem
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        email TEXT UNIQUE,
        senha TEXT,
        data_expiracao DATETIME
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
app.use(session({
    secret: 'motoboy_secret_key_99food',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Mude para true se usar HTTPS estrito no Render (opcional)
}));

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Rota para verificar sessão atual
app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        db.get(`SELECT * FROM usuarios WHERE id = ?`, [req.session.userId], (err, usuario) => {
            if (err || !usuario) {
                return res.json({ logado: false });
            }
            res.json({
                logado: true,
                nome: usuario.nome,
                email: usuario.email,
                data_expiracao: usuario.data_expiracao
            });
        });
    } else {
        res.json({ logado: false });
    }
});

// Rota de Cadastro e Login
app.post('/api/auth', async (req, res) => {
    const { acao, nome, email, senha } = req.body;

    if (acao === 'cadastrar') {
        try {
            const senhaHash = await bcrypt.hash(senha, 10);
            
            // Define data de expiração para 3 dias a partir de agora
            const dataExpiracao = new Date();
            dataExpiracao.setDate(dataExpiracao.getDate() + 3);

            db.run(`INSERT INTO usuarios (nome, email, senha, data_expiracao) VALUES (?, ?, ?, ?)`,
                [nome, email, senhaHash, dataExpiracao.toISOString()],
                function(err) {
                    if (err) {
                        return res.json({ sucesso: false, mensagem: 'E-mail já cadastrado ou inválido!' });
                    }
                    res.json({ sucesso: true, mensagem: 'Cadastro realizado com sucesso! Você ganhou 3 dias de teste grátis.' });
                }
            );
        } catch (e) {
            res.json({ sucesso: false, mensagem: 'Erro interno no servidor.' });
        }
    } else if (acao === 'login') {
        db.get(`SELECT * FROM usuarios WHERE email = ?`, [email], async (err, usuario) => {
            if (err || !usuario) {
                return res.json({ sucesso: false, mensagem: 'E-mail ou senha incorretos!' });
            }

            const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
            if (!senhaCorreta) {
                return res.json({ sucesso: false, mensagem: 'E-mail ou senha incorretos!' });
            }

            req.session.userId = usuario.id;
            res.json({ sucesso: true });
        });
    }
});

// Rota de Logout
app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Rota para buscar dados do dashboard (Lançamentos e Resumos)
app.get('/api/dados', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ erro: 'Não autorizado' });

    const userId = req.session.userId;
    const hoje = new Date().toISOString().split('T')[0];

    db.all(`SELECT * FROM lancamentos WHERE usuario_id = ? ORDER BY data_lancamento DESC, id DESC`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ erro: 'Erro ao buscar dados' });

        let saldo_hoje = 0;
        let ganhos_semana = 0;
        let gastos_semana = 0;
        let ganhos_mes = 0;
        let gastos_mes = 0;

        const mesAtual = hoje.substring(0, 7); // YYYY-MM

        rows.forEach(item => {
            // Lançamentos de hoje
            if (item.data_lancamento === hoje) {
                if (item.tipo === 'ganho') saldo_hoje += item.valor;
                if (item.tipo === 'gasto') saldo_hoje -= item.valor;
            }

            // Mês atual
            if (item.data_lancamento.startsWith(mesAtual)) {
                if (item.tipo === 'ganho') ganhos_mes += item.valor;
                if (item.tipo === 'gasto') gastos_mes += item.valor;
            }

            // Simplificação para semana (considerando os últimos 7 dias ou mês atual - ajuste conforme preferência)
            if (item.tipo === 'ganho') ganhos_semana += item.valor; // Ajuste simplificado de demonstração
            if (item.tipo === 'gasto') gastos_semana += item.valor;
        });

        res.json({
            saldo_hoje,
            ganhos_semana,
            gastos_semana,
            ganhos_mes,
            gastos_mes,
            historico: rows
        });
    });
});

// Adicionar Lançamento
app.post('/api/lancamentos', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ erro: 'Não autorizado' });

    const { tipo, categoria, valor, descricao, data_lancamento } = req.body;
    const userId = req.session.userId;
    const valorNum = parseFloat(valor.toString().replace(',', '.'));

    db.run(`INSERT INTO lancamentos (usuario_id, tipo, categoria, valor, descricao, data_lancamento) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, tipo, categoria, valorNum, descricao, data_lancamento],
        function(err) {
            if (err) return res.status(500).json({ sucesso: false });
            res.json({ sucesso: true });
        }
    );
});

// Deletar Lançamento
app.delete('/api/lancamentos/:id', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ erro: 'Não autorizado' });

    const id = req.params.id;
    const userId = req.session.userId;

    db.run(`DELETE FROM lancamentos WHERE id = ? AND usuario_id = ?`, [id, userId], function(err) {
        if (err) return res.status(500).json({ sucesso: false });
        res.json({ sucesso: true });
    });
});

// Iniciar Servidor escutando na porta correta do Render
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});