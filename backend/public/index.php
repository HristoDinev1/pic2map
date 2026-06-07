<?php
declare(strict_types=1);

/**
 * PIC2MAP REST API — front controller (PHP port of backend/src/app.ts).
 * Single entry point: routes "/api/..." requests to the matching handler,
 * applies CORS, and converts thrown HttpError/exceptions into JSON responses.
 */

spl_autoload_register(function (string $class) {
    $path = dirname(__DIR__) . "/src/$class.php";
    if (is_file($path)) require $path;
});

$corsOrigins = array_map('trim', explode(',', Config::get('CORS_ORIGIN', '*')));
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array('*', $corsOrigins, true)) {
    header('Access-Control-Allow-Origin: *');
} elseif ($origin !== '' && in_array($origin, $corsOrigins, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');

if (Http::method() === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Resolve the request path relative to this script, then strip a leading "/api".
$scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($scriptDir !== '' && str_starts_with($path, $scriptDir)) {
    $path = substr($path, strlen($scriptDir));
}
$path = '/' . ltrim($path, '/');
if ($path !== '/' && str_ends_with($path, '/')) $path = rtrim($path, '/');
if (str_starts_with($path, '/api/')) $path = substr($path, 4);
elseif ($path === '/api') $path = '/';

if ($path === '/health') {
    Http::json(['ok' => true, 'ts' => (int) (microtime(true) * 1000)]);
}

$router = new Router();
foreach ([
    'auth', 'photos', 'albums', 'map', 'search', 'moderation', 'admin', 'transfer',
] as $resource) {
    (require __DIR__ . "/../src/routes/$resource.php")($router);
}

try {
    $matched = $router->dispatch(Http::method(), $path);
    if (!$matched) {
        Http::json(['error' => 'Not found'], 404);
    }
} catch (HttpError $e) {
    Http::json(array_filter(['error' => $e->getMessage(), 'details' => $e->details], fn($v) => $v !== null), $e->status);
} catch (Throwable $e) {
    error_log('[pic2map] Unhandled error: ' . $e);
    Http::json(['error' => 'Internal server error'], 500);
}
