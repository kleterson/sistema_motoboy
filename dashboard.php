<?php
session_start();
require_once 'conexao.php';

if (!isset($_SESSION['usuario_id'])) {
    header("Location: index.php");
    exit;
}

$user_id = $_SESSION['usuario_id'];

// Processar exclusão
if (isset($_GET['deletar'])) {
    $id_del = intval($_GET['deletar']);
    $stmt = $pdo->prepare("DELETE FROM lancamentos WHERE id = ? AND usuario_id = ?");
    $stmt->execute([$id_del, $user_id]);
    header("Location: dashboard.php");
    exit;
}

// Processar novo lançamento
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $tipo = $_POST['tipo'];
    $categoria = trim($_POST['categoria']);
    $valor = floatval(str_replace(',', '.', $_POST['valor']));
    $descricao = trim($_POST['descricao']);
    $data = $_POST['data_lancamento'];

    if ($valor > 0 && !empty($data)) {
        $stmt = $pdo->prepare("INSERT INTO lancamentos (usuario_id, tipo, categoria, valor, descricao, data_lancamento) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$user_id, $tipo, $categoria, $valor, $descricao, $data]);
    }
    header("Location: dashboard.php");
    exit;
}

// Cálculo do Hoje
$hoje = date('Y-m-d');
$stmt = $pdo->prepare("SELECT SUM(CASE WHEN tipo='ganho' THEN valor ELSE -valor END) as total FROM lancamentos WHERE usuario_id = ? AND data_lancamento = ?");
$stmt->execute([$user_id, $hoje]);
$saldo_hoje = $stmt->fetch(PDO::FETCH_ASSOC)['total'] ?? 0;

// Cálculo da Semana Atual
$inicio_semana = date('Y-m-d', strtotime('monday this week'));
$fim_semana = date('Y-m-d', strtotime('sunday this week'));

$stmt = $pdo->prepare("SELECT 
    SUM(CASE WHEN tipo='ganho' THEN valor ELSE 0 END) as ganhos,
    SUM(CASE WHEN tipo='gasto' THEN valor ELSE 0 END) as gastos
    FROM lancamentos WHERE usuario_id = ? AND data_lancamento BETWEEN ? AND ?");
$stmt->execute([$user_id, $inicio_semana, $fim_semana]);
$semana_data = $stmt->fetch(PDO::FETCH_ASSOC);
$ganhos_semana = $semana_data['ganhos'] ?? 0;
$gastos_semana = $semana_data['gastos'] ?? 0;
$saldo_semana = $ganhos_semana - $gastos_semana;

// Cálculo do Mês Atual
$inicio_mes = date('Y-m-01');
$fim_mes = date('Y-m-t');

$stmt = $pdo->prepare("SELECT 
    SUM(CASE WHEN tipo='ganho' THEN valor ELSE 0 END) as ganhos,
    SUM(CASE WHEN tipo='gasto' THEN valor ELSE 0 END) as gastos
    FROM lancamentos WHERE usuario_id = ? AND data_lancamento BETWEEN ? AND ?");
$stmt->execute([$user_id, $inicio_mes, $fim_mes]);
$mes_data = $stmt->fetch(PDO::FETCH_ASSOC);
$ganhos_mes = $mes_data['ganhos'] ?? 0;
$gastos_mes = $mes_data['gastos'] ?? 0;
$saldo_mes = $ganhos_mes - $gastos_mes;

// Percentuais de Metas (1000/semana, 4000/mês)
$meta_semanal = 1000.00;
$meta_mensal = 4000.00;

$pct_semana = min(100, round(($ganhos_semana / $meta_semanal) * 100, 1));
$pct_mes = min(100, round(($ganhos_mes / $meta_mensal) * 100, 1));

// Buscar Últimos Lançamentos
$stmt = $pdo->prepare("SELECT * FROM lancamentos WHERE usuario_id = ? ORDER BY data_lancamento DESC, id DESC LIMIT 20");
$stmt->execute([$user_id]);
$historico = $stmt->fetchAll(PDO::FETCH_ASSOC);
?>
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Painel do Motoboy - 99 Food</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body {
            background: #121212;
            color: #eee;
            min-height: 100vh;
            padding-bottom: 40px;
        }
        header {
            background: #1e1e1e;
            padding: 20px;
            border-bottom: 3px solid #ff7300;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        header h1 { font-size: 20px; color: #ff7300; }
        .user-info { display: flex; align-items: center; gap: 15px; }
        .logout-btn { color: #ff4444; text-decoration: none; font-weight: bold; background: #ff444422; padding: 6px 12px; border-radius: 6px; }

        .container { max-width: 1000px; margin: 20px auto; padding: 0 15px; }

        /* Grid de Resumo */
        .cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-bottom: 25px; }
        .card-stat { background: #1e1e1e; border-radius: 12px; padding: 20px; border-left: 5px solid #ff7300; }
        .card-stat h3 { font-size: 14px; color: #aaa; margin-bottom: 8px; }
        .card-stat .value { font-size: 24px; font-weight: bold; }
        .card-stat .sub { font-size: 12px; color: #888; margin-top: 5px; }

        /* Barra de Progresso de Metas */
        .metas-box { background: #1e1e1e; padding: 20px; border-radius: 12px; margin-bottom: 25px; }
        .metas-box h2 { font-size: 18px; color: #ff7300; margin-bottom: 15px; }
        .progress-group { margin-bottom: 15px; }
        .progress-label { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 5px; }
        .progress-bar-bg { background: #333; height: 18px; border-radius: 9px; overflow: hidden; }
        .progress-fill { background: linear-gradient(90deg, #ff7300, #00e676); height: 100%; transition: width 0.5s; }

        /* Form de Novo Lançamento */
        .form-box { background: #1e1e1e; padding: 20px; border-radius: 12px; margin-bottom: 25px; }
        .form-box h2 { font-size: 18px; color: #ff7300; margin-bottom: 15px; }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
        input, select { padding: 10px; background: #2a2a2a; border: 1px solid #444; border-radius: 6px; color: #fff; width: 100%; }
        .btn-add { background: #ff7300; color: #fff; font-weight: bold; border: none; padding: 10px; border-radius: 6px; cursor: pointer; }
        .btn-add:hover { background: #e06500; }

        /* Tabela de Extrato */
        .table-box { background: #1e1e1e; padding: 20px; border-radius: 12px; overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; text-align: left; }
        th, td { padding: 12px; border-bottom: 1px solid #333; font-size: 14px; }
        th { color: #ff7300; }
        .txt-ganho { color: #00e676; font-weight: bold; }
        .txt-gasto { color: #ff5252; font-weight: bold; }
        .del-btn { color: #ff4444; text-decoration: none; font-size: 16px; }
    </style>
</head>
<body>

<header>
    <h1>🏍️ 99 Food Control</h1>
    <div class="user-info">
        <span>Olá, <strong><?= htmlspecialchars($_SESSION['usuario_nome']) ?></strong></span>
        <a href="logout.php" class="logout-btn">Sair</a>
    </div>
</header>

<div class="container">

    <!-- Cards de Resumo -->
    <div class="cards-grid">
        <div class="card-stat">
            <h3>Lucro Líquido Hoje</h3>
            <div class="value" style="color: <?= $saldo_hoje >= 0 ? '#00e676' : '#ff5252' ?>">
                R$ <?= number_format($saldo_hoje, 2, ',', '.') ?>
            </div>
            <div class="sub">Data: <?= date('d/m/Y') ?></div>
        </div>

        <div class="card-stat">
            <h3>Resumo da Semana</h3>
            <div class="value" style="color: <?= $saldo_semana >= 0 ? '#00e676' : '#ff5252' ?>">
                R$ <?= number_format($saldo_semana, 2, ',', '.') ?>
            </div>
            <div class="sub">Ganhos: R$ <?= number_format($ganhos_semana, 2, ',', '.') ?> | Gastos: R$ <?= number_format($gastos_semana, 2, ',', '.') ?></div>
        </div>

        <div class="card-stat">
            <h3>Resumo do Mês</h3>
            <div class="value" style="color: <?= $saldo_mes >= 0 ? '#00e676' : '#ff5252' ?>">
                R$ <?= number_format($saldo_mes, 2, ',', '.') ?>
            </div>
            <div class="sub">Ganhos: R$ <?= number_format($ganhos_mes, 2, ',', '.') ?> | Gastos: R$ <?= number_format($gastos_mes, 2, ',', '.') ?></div>
        </div>
    </div>

    <!-- Metas de Faturamento -->
    <div class="metas-box">
        <h2>🎯 Progresso de Metas (Bruto)</h2>
        
        <div class="progress-group">
            <div class="progress-label">
                <span>Meta Semanal (R$ 1.000,00)</span>
                <span><strong>R$ <?= number_format($ganhos_semana, 2, ',', '.') ?></strong> (<?= $pct_semana ?>%)</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-fill" style="width: <?= $pct_semana ?>%;"></div>
            </div>
        </div>

        <div class="progress-group">
            <div class="progress-label">
                <span>Meta Mensal (R$ 4.000,00)</span>
                <span><strong>R$ <?= number_format($ganhos_mes, 2, ',', '.') ?></strong> (<?= $pct_mes ?>%)</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-fill" style="width: <?= $pct_mes ?>%;"></div>
            </div>
        </div>
    </div>

    <!-- Formulário para Registrar Ganhos e Gastos -->
    <div class="form-box">
        <h2>➕ Lançar Ganho ou Gasto</h2>
        <form method="POST">
            <div class="form-grid">
                <div>
                    <label>Tipo</label>
                    <select name="tipo" required>
                        <option value="ganho">💰 Ganho (Corrida)</option>
                        <option value="gasto">⛽ Gasto (Despesa)</option>
                    </select>
                </div>
                <div>
                    <label>Categoria</label>
                    <select name="categoria" required>
                        <option value="99 Food">99 Food</option>
                        <option value="iFood / Outros">Outros Apps</option>
                        <option value="Gasolina">Gasolina</option>
                        <option value="Manutenção">Manutenção Moto</option>
                        <option value="Alimentação">Alimentação</option>
                        <option value="Outros">Outros</option>
                    </select>
                </div>
                <div>
                    <label>Valor (R$)</label>
                    <input type="text" name="valor" placeholder="00.00" required>
                </div>
                <div>
                    <label>Data</label>
                    <input type="date" name="data_lancamento" value="<?= date('Y-m-d') ?>" required>
                </div>
                <div>
                    <label>Descrição</label>
                    <input type="text" name="descricao" placeholder="Ex: Turno Almoço">
                </div>
                <div style="display: flex; align-items: flex-end;">
                    <button type="submit" class="btn-add">Salvar Lançamento</button>
                </div>
            </div>
        </form>
    </div>

    <!-- Tabela de Histórico -->
    <div class="table-box">
        <h2>📋 Últimos Lançamentos</h2>
        <table>
            <thead>
                <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Categoria</th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
                <?php if (count($historico) === 0): ?>
                    <tr><td colspan="6" style="text-align: center; color: #888;">Nenhum lançamento registrado ainda.</td></tr>
                <?php else: ?>
                    <?php foreach ($historico as $item): ?>
                        <tr>
                            <td><?= date('d/m/Y', strtotime($item['data_lancamento'])) ?></td>
                            <td><?= $item['tipo'] === 'ganho' ? '💰 Ganho' : '⛽ Gasto' ?></td>
                            <td><?= htmlspecialchars($item['categoria']) ?></td>
                            <td><?= htmlspecialchars($item['descricao'] ?: '-') ?></td>
                            <td class="<?= $item['tipo'] === 'ganho' ? 'txt-ganho' : 'txt-gasto' ?>">
                                <?= $item['tipo'] === 'ganho' ? '+' : '-' ?> R$ <?= number_format($item['valor'], 2, ',', '.') ?>
                            </td>
                            <td>
                                <a href="dashboard.php?deletar=<?= $item['id'] ?>" class="del-btn" onclick="return confirm('Tem certeza que quer excluir?')">🗑️</a>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
            </tbody>
        </table>
    </div>

</div>

</body>
</html>