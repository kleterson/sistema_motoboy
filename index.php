<?php
session_start();
require_once 'conexao.php';

$mensagem = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['acao']) && $_POST['acao'] === 'cadastrar') {
        $nome = trim($_POST['nome']);
        $email = trim($_POST['email']);
        $senha = password_hash($_POST['senha'], PASSWORD_DEFAULT);

        $stmt = $pdo->prepare("SELECT id FROM usuarios WHERE email = ?");
        $stmt->execute([$email]);
        if ($stmt->fetch()) {
            $mensagem = "Este e-mail já está cadastrado!";
        } else {
            $stmt = $pdo->prepare("INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)");
            $stmt->execute([$nome, $email, $senha]);
            $mensagem = "Cadastro realizado com sucesso! Faça login abaixo.";
        }
    } elseif (isset($_POST['acao']) && $_POST['acao'] === 'login') {
        $email = trim($_POST['email']);
        $senha = $_POST['senha'];

        $stmt = $pdo->prepare("SELECT * FROM usuarios WHERE email = ?");
        $stmt->execute([$email]);
        $usuario = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($usuario && password_verify($senha, $usuario['senha'])) {
            $_SESSION['usuario_id'] = $usuario['id'];
            $_SESSION['usuario_nome'] = $usuario['nome'];
            header("Location: dashboard.php");
            exit;
        } else {
            $mensagem = "E-mail ou senha incorretos!";
        }
    }
}
?>
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Gestão Motoboy 99 Food</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body {
            background: linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.85)), url('https://images.unsplash.com/photo-1558981806-ec527fa84c39?q=80&w=1200&auto=format&fit=crop') center/cover no-repeat fixed;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .card {
            background: rgba(30, 30, 30, 0.95);
            border-radius: 16px;
            padding: 30px;
            width: 100%;
            max-width: 420px;
            color: #fff;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            border: 1px solid #ff7300;
        }
        .title { text-align: center; color: #ff7300; font-size: 24px; font-weight: bold; margin-bottom: 5px; }
        .subtitle { text-align: center; color: #ccc; font-size: 14px; margin-bottom: 25px; }
        .msg { background: #ff730022; border: 1px solid #ff7300; padding: 10px; border-radius: 8px; color: #ff9d00; text-align: center; margin-bottom: 15px; font-size: 14px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; color: #bbb; font-size: 13px; }
        input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #444; background: #222; color: #fff; font-size: 15px; }
        input:focus { border-color: #ff7300; outline: none; }
        button { width: 100%; padding: 12px; border-radius: 8px; border: none; background: #ff7300; color: #fff; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; margin-top: 10px; }
        button:hover { background: #e06500; }
        .toggle-btn { text-align: center; margin-top: 20px; color: #aaa; font-size: 14px; cursor: pointer; text-decoration: underline; }
    </style>
</head>
<body>

<div class="card">
    <div class="title">🚀 MOTOBOY CONTROL</div>
    <div class="subtitle">Gestão Financeira 99 Food & Entregas</div>

    <?php if ($mensagem): ?>
        <div class="msg"><?= htmlspecialchars($mensagem) ?></div>
    <?php endif; ?>

    <!-- Form de Login -->
    <form id="form-login" method="POST">
        <input type="hidden" name="acao" value="login">
        <div class="form-group">
            <label>Seu E-mail</label>
            <input type="email" name="email" required placeholder="exemplo@email.com">
        </div>
        <div class="form-group">
            <label>Sua Senha</label>
            <input type="password" name="senha" required placeholder="••••••••">
        </div>
        <button type="submit">Entrar no Painel</button>
        <div class="toggle-btn" onclick="toggleForm()">Não tem conta? Cadastre-se aqui</div>
    </form>

    <!-- Form de Cadastro -->
    <form id="form-cadastro" method="POST" style="display: none;">
        <input type="hidden" name="acao" value="cadastrar">
        <div class="form-group">
            <label>Seu Nome</label>
            <input type="text" name="nome" required placeholder="Ex: Carlos Silva">
        </div>
        <div class="form-group">
            <label>Seu E-mail</label>
            <input type="email" name="email" required placeholder="exemplo@email.com">
        </div>
        <div class="form-group">
            <label>Crie uma Senha</label>
            <input type="password" name="senha" required placeholder="••••••••">
        </div>
        <button type="submit">Criar Minha Conta</button>
        <div class="toggle-btn" onclick="toggleForm()">Já tem conta? Faça Login</div>
    </form>
</div>

<script>
    function toggleForm() {
        const login = document.getElementById('form-login');
        const cadastro = document.getElementById('form-cadastro');
        if (login.style.display === 'none') {
            login.style.display = 'block';
            cadastro.style.display = 'none';
        } else {
            login.style.display = 'none';
            cadastro.style.display = 'block';
        }
    }
</script>

</body>
</html>