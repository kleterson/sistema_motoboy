<?php
$host = 'SEU_HOST_AQUI';
$user = 'SEU_USUARIO_AQUI';
$password = 'SUA_SENHA_AQUI';
$dbname = 'NOME_DO_BANCO_AQUI';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $user, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    die("Erro na conexão com o banco de dados: " . $e->getMessage());
}
?>
