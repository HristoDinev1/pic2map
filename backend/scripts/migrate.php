<?php
declare(strict_types=1);

/** Applies backend/sql/schema.sql to the configured MySQL/MariaDB database. */

require __DIR__ . '/../src/Config.php';

$dsn = sprintf(
    'mysql:host=%s;port=%s;charset=utf8mb4',
    Config::get('DB_HOST', '127.0.0.1'),
    Config::get('DB_PORT', '3306'),
);
$pdo = new PDO($dsn, Config::require('DB_USER'), Config::get('DB_PASSWORD', ''), [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$dbName = Config::require('DB_NAME');
$pdo->exec("CREATE DATABASE IF NOT EXISTS `$dbName` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
$pdo->exec("USE `$dbName`");

$raw = (string) file_get_contents(__DIR__ . '/../sql/schema.sql');
// Strip full-line "--" comments before splitting on ";" (the schema has no
// compound statements/delimiters, so a naive split is safe here).
$lines = array_filter(explode("\n", $raw), fn($l) => !str_starts_with(ltrim($l), '--'));
$sql = implode("\n", $lines);

foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
    if ($statement === '') continue;
    $pdo->exec($statement);
}

echo "✓ schema applied\n";
