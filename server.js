const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
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

// Criar tabelas necessárias se não existirem (com suporte a is_admin e ip_cadastro)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT,
        email TEXT UNIQUE,
        senha TEXT,
        data_expiracao DATETIME,
        is_admin INTEGER DEFAULT 0,
        ip_cadastro TEXT
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
    cookie: { secure: false }
}));

// Servir arquivos estáticos da pasta atual (onde está o index.html)
app.use(express.static(path.join(__dirname)));

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
                data_expiracao: usuario.data_expiracao,
                is_admin: usuario.is_admin
            });
        });
    } else {
        res.json({ logado: false });
    }
});

// Rota de Cadastro e Login com Bloqueio por IP
app.post('/api/auth', async (req, res) => {
    const { acao, nome, email, senha } = req.body;

    if (acao === 'cadastrar') {
        const ipUser = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        db.get(`SELECT id FROM usuarios WHERE ip_cadastro = ?`, [ipUser], async (err, row) => {
            if (row) {
                return res.json({ 
                    sucesso: false, 
                    mensagem: 'Você já utilizou o período de teste gratuito neste dispositivo ou rede!' 
                });
            }

            try {
                const senhaHash = await bcrypt.hash(senha, 10);
                const dataExpiracao = new Date();
                dataExpiracao.setDate(dataExpiracao.getDate() + 3);

                db.run(`INSERT INTO usuarios (nome, email, senha, data_expiracao, is_admin, ip_cadastro) VALUES (?, ?, ?, ?, 0, ?)`,
                    [nome, email, senhaHash, dataExpiracao.toISOString(), ipUser],
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
        });
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
            req.session.nome = usuario.nome;
            req.session.is_admin = usuario.is_admin;
            res.json({ sucesso: true });
        });
    }
});

// ==========================================
// ROTAS DO PAINEL ADMINISTRADOR
// ==========================================

function isAdmin(req, res, next) {
    if (req.session && req.session.is_admin === 1) {
        return next();
    }
    return res.status(403).json({ sucesso: false, mensagem: 'Acesso negado. Apenas administradores.' });
}

app.get('/api/admin/usuarios', isAdmin, (req, res) => {
    db.all("SELECT id, nome, email, data_expiracao, is_admin FROM usuarios", [], (err, rows) => {
        if (err) return res.status(500).json({ erro: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/renovar/:id', isAdmin, (req, res) => {
    const userId = req.params.id;
    
    db.get("SELECT data_expiracao FROM usuarios WHERE id = ?", [userId], (err, row) => {
        if (err || !row) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado.' });

        let baseDate = new Date();
        const dataAtualExp = new Date(row.data_expiracao);
        
        if (dataAtualExp > baseDate) {
            baseDate = dataAtualExp;
        }

        baseDate.setDate(baseDate.getDate() + 30);
        const novaExpiracao = baseDate.toISOString();

        db.run("UPDATE usuarios SET data_expiracao = ? WHERE id = ?", [novaExpiracao, userId], function(err) {
            if (err) return res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar.' });
            res.json({ sucesso: true, mensagem: 'Assinatura renovada com sucesso por 30 dias!' });
        });
    });
});

// ==========================================

// Rota de Logout
app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Rota para buscar dados do dashboard
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

        const mesAtual = hoje.substring(0, 7);

        rows.forEach(item => {
            if (item.data_lancamento === hoje) {
                if (item.tipo === 'ganho') saldo_hoje += item.valor;
                if (item.tipo === 'gasto') saldo_hoje -= item.valor;
            }

            if (item.data_lancamento.startsWith(mesAtual)) {
                if (item.tipo === 'ganho') ganhos_mes += item.valor;
                if (item.tipo === 'gasto') gastos_mes += item.valor;
            }

            if (item.tipo === 'ganho') ganhos_semana += item.valor;
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

// Iniciar Servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});