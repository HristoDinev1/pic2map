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
    // schema.sql contains one non-CREATE statement (the albums→photos cover FK,
    // which must come after both tables exist). ALTERs aren't naturally
    // idempotent, so skip them when the constraint is already in place.
    if (preg_match('/ADD CONSTRAINT (\w+)/i', $statement, $m)) {
        $exists = $pdo->query("SELECT COUNT(*) FROM information_schema.table_constraints
            WHERE constraint_schema = '$dbName' AND constraint_name = '{$m[1]}'")->fetchColumn();
        if ((int) $exists > 0) continue;
    }
    $pdo->exec($statement);
}



// Idempotent column upgrades for databases created before the local-auth driver.
$col = $pdo->query("SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = '$dbName' AND table_name = 'users' AND column_name = 'password_hash'")->fetchColumn();
if ((int) $col === 0) {
    $pdo->exec('ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL AFTER role');
    echo "+ users.password_hash column added\n";
}

// moderation_actions.photo_id was originally NOT NULL with ON DELETE CASCADE,
// which forced the DELETE branch in routes/moderation.php to skip writing a
// row. Promote it to NULL + ON DELETE SET NULL so every action — including
// DELETE — is recorded.
$photoIdNullable = $pdo->query("SELECT IS_NULLABLE FROM information_schema.columns
    WHERE table_schema = '$dbName' AND table_name = 'moderation_actions'
      AND column_name = 'photo_id'")->fetchColumn();
if ($photoIdNullable === 'NO') {
    $pdo->exec('ALTER TABLE moderation_actions DROP FOREIGN KEY fk_modlog_photo');
    $pdo->exec('ALTER TABLE moderation_actions MODIFY photo_id CHAR(36) NULL');
    $pdo->exec('ALTER TABLE moderation_actions
        ADD CONSTRAINT fk_modlog_photo FOREIGN KEY (photo_id)
        REFERENCES photos(id) ON DELETE SET NULL');
    echo "+ moderation_actions.photo_id is now NULL + ON DELETE SET NULL\n";
}

echo "\xE2\x9C\x93 schema applied\n";
