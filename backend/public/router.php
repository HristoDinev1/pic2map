<?php
/**
 * Router script for PHP's built-in dev server, e.g.:
 *   php -S localhost:4000 -t public public/router.php
 * Serves static files as-is, sends everything else to index.php.
 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
    return false; // let the built-in server handle the static file
}
require __DIR__ . '/index.php';
